import { describe, expect, it } from "vitest";
import { ownerSplit, praiseThemes, ratingTrend, skuHealth, skuMovers, themePriorities, topProducts, halves } from "./reviews";
import type { Insights, ReviewRow } from "./types";

const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const f = { from: 0, to: 5, sku: null };

/** n reviews in a month with a given average rating (rounded into whole stars), and complaint tags split over low reviews. */
function row(m: number, sku: string, n: number, avg: number, topics: Record<string, number> = {}, pos: Record<string, number> = {}): ReviewRow {
  const rs = Math.round(avg * n);
  const low = Math.max(0, Math.round(n * Math.max(0, Math.min(1, (4.5 - avg) / 2.5))));
  const t: Record<string, number> = {};
  const total = Object.values(topics).reduce((a, b) => a + b, 0) || 1;
  for (const [k, w] of Object.entries(topics)) t[k] = Math.round((w / total) * low);
  return { m, sku, n, rs, low, tagged: Object.values(t).length ? low : 0, t, posN: n - low, pos };
}
const series = (id: string, rev: number) => ({ sku: id, revenue: months.map(() => rev), units: months.map(() => 10), orders: months.map(() => 10), returned: months.map(() => 1) });

const ins: Insights = {
  months,
  skus: [series("STAR", 3000), series("BIG", 2500), series("SMALL", 100), series("OURS", 800), series("FEW", 50), series("MID", 1500)],
  reviewRows: [
    // STAR: steady 4.6 with praise
    ...months.map((_, m) => row(m, "STAR", 12, 4.6, { delivery: 1 }, { quality: 6, value: 5 })),
    // BIG: sliding 3.8 -> 3.0, quality complaints (supplier), big revenue share
    ...months.map((_, m) => row(m, "BIG", 12, 3.8 - m * 0.16, { quality: 9, delivery: 1 })),
    // SMALL: sliding 3.4 -> 2.6, quality complaints, tiny revenue
    ...months.map((_, m) => row(m, "SMALL", 12, 3.4 - m * 0.16, { quality: 9, delivery: 1 })),
    // OURS: sliding, packaging and sizing complaints
    ...months.map((_, m) => row(m, "OURS", 12, 3.7 - m * 0.14, { packaging_damage: 5, sizing_fit: 4 })),
    // FEW: 3 reviews only
    row(5, "FEW", 3, 2.0, { quality: 3 }),
    // MID: okay and flat
    ...months.map((_, m) => row(m, "MID", 12, 3.9, { delivery: 2, price_value: 1 })),
  ],
  quotes: {}, praise: [], dataThrough: { sales: null, reviews: null }, counts: { sales: 1, reviews: 1, skus: 6 },
};

describe("halves and ratingTrend", () => {
  it("splits the period into an early and a late half", () => {
    expect(halves(f)).toEqual({ early: [0, 1, 2], late: [3, 4, 5] });
    expect(halves({ from: 1, to: 3, sku: null })).toEqual({ early: [1], late: [2, 3] });
  });
  it("reports direction and needs enough reviews in each half", () => {
    const t = ratingTrend(ins, { ...f, sku: "BIG" });
    expect(t.direction).toBe("down");
    expect(t.delta!).toBeLessThan(-0.3);
    expect(ratingTrend(ins, { ...f, sku: "STAR" }).direction).toBe("flat");
    expect(ratingTrend(ins, { ...f, sku: "FEW" }).direction).toBe("unknown");
    expect(ratingTrend(ins, { from: 2, to: 2, sku: null }).direction).toBe("unknown");
  });
});

describe("skuMovers", () => {
  it("ranks products by rating points lost, weighted by late reviews", () => {
    const m = skuMovers(ins, f).sort((a, b) => b.impact - a.impact);
    expect(m.slice(0, 3).map((x) => x.sku)).toEqual(expect.arrayContaining(["BIG", "SMALL", "OURS"]));
    expect(m.find((x) => x.sku === "STAR")!.impact).toBeLessThanOrEqual(0.5);
    expect(m.find((x) => x.sku === "FEW")!.delta).toBeNull(); // too few reviews to compare halves
    expect(m.find((x) => x.sku === "BIG")!.monthly).toHaveLength(6);
    expect(m.find((x) => x.sku === "BIG")!.topTheme!.topic).toBe("quality");
  });
});

describe("themePriorities and ownerSplit", () => {
  it("labels who can fix each theme and ranks priority transparently", () => {
    const t = themePriorities(ins, f);
    const q = t.find((x) => x.topic === "quality")!;
    expect(q.owner).toBe("supplier");
    expect(q.priority).toBe("high");
    expect(t.find((x) => x.topic === "packaging_damage")!.owner).toBe("ours");
    expect(t.find((x) => x.topic === "sizing_fit")!.owner).toBe("mixed");
    const split = ownerSplit(t);
    expect(Math.round(split.ours + split.supplier + split.mixed)).toBeGreaterThanOrEqual(99);
    expect(split.supplier).toBeGreaterThan(split.mixed);
  });
  it("is empty when nothing is tagged", () => {
    expect(themePriorities({ ...ins, reviewRows: [] }, f)).toEqual([]);
    expect(ownerSplit([])).toEqual({ ours: 0, supplier: 0, mixed: 0 });
  });
});

describe("skuHealth: keep, fix, escalate or retire", () => {
  const h = Object.fromEntries(skuHealth(ins, f).map((x) => [x.sku, x]));
  it("protects a healthy, stable product", () => expect(h.STAR.verdict).toBe("protect"));
  it("escalates to the supplier instead of retiring when revenue at stake is large", () => {
    expect(h.BIG.verdict).toBe("fix_supplier");
    expect(h.BIG.reasons.join(" ")).toMatch(/revenue/);
  });
  it("suggests retiring or replacing a weak, declining, supplier-side product with little revenue", () => {
    expect(h.SMALL.verdict).toBe("retire");
    expect(h.SMALL.reasons.join(" ")).toMatch(/retiring or replacing/);
  });
  it("says a product is fixable by us when the complaints are about things we control", () => {
    expect(h.OURS.verdict).toBe("fix_ours");
    expect(h.OURS.reasons.join(" ")).toMatch(/size chart/);
  });
  it("refuses a verdict with too few reviews", () => expect(h.FEW.verdict).toBe("not_enough"));
  it("only watches an average product that is not in trouble", () => expect(h.MID.verdict).toBe("watch"));
});

describe("praise and top products", () => {
  it("shows what customers praise and the best-reviewed products", () => {
    const p = praiseThemes(ins, { ...f, sku: "STAR" });
    expect(p[0]).toMatchObject({ key: "quality" });
    expect(p[0].pct).toBeGreaterThan(40);
    expect(praiseThemes({ ...ins, reviewRows: [] }, f)).toEqual([]);
    const top = topProducts(ins, f, 20);
    expect(top[0].sku).toBe("STAR");
    expect(top[0].strengths.map((s) => s.key)).toEqual(["quality", "value"]);
    expect(top.find((x) => x.sku === "FEW")).toBeUndefined();
    // a product with enough reviews overall but too few per half gets "unknown", not a made-up trend
    const thin: Insights = { ...ins, reviewRows: [row(0, "T", 11, 4.5), row(5, "T", 11, 3.0)], skus: [series("T", 100)] };
    expect(topProducts(thin, f, 20, 8).find((x) => x.sku === "T")?.trend).toBe("unknown");
  });
});
