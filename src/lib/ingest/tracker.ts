import { and, asc, eq, like, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { passageFor, type SnapRow, type TrackedProduct } from "@/lib/insights/tracker";
import { storeParsedDoc } from "./store-doc";
import type { TrackerRecord } from "./tracker-parse";

// ---- database ---------------------------------------------------------------------------------

/** Saves snapshots (re-uploading the same competitor, product and date updates the row). Returns rows written. */
export async function storeTrackerSnapshots(projectId: string, uploadId: string | null, records: TrackerRecord[]): Promise<number> {
  const names = [...new Map(records.map((r) => [r.competitor.toLowerCase(), r.competitor])).values()];
  const existing = await db.select().from(schema.competitors).where(eq(schema.competitors.projectId, projectId));
  const ids = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
  for (const name of names) {
    if (!ids.has(name.toLowerCase())) ids.set(name.toLowerCase(), (await db.insert(schema.competitors).values({ projectId, name }).returning())[0].id);
  }
  const t = schema.competitorSnapshots;
  for (let i = 0; i < records.length; i += 500) {
    await db.insert(t).values(records.slice(i, i + 500).map((r) => ({
      projectId, competitorId: ids.get(r.competitor.toLowerCase())!, uploadId, snapshotDate: r.date, product: r.product, category: r.category,
      price: r.price.toFixed(2), discountApplied: r.discount, rating: r.rating == null ? null : r.rating.toFixed(2), totalReviews: r.totalReviews,
      newReviews: r.newReviews, stockStatus: r.stock, promo: r.promo, dataType: r.dataType, comparableSku: r.comparableSku,
    }))).onConflictDoUpdate({
      target: [t.projectId, t.competitorId, t.product, t.snapshotDate],
      set: {
        uploadId: sql`excluded.upload_id`, category: sql`excluded.category`, price: sql`excluded.price`, discountApplied: sql`excluded.discount_applied`,
        rating: sql`excluded.rating`, totalReviews: sql`excluded.total_reviews`, newReviews: sql`excluded.new_reviews`, stockStatus: sql`excluded.stock_status`,
        promo: sql`excluded.promo`, dataType: sql`excluded.data_type`, comparableSku: sql`coalesce(excluded.comparable_sku, competitor_snapshots.comparable_sku)`,
      },
    });
  }
  return records.length;
}

/** All tracked products with their series, oldest snapshot first. */
export async function loadTracked(projectId: string): Promise<TrackedProduct[]> {
  const rows = await db.select({
    competitor: schema.competitors.name, s: schema.competitorSnapshots,
  }).from(schema.competitorSnapshots)
    .innerJoin(schema.competitors, eq(schema.competitors.id, schema.competitorSnapshots.competitorId))
    .where(eq(schema.competitorSnapshots.projectId, projectId))
    .orderBy(asc(schema.competitors.name), asc(schema.competitorSnapshots.product), asc(schema.competitorSnapshots.snapshotDate));
  const out = new Map<string, TrackedProduct>();
  for (const { competitor, s } of rows) {
    const key = `${competitor}|${s.product}`;
    let p = out.get(key);
    if (!p) out.set(key, (p = { competitor, product: s.product, category: s.category, comparableSku: s.comparableSku, dataType: s.dataType, series: [] }));
    if (s.comparableSku) p.comparableSku = s.comparableSku;
    const snap: SnapRow = {
      date: s.snapshotDate, price: Number(s.price), discount: s.discountApplied, rating: s.rating == null ? null : Number(s.rating),
      totalReviews: s.totalReviews, newReviews: s.newReviews, stock: s.stockStatus, promo: s.promo,
    };
    p.series.push(snap);
  }
  return [...out.values()];
}

export const TRACKER_TITLE = "Tracker summary: ";

/**
 * Writes one short factual summary passage per tracked product (computed by code) and indexes them, so the AI
 * analysis can search and quote them like any competitor document. Replaces earlier tracker summaries.
 */
export async function rebuildTrackerDocs(projectId: string): Promise<{ competitors: number; chunks: number }> {
  const products = await loadTracked(projectId);
  await db.delete(schema.documents).where(and(eq(schema.documents.projectId, projectId), like(schema.documents.title, `${TRACKER_TITLE}%`)));
  const byComp = new Map<string, TrackedProduct[]>();
  for (const p of products) (byComp.get(p.competitor) ?? byComp.set(p.competitor, []).get(p.competitor)!).push(p);
  let chunks = 0;
  for (const [competitor, list] of byComp) {
    const texts = list.map(passageFor).filter((t): t is string => !!t);
    if (!texts.length) continue;
    const last = list.flatMap((p) => p.series.map((x) => x.date)).sort().pop() ?? null;
    const stored = await storeParsedDoc({
      projectId, uploadId: null, competitorName: competitor, title: `${TRACKER_TITLE}${competitor}`, docDate: last,
      parsed: { docType: "csv", chunks: texts.map((content) => ({ content, page: null })), docDate: last },
    });
    chunks += stored.chunks;
  }
  return { competitors: byComp.size, chunks };
}
