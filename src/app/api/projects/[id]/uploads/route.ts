import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { saveFile, MAX_BYTES, MAX_MB_LABEL } from "@/lib/ingest/store";
import { dispatch } from "@/lib/jobs";
import { readTable, describeMeta, type Table } from "@/lib/ingest/table";
import { aiFillMapping } from "@/lib/ingest/ai-mapping";
import { autoMap, CsvKind, FIELDS } from "@/lib/ingest/columns";
import { looksLikeTracker } from "@/lib/ingest/tracker-parse";
import { looksLikeAds } from "@/lib/ingest/ads-parse";
import { limited } from "@/lib/rate-limit";
import { guardProject } from "@/lib/auth/access";

const KINDS = ["sales", "reviews", "competitor_doc", "competitor_tracker", "ads"] as const;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardProject(id);
  if (g instanceof Response) return g;
  const blocked = limited(req, "uploads", 20);
  if (blocked) return blocked;

  const form = await req.formData();
  const kind = String(form.get("kind") ?? "");
  const file = form.get("file");
  if (!(KINDS as readonly string[]).includes(kind)) return Response.json({ error: "Invalid kind" }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  const ext = file.name.toLowerCase().split(".").pop();
  if (kind !== "competitor_doc" && ext !== "csv" && ext !== "xlsx" && ext !== "txt") return Response.json({ error: "Sales, reviews, ads and tracker files must be a .csv or .xlsx file." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: `File is larger than ${MAX_MB_LABEL}. Split it (for example by date range) and upload the parts.` }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());

  // Validate cheaply before saving anything.
  let csv: Table | null = null;
  if (kind !== "competitor_doc") {
    try {
      csv = await readTable(buf, file.name);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  // An ads report uploaded as sales would load ad-attributed sales as if they were all orders: refuse it.
  if (kind === "sales" && csv && looksLikeAds(csv.headers)) return Response.json({ error: "This looks like an advertising report (spend, clicks, campaigns). Upload it in the \"Ads report\" box instead, so it is not counted as orders." }, { status: 400 });
  // A tracker spreadsheet uploaded as a plain document would be filed under one competitor and lose its dates: redirect it.
  if (kind === "competitor_doc" && (ext === "csv" || ext === "xlsx")) {
    const t = await readTable(buf, file.name).catch(() => null);
    if (t && looksLikeTracker(t.headers)) return Response.json({ error: "This looks like competitor tracking data (snapshots over time). Upload it in the \"Competitor tracking data\" box so dates, prices and promotions are kept." }, { status: 400 });
  }
  const competitor = String(form.get("competitor") ?? "").trim();
  if (kind === "competitor_doc" && !competitor) return Response.json({ error: "Enter the competitor's name." }, { status: 400 });
  const docDate = String(form.get("docDate") ?? "").trim();
  if (docDate && !/^\d{4}-\d{2}-\d{2}$/.test(docDate)) return Response.json({ error: "Document date must be YYYY-MM-DD." }, { status: 400 });

  const [up] = await db.insert(schema.uploads).values({ projectId: id, kind: kind as (typeof KINDS)[number], filename: file.name, storageKey: "pending" }).returning();
  const key = await saveFile(up.id, file.name, buf);
  await db.update(schema.uploads).set({ storageKey: key }).where(eq(schema.uploads.id, up.id));

  if (kind === "competitor_doc") {
    // Locally this is quick enough to wait for. On Netlify it runs in the background function and the page polls.
    await db.update(schema.uploads).set({ status: "processing" }).where(eq(schema.uploads.id, up.id));
    try {
      await dispatch({ kind: "doc", uploadId: up.id, competitor, docDate: docDate || null }, { waitIfLocal: true });
    } catch (e) {
      await db.update(schema.uploads).set({ status: "failed", error: (e as Error).message }).where(eq(schema.uploads.id, up.id));
    }
    const [done] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, up.id));
    return Response.json({ upload: done });
  }

  // CSV: return headers + suggested mapping; the seller confirms before anything is imported.
  const heuristic = autoMap(kind as CsvKind, csv!.headers);
  const { mapping, aiFields } = await aiFillMapping(kind as CsvKind, csv!.headers, csv!.rows.slice(0, 3), heuristic);
  return Response.json({
    upload: { id: up.id, kind, filename: file.name, status: "uploaded" },
    headers: csv!.headers,
    preview: csv!.rows.slice(0, 3),
    totalRows: csv!.rows.length,
    suggestedMapping: mapping,
    aiFields,
    notes: describeMeta(csv!.meta),
    fields: Object.entries(FIELDS[kind as CsvKind]).map(([field, d]) => ({ field, label: d.label, required: d.required })),
  });
}
