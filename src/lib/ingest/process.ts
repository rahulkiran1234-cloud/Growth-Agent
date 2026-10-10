import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { loadFile } from "./store";
import { readTable } from "./table";
import { CsvKind, Mapping, missingRequired } from "./columns";
import { processReviews, processSales, Report } from "./validate";
import { parseDocument } from "./docs";
import { storeParsedDoc } from "./store-doc";
import { tagReviews } from "./tag-reviews";
import { processTracker } from "./tracker-parse";
import { rebuildTrackerDocs, storeTrackerSnapshots } from "./tracker";
import { processAds } from "./ads-parse";
import { storeAdRows } from "./ads";
import { dispatch, type Job } from "@/lib/jobs";

const setUpload = (id: string, v: Partial<typeof schema.uploads.$inferInsert>) =>
  db.update(schema.uploads).set(v).where(eq(schema.uploads.id, id));

async function insertBatches<T>(rows: T[], size: number, fn: (b: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

/** Validate + load a sales or reviews CSV using the confirmed column mapping. */
export async function processCsvUpload(uploadId: string, mapping: Mapping) {
  const [up] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, uploadId));
  if (!up || (up.kind !== "sales" && up.kind !== "reviews" && up.kind !== "competitor_tracker" && up.kind !== "ads")) throw new Error("Upload not found or not a CSV kind");
  const kind = up.kind as CsvKind;

  const missing = missingRequired(kind, mapping);
  if (missing.length) {
    await setUpload(uploadId, { status: "failed", mapping, error: `Missing required mapping: ${missing.join(", ")}` });
    return;
  }
  await setUpload(uploadId, { status: "processing", mapping, error: null });

  try {
    const { headers, rows } = await readTable(await loadFile(up.storageKey), up.filename);
    if (kind === "ads") {
      const a = processAds(rows, headers, mapping);
      if (a.report.blockers.length) {
        await setUpload(uploadId, { status: "failed", stats: a.report, error: a.report.blockers.join(" ") });
        return;
      }
      await storeAdRows(up.projectId, uploadId, a.records); // adds new days and updates matching ones
      await setUpload(uploadId, { status: "ready", stats: a.report });
      return;
    }
    if (kind === "competitor_tracker") {
      const t = processTracker(rows, headers, mapping);
      if (t.report.blockers.length) {
        await setUpload(uploadId, { status: "failed", stats: t.report, error: t.report.blockers.join(" ") });
        return;
      }
      await storeTrackerSnapshots(up.projectId, uploadId, t.records);
      try {
        const idx = await rebuildTrackerDocs(up.projectId); // summaries the AI analysis can search and quote
        await setUpload(uploadId, { status: "ready", stats: { ...t.report, summaries: idx.chunks } });
      } catch (e) {
        await setUpload(uploadId, { status: "failed", stats: t.report, error: `Your ${t.records.length} snapshots were saved, but the summaries for the AI analysis could not be indexed (${(e as Error).message.slice(0, 120)}). Upload the file again to retry.` });
      }
      return;
    }

    const result = kind === "sales" ? processSales(rows, headers, mapping) : processReviews(rows, headers, mapping);
    const report: Report = result.report;

    if (report.blockers.length) {
      // Garbage-in guard: refuse to load data that would give untrustworthy analysis.
      await setUpload(uploadId, { status: "failed", stats: report, error: report.blockers.join(" ") });
      return;
    }

    if (kind === "sales") {
      const recs = (result.records as ReturnType<typeof processSales>["records"]);
      await db.delete(schema.sales).where(eq(schema.sales.projectId, up.projectId)); // re-upload replaces
      await insertBatches(recs, 1000, (b) =>
        db.insert(schema.sales).values(
          b.map((r) => ({ projectId: up.projectId, orderDate: r.orderDate, sku: r.sku, units: r.units, revenue: r.revenue.toFixed(2), price: r.price.toFixed(2), returned: r.returned, customerHash: r.customerHash })),
        ),
      );
      await setUpload(uploadId, { status: "ready", stats: report });
      return;
    }

    const recs = result.records as ReturnType<typeof processReviews>["records"];
    await db.delete(schema.reviews).where(eq(schema.reviews.projectId, up.projectId));
    await insertBatches(recs, 1000, (b) =>
      db.insert(schema.reviews).values(b.map((r) => ({ projectId: up.projectId, reviewDate: r.reviewDate, sku: r.sku, rating: r.rating, body: r.body }))),
    );
    // Topic tagging takes a while: keep status "processing" and finish in the background.
    await setUpload(uploadId, { status: "processing", stats: { ...report, tagging: "running", taggingAt: new Date().toISOString() } });
    try {
      await dispatch({ kind: "tag", projectId: up.projectId, uploadId });
    } catch (e) {
      await setUpload(uploadId, { status: "ready", stats: { ...report, tagging: "failed", taggingError: (e as Error).message, warnings: [...report.warnings, "Topic tagging could not be started; keyword matching will be used instead."] } });
    }
  } catch (e) {
    await setUpload(uploadId, { status: "failed", error: (e as Error).message });
  }
}

