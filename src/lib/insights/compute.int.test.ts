// Insights SQL against a real database (npm run test:int): aligned arrays, review rows, quotes, and project isolation.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, schema } from "@/lib/db/client";
import { computeInsights } from "./compute";
import { defaultFilter, monthly, topics } from "./aggregate";

let A = "", B = "";
const sale = (pid: string, d: string, sku: string, revenue: number, units: number, returned = false) => ({ projectId: pid, orderDate: d, sku, units, revenue: revenue.toFixed(2), price: (revenue / units).toFixed(2), returned });

beforeAll(async () => {
  [A, B] = await Promise.all([db.insert(schema.projects).values({ name: "ins-test A" }).returning(), db.insert(schema.projects).values({ name: "ins-test B" }).returning()]).then((r) => r.map((x) => x[0].id));
  await db.insert(schema.sales).values([
    sale(A, "2026-07-05", "X", 300, 3), sale(A, "2026-07-20", "Y", 100, 1, true), sale(A, "2026-09-02", "X", 200, 2),
  ]);
  await db.insert(schema.reviews).values([
    { projectId: A, reviewDate: "2026-07-06", sku: "X", rating: 2, body: "Way too small, the size chart is wrong", topics: ["sizing_fit"] },
    { projectId: A, reviewDate: "2026-08-10", sku: "Y", rating: 5, body: "Great product, very happy", topics: null },
    { projectId: A, reviewDate: "2026-09-03", sku: "X", rating: 1, body: "Arrived damaged and the box was crushed", topics: ["packaging_damage", "delivery"] },
  ]);
  await db.insert(schema.sales).values(sale(B, "2026-01-01", "Z", 50, 1));
});
afterAll(async () => {
  for (const id of [A, B]) await db.delete(schema.projects).where(eq(schema.projects.id, id));
  await pool.end();
});

describe("computeInsights", () => {
  it("aligns every series to the months present in sales or reviews", async () => {
    const i = await computeInsights(A);
    expect(i.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    const x = i.skus.find((s) => s.sku === "X")!;
    expect(x.revenue).toEqual([300, 0, 200]); // August has no sales: zero, not missing
    expect(x.units).toEqual([3, 0, 2]);
    expect(i.skus[0].sku).toBe("X"); // sorted by revenue
    expect(i.counts).toEqual({ sales: 3, reviews: 3, skus: 2 });
    expect(i.dataThrough).toEqual({ sales: "2026-09-02", reviews: "2026-09-03" });
  });

  it("feeds the pure aggregators correctly", async () => {
    const i = await computeInsights(A);
    const m = monthly(i, defaultFilter(i));
    expect(m[0]).toMatchObject({ revenue: 400, orders: 2, returnRate: 50, reviews: 1, avgRating: 2, lowPct: 100 });
    expect(m[1]).toMatchObject({ revenue: 0, price: null, reviews: 1, avgRating: 5, lowPct: 0 });
    const t = topics(i, defaultFilter(i));
    expect(t.map((x) => x.topic).sort()).toEqual(["delivery", "packaging_damage", "sizing_fit"]);
    expect(t.find((x) => x.topic === "sizing_fit")!.pct).toBe(50); // 1 of 2 tagged low reviews
  });

  it("returns real recent review text per topic", async () => {
    const i = await computeInsights(A);
    expect(i.quotes.packaging_damage[0].text).toMatch(/damaged/);
    expect(i.quotes.sizing_fit[0]).toMatchObject({ rating: 2, sku: "X" });
  });

  it("never mixes in another project's data", async () => {
    const i = await computeInsights(B);
    expect(i.months).toEqual(["2026-01"]);
    expect(i.skus.map((s) => s.sku)).toEqual(["Z"]);
    expect(i.reviewRows).toEqual([]);
    expect(Object.keys(i.quotes)).toEqual([]);
  });
});

describe("praise data for the Reviews screen", () => {
  let C = "";
  beforeAll(async () => {
    const [p] = await db.insert(schema.projects).values({ name: "ins-test C" }).returning();
    C = p.id;
    await db.insert(schema.reviews).values([
      { projectId: C, reviewDate: "2026-09-01", sku: "P", rating: 5, body: "Great quality, fast delivery, love it!" },
      { projectId: C, reviewDate: "2026-09-02", sku: "P", rating: 4, body: "Exactly as described." },
      { projectId: C, reviewDate: "2026-09-03", sku: "P", rating: 2, body: "Quality is poor and it broke quickly", topics: ["quality"] },
    ]);
  });
  afterAll(async () => { await db.delete(schema.projects).where(eq(schema.projects.id, C)); });

  it("counts 4-5 star keyword themes per month and product, and keeps recent distinct 5-star quotes", async () => {
    const i = await computeInsights(C);
    const r = i.reviewRows[0];
    expect(r.posN).toBe(2);
    expect(r.pos).toMatchObject({ quality: 1, delivery: 1, as_described: 1 });
    expect(r.pos.quality).toBe(1); // the 2-star "quality is poor" review is not counted as praise
    expect(i.praise).toHaveLength(1);
    expect(i.praise[0].text).toMatch(/Great quality/);
  });
});
