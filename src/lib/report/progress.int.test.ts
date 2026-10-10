// Day-30 re-check against a real database: freeze a snapshot, re-upload (replace) data, compare.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, schema } from "@/lib/db/client";
import { computeSnapshot } from "./metrics";
import { compareMetrics } from "./metrics-pure";

let pid: string;
const sale = (d: string, sku: string, revenue: number, returned: boolean) => ({ projectId: pid, orderDate: d, sku, units: 1, revenue: revenue.toFixed(2), price: revenue.toFixed(2), returned });
const review = (d: string, rating: number) => ({ projectId: pid, reviewDate: d, rating, body: "ok" });

beforeAll(async () => {
  const [p] = await db.insert(schema.projects).values({ name: "progress-test" }).returning();
  pid = p.id;
  await db.insert(schema.sales).values([...Array(10)].map((_, i) => sale("2026-08-10", "A", 100, i < 3)));
  await db.insert(schema.reviews).values([review("2026-08-11", 2), review("2026-08-12", 4), review("2026-08-13", 5), review("2026-08-14", 1)]);
});
afterAll(async () => {
  await db.delete(schema.projects).where(eq(schema.projects.id, pid));
  await pool.end();
});

describe("30-day comparison", () => {
  it("shows improvement after a re-upload replaces the data", async () => {
    const before = await computeSnapshot(pid);
    const get = (s: typeof before, k: string) => s.metrics.find((m) => m.key === k)!;
    expect(get(before, "revenue_latest_month").value).toBe(1000);
    expect(get(before, "return_rate").value).toBe(30);
    expect(get(before, "low_rating_pct").value).toBe(50);
    expect(before.dataThrough).toEqual({ sales: "2026-08-10", reviews: "2026-08-14" });

    // re-upload: replace everything with a better month
    await db.delete(schema.sales).where(eq(schema.sales.projectId, pid));
    await db.delete(schema.reviews).where(eq(schema.reviews.projectId, pid));
    await db.insert(schema.sales).values([...Array(12)].map((_, i) => sale("2026-09-10", "A", 100, i < 1)));
    await db.insert(schema.reviews).values([review("2026-09-11", 5), review("2026-09-12", 4), review("2026-09-13", 5), review("2026-09-14", 2)]);

    const after = await computeSnapshot(pid);
    expect(after.dataThrough.sales).toBe("2026-09-10");
    const cmp = Object.fromEntries(compareMetrics(before.metrics, after.metrics).map((c) => [c.key, c]));
    expect(cmp.revenue_latest_month).toMatchObject({ after: 1200, verdict: "improved", period: "2026-09", periodBefore: "2026-08" });
    expect(cmp.return_rate.verdict).toBe("improved"); // 30% -> 8.3%
    expect(cmp.low_rating_pct.verdict).toBe("improved"); // 50% -> 25%
    expect(cmp.avg_rating.verdict).toBe("improved");
  });
});