/** Parse, chunk, embed and store a competitor document. */
export async function processDocUpload(uploadId: string, competitorName: string, docDateInput: string | null) {
  const [up] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, uploadId));
  if (!up) throw new Error("Upload not found");
  await setUpload(uploadId, { status: "processing", error: null });
  try {
    const parsed = await parseDocument(await loadFile(up.storageKey), up.filename);
    if (parsed.chunks.length === 0) throw new Error("No content could be extracted from the document.");
    const docDate = docDateInput || parsed.docDate;
    const warnings: string[] = [];
    if (!docDate) warnings.push("No document date found or given; freshness can't be checked.");
    else if (Date.now() - Date.parse(docDate) > 90 * 864e5) warnings.push(`This document is dated ${docDate} (over 90 days old); competitor data may be stale.`);

    const stored = await storeParsedDoc({ projectId: up.projectId, uploadId, competitorName, title: up.filename, parsed, docDate });
    await setUpload(uploadId, { status: "ready", stats: { competitor: stored.competitor, chunks: stored.chunks, docDate, docType: parsed.docType, warnings } });
  } catch (e) {
    await setUpload(uploadId, { status: "failed", error: (e as Error).message });
  }
}

// Review tagging. It runs in the background function on Netlify, or in this process elsewhere. It is idempotent (only
// untagged reviews are touched), so a run that was cut off is simply started again by resumeStalledJobs().
const running = ((globalThis as unknown as { __tagging?: Set<string> }).__tagging ??= new Set<string>());

/** One full tagging run for an upload; resolves when it is done (the Netlify function awaits it). */
export async function runTaggingJob(projectId: string, uploadId: string) {
  const [up] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, uploadId));
  const report = (up?.stats ?? {}) as Report;
  try {
    const t = await tagReviews(projectId);
    await setUpload(uploadId, { status: "ready", stats: { ...report, tagging: "done", ...t } });
  } catch (e) {
    await setUpload(uploadId, {
      status: "ready",
      stats: { ...report, tagging: "failed", taggingError: (e as Error).message, warnings: [...(report.warnings ?? []), "Topic tagging failed; keyword matching will be used instead."] },
    });
  }
}

/** In-process starter (laptop or an always-on server). */
export function startTaggingJob(projectId: string, uploadId: string) {
  if (running.has(projectId)) return;
  running.add(projectId);
  void runTaggingJob(projectId, uploadId).finally(() => running.delete(projectId));
}

const TAGGING_STALL_MS = 10 * 60_000;

export async function resumeStalledJobs(projectId: string) {
  if (running.has(projectId)) return;
  const all = await db.select().from(schema.uploads).where(eq(schema.uploads.projectId, projectId));
  const up = all.find((u) => u.kind === "reviews" && u.status === "processing");
  if (!up) return;
  const stats = (up.stats ?? {}) as Report & { taggingAt?: string };
  // Elsewhere the run lives in this process, so "not running here" means it died. On Netlify it lives in a function we
  // cannot see: treat it as dead only after it has been silent for 10 minutes, then start it again.
  if (process.env.NETLIFY === "true" && stats.taggingAt && Date.now() - Date.parse(stats.taggingAt) < TAGGING_STALL_MS) return;
  await setUpload(up.id, { stats: { ...stats, taggingAt: new Date().toISOString() } });
  await dispatch({ kind: "tag", projectId, uploadId: up.id }).catch(() => undefined);
}

/** Runs one queued job to completion. Used by the Netlify background function. */
export async function runJob(job: Job) {
  if (job.kind === "tag") return runTaggingJob(job.projectId, job.uploadId);
  if (job.kind === "doc") return processDocUpload(job.uploadId, job.competitor, job.docDate);
  const { runAnalysis } = await import("@/lib/agent/run");
  return runAnalysis(job.analysisId, job.projectId);
}
