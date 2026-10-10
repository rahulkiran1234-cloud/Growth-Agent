import { describe, expect, it } from "vitest";
import { allProductEvents, bridge, compact, defaultFilter, monthly, priceEvents, products, readEvent, salesVerdict, topics } from "./aggregate";
import type { Insights } from "./types";

const ins: Insights = {
  months: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
  skus: [
    { sku: "A", revenue: [150, 150, 150, 150, 85, 80], units: [100, 100, 100, 100, 65, 62], orders: [10, 10, 10, 10, 6, 6], returned: [1, 1, 1, 1, 1, 1] },
    { sku: "B", revenue: [50, 50, 50, 50, 50, 50], units: [50, 50, 50, 50, 50, 50], orders: [5, 5, 5, 5, 5, 5], returned: [0, 0, 0, 0, 0, 1] },
  ],
  reviewRows: [
    { m: 0, sku: "A", n: 10, rs: 40, low: 3, tagged: 3, t: { sizing_fit: 2, quality: 1 }, posN: 7, pos: {} },
    { m: 5, sku: "A", n: 10, rs: 30, low: 5, tagged: 5, t: { sizing_fit: 4, quality: 1 }, posN: 5, pos: {} },
    { m: 5, sku: "B", n: 10, rs: 45, low: 1, tagged: 1, t: { quality: 1 }, posN: 9, pos: {} },
  ],
  quotes: {}, praise: [], dataThrough: { sales: "2026-09-30", reviews: "2026-09-30" }, counts: { sales: 1, reviews: 1, skus: 2 },
};

describe("monthly", () => {
  it("sums products and derives rates", () => {
    const m = monthly(ins, defaultFilter(ins));
    expect(m).toHaveLength(6);
    expect(m[0]).toMatchObject({ revenue: 200, units: 150, orders: 15, returnRate: 6.7, reviews: 10, avgRating: 4, lowPct: 30 });
    expect(m[5].reviews).toBe(20);
    expect(m[1].avgRating).toBeNull(); // no reviews that month
  });
  it("respects period and product", () => {
    const m = monthly(ins, { from: 3, to: 5, sku: "A" });
    expect(m.map((x) => x.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(m[1].price).toBeCloseTo(85 / 65);
  });
});

describe("products and topics", () => {
  it("ranks products and shares by revenue", () => {
    const p = products(ins, defaultFilter(ins));
    expect(p.map((x) => x.sku)).toEqual(["A", "B"]);
    expect(p[0].share + p[1].share).toBeGreaterThan(99.8);
    expect(p[0].returnRate).toBe(Math.round(((6 / 52) * 100) * 10) / 10);
  });
  it("computes theme share of tagged low reviews", () => {
    const t = topics(ins, defaultFilter(ins));
    expect(t[0]).toMatchObject({ topic: "sizing_fit", count: 6 });
    expect(t[0].pct).toBeCloseTo((6 / 9) * 100, 0);
    expect(topics(ins, { from: 5, to: 5, sku: "B" })).toEqual([{ topic: "quality", count: 1, pct: 100, monthly: [100] }]);
  });
});

describe("bridge", () => {
  it("splits a revenue change into volume and price effects that add up", () => {
    const b = bridge({ revenue: 881072, units: 837 }, { revenue: 727577, units: 723 })!;
    expect(b.volume + b.price).toBeCloseTo(727577 - 881072, 6);
    expect(b.volume).toBeLessThan(b.price * -3); // volume drove most of the fall
  });
  it("returns null without sales on either side", () => {
    expect(bridge({ revenue: 0, units: 0 }, { revenue: 5, units: 1 })).toBeNull();
  });
});

describe("priceEvents", () => {
  const series = (rev: number[], units: number[]) => rev.map((r, i) => ({ month: `2026-0${i + 1}`, revenue: r, units: units[i] }));
  it("finds a price cut and reports plain before/after impact", () => {
    const e = priceEvents(series([150, 150, 150, 150, 85, 80], [100, 100, 100, 100, 65, 62]));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ month: "2026-05", monthsBefore: 4, monthsAfter: 2 });
  });
  it("gives elasticity only with 2+ months each side, and low confidence under 3 after", () => {
    const e = priceEvents(series([150000, 150000, 150000, 150000, 1319 * 65, 1319 * 62], [100, 100, 100, 100, 65, 62]))[0];
    expect(e.pricePct).toBeCloseTo(-12, 0);
    expect(e.unitsPct).toBeCloseTo(-36.5, 0);
    expect(e.elasticity).toBeGreaterThan(2);
    expect(e.confidence).toBe("low");
    const thin = priceEvents(series([150000, 150000, 150000, 1319 * 65], [100, 100, 100, 65]))[0];
    expect(thin.monthsAfter).toBe(1);
    expect(thin.elasticity).toBeNull();
    expect(thin.unitsPct).toBeCloseTo(-35, 0); // plain before/after is still reported
  });
  it("is medium confidence with 3+ months on each side", () => {
    const e = priceEvents(series([100, 100, 100, 90, 90, 90], [10, 10, 10, 12, 12, 12]))[0];
    expect(e.confidence).toBe("medium");
    expect(readEvent(e).tone).toBe("good");
  });
  it("ignores moves under 3%", () => {
    expect(priceEvents(series([100, 101, 100, 102], [10, 10, 10, 10]))).toEqual([]);
  });
  it("reads a cut that did not lift volume as a warning, not a cause", () => {
    const e = priceEvents(series([150000, 150000, 150000, 1319 * 65, 1319 * 60], [100, 100, 100, 65, 60]))[0];
    expect(readEvent(e).tone).toBe("warn");
    expect(readEvent(e).text).not.toMatch(/caus/i);
  });
});

describe("salesVerdict: did sales go up, stay the same, or go down?", () => {
  it("buckets units change with a 5% dead band", () => {
    expect(salesVerdict({ unitsPct: 12 }).label).toBe("Sales went up");
    expect(salesVerdict({ unitsPct: 3 }).label).toBe("Sales stayed about the same");
    expect(salesVerdict({ unitsPct: -4.9 }).label).toBe("Sales stayed about the same");
    expect(salesVerdict({ unitsPct: -35 }).label).toBe("Sales went down");
    expect(salesVerdict({ unitsPct: null }).kind).toBe("unknown");
  });
  it("the 10 to 8 example: a 20% cut with flat units is a warning, with higher units is good", () => {
    const flat = priceEvents([100, 100, 100, 80, 80, 80].map((p, i) => ({ month: `2026-0${i + 1}`, revenue: p * 50, units: 50 })))[0];
    expect(flat.pricePct).toBe(-20);
    expect(readEvent(flat).tone).toBe("warn");
    expect(readEvent(flat).text).toMatch(/stayed about the same/);
    const up = priceEvents([100, 100, 100, 80, 80, 80].map((p, i) => ({ month: `2026-0${i + 1}`, revenue: p * (i < 3 ? 50 : 70), units: i < 3 ? 50 : 70 })))[0];
    expect(salesVerdict(up).kind).toBe("up");
    expect(readEvent(up).tone).toBe("good");
  });
  it("finds the same events across products, biggest price move first", () => {
    const evs = allProductEvents(ins, defaultFilter(ins));
    expect(evs.map((x) => x.sku)).toEqual(["A"]);
    expect(allProductEvents(ins, { ...defaultFilter(ins), sku: "B" })).toEqual([]);
  });
});

describe("compact", () => {
  it("shortens big numbers", () => {
    expect(compact(727577)).toBe("727.6k");
    expect(compact(1250000)).toBe("1.25M");
    expect(compact(950)).toBe("950");
  });
});
