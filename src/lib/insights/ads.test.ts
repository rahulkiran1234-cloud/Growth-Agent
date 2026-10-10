import { describe, expect, it } from "vitest";
import { adsActions, adsChatContext, computeAds, recentRatings, type AdDay } from "./ads";

const start = Date.UTC(2026, 6, 1);
const date = (i: number) => new Date(start + i * 864e5).toISOString().slice(0, 10);

/** n days of steady ads: `spend`/day, ad sales = spend / acos, total sales add `organic`/day. */
function series(sku: string, o: { n?: number; spend: number; acos: number; clicks?: number; cvr?: number; price?: number; organic?: number; from?: number }): AdDay[] {
  const price = o.price ?? 1000;
  return Array.from({ length: o.n ?? 56 }, (_, i) => {
    const sales = o.spend / o.acos;
    const clk = o.clicks ?? Math.round(o.spend / 10);
    const orders = o.cvr != null ? clk * o.cvr : sales / price;
    return { d: date((o.from ?? 0) + i), sku, imp: clk * 80, clk, spend: o.spend, ord: orders, units: orders, sales, rev: sales + (o.organic ?? 0), su: (sales + (o.organic ?? 0)) / price };
  });
}
const pick = (m: ReturnType<typeof computeAds>, sku: string) => m!.skus.find((s) => s.sku === sku)!;
const profit300 = { A: 300, B: 300, C: 300, D: 300, E: 300 }; // 30% of a 1000 price: break-even ACOS 30%

describe("computeAds verdicts", () => {
  const days = [
    ...series("A", { spend: 200, acos: 0.15, organic: 400 }),                 // well under break-even
    ...series("B", { spend: 200, acos: 0.28, organic: 400 }),                 // thin margin
    ...series("C", { spend: 200, acos: 0.45, organic: 400, cvr: 0.04 }),      // over break-even, converts fine
    ...series("D", { spend: 200, acos: 0.9, organic: 400, cvr: 0.004, clicks: 25 }), // clicks but nobody buys
    ...series("E", { n: 5, spend: 20, acos: 0.2 }),                           // barely any data
  ];
  const m = computeAds({ days, unitProfit: profit300 })!;

  it("spends more on a SKU well under break-even", () => {
    const a = pick(m, "A");
    expect(a.verdict).toBe("scale");
    expect(a.status).toBe("under");
    expect(a.breakEvenAcos).toBeCloseTo(0.3, 2);
    expect(a.changePct).toBeGreaterThan(0);
  });
  it("holds a SKU that only just pays for itself", () => expect(pick(m, "B").verdict).toBe("hold"));
  it("cuts a SKU whose ads cost more than they earn", () => {
    const c = pick(m, "C");
    expect(c.verdict).toBe("cut");
    expect(c.status).toBe("over");
    expect(c.wasted).toBeGreaterThan(0);
    expect(c.dailyNext).toBeLessThan(c.dailyNow);
  });
  it("tells you to fix the page when clicks do not convert, instead of just cutting", () => {
    const d = pick(m, "D");
    expect(d.verdict).toBe("fix_first");
    expect(d.reasons.join(" ")).toMatch(/click but few buy/);
  });
  it("refuses to judge a SKU with too few clicks", () => {
    const e = pick(m, "E");
    expect(e.verdict).toBe("too_little");
    expect(e.status).toBe("unknown");
    expect(e.changePct).toBe(0);
  });
  it("moves money from the cuts to the SKUs that earn it back, never spending more than was freed", () => {
    expect(m.plan.freed).toBeGreaterThan(0);
    expect(m.plan.added).toBeLessThanOrEqual(m.plan.freed + 1e-9);
    expect(m.plan.dailyNext).toBeLessThanOrEqual(m.plan.dailyNow + 1e-9);
    expect(m.plan.extraSalesHigh).toBeGreaterThanOrEqual(m.plan.extraSalesLow);
  });
});

describe("computeAds money logic", () => {
  it("uses the seller's per-unit profit for break-even, and says when it is only assumed", () => {
    const days = series("A", { spend: 200, acos: 0.2, organic: 400 });
    const entered = pick(computeAds({ days, unitProfit: { A: 500 } }), "A");
    expect(entered.profitSource).toBe("entered");
    expect(entered.breakEvenAcos).toBeCloseTo(0.5, 2);
    const assumed = pick(computeAds({ days }), "A");
    expect(assumed.profitSource).toBe("assumed");
    expect(assumed.breakEvenAcos).toBeCloseTo(0.3, 2);
    expect(computeAds({ days })!.missingProfit).toEqual(["A"]);
  });
  it("a higher profit per unit can turn a cut into a keep", () => {
    const days = series("A", { spend: 200, acos: 0.45, organic: 400, cvr: 0.04 });
    expect(pick(computeAds({ days, unitProfit: { A: 300 } }), "A").verdict).toBe("cut");
    expect(pick(computeAds({ days, unitProfit: { A: 600 } }), "A").verdict).not.toBe("cut");
  });
  it("computes ACOS, ROAS, TACoS and wasted spend from the recent four weeks", () => {
    const a = pick(computeAds({ days: series("A", { spend: 200, acos: 0.5, organic: 800 }), unitProfit: { A: 300 } }), "A");
    expect(a.acos).toBeCloseTo(0.5, 5);
    expect(a.roas).toBeCloseTo(2, 5);
    expect(a.tacos).toBeCloseTo(200 / (400 + 800), 5);   // spend / ALL sales
    expect(a.adShare).toBeCloseTo(400 / 1200, 5);
    expect(a.wasted).toBeCloseTo(28 * (200 - 400 * 0.3), 0); // spend above what break-even allows
    expect(a.recent.spend).toBe(28 * 200);
  });
  it("does not advertise a SKU with a poor recent rating, even if the ads look fine", () => {
    const m = computeAds({ days: series("A", { spend: 200, acos: 0.1, organic: 100 }), unitProfit: { A: 300 }, ratings: { A: { rs: 3.2 * 40, n: 40 } } });
    expect(pick(m, "A").verdict).toBe("dont_advertise");
    expect(pick(m, "A").reasons[0]).toMatch(/3\.2/);
  });
  it("ignores a rating built on too few reviews", () => {
    const m = computeAds({ days: series("A", { spend: 200, acos: 0.1, organic: 100 }), unitProfit: { A: 300 }, ratings: { A: { rs: 3 * 5, n: 5 } } });
    expect(pick(m, "A").verdict).toBe("scale");
  });
  it("holds instead of scaling when more spend is already getting less in return", () => {
    const days = [...series("A", { n: 28, spend: 100, acos: 0.1, organic: 100, from: 0 }), ...series("A", { n: 28, spend: 200, acos: 0.2, organic: 100, from: 28 })];
    const a = pick(computeAds({ days, unitProfit: { A: 300 } }), "A");
    expect(a.verdict).toBe("hold");
    expect(a.reasons.join(" ")).toMatch(/already buying less/);
  });
  it("flags a price gap to the comparable competitor", () => {
    const tracked = [{ competitor: "Rival", product: "R1", category: null, comparableSku: "A", dataType: null, series: [{ date: "2026-08-30", price: 700, discount: null, rating: null, totalReviews: null, newReviews: null, stock: null, promo: null }] }];
    const m = computeAds({ days: series("A", { spend: 200, acos: 0.6, organic: 300, cvr: 0.004, clicks: 25 }), unitProfit: { A: 300 }, tracked });
    expect(pick(m, "A").priceGap?.pct).toBeCloseTo(1000 / 700 - 1, 2);
    expect(pick(m, "A").reasons.join(" ")).toMatch(/above Rival/);
  });
});

describe("computeAds data handling", () => {
  it("returns null with no ads data", () => {
    expect(computeAds({ days: [] })).toBeNull();
    expect(computeAds({ days: [{ d: "2026-07-01", sku: "A", imp: 0, clk: 0, spend: 0, ord: 0, units: 0, sales: 0, rev: 50, su: 1 }] })).toBeNull();
  });
  it("warns when ad SKUs match nothing in the sales file", () => {
    const days = series("A", { spend: 100, acos: 0.3 }).map((d) => ({ ...d, rev: 0, su: 0 }));
    const m = computeAds({ days })!;
    expect(m.warnings.join(" ")).toMatch(/match a SKU in the sales file/);
    expect(m.totals.tacos).toBeNull();
  });
  it("warns about short history", () => expect(computeAds({ days: series("A", { n: 10, spend: 100, acos: 0.3 }) })!.warnings.join(" ")).toMatch(/Only 10 days/));
  it("builds weekly series that add up to the totals", () => {
    const m = computeAds({ days: series("A", { n: 56, spend: 100, acos: 0.25, organic: 100 }) })!;
    expect(m.weeks.reduce((a, w) => a + w.spend, 0)).toBe(56 * 100);
    expect(m.weeks.every((w) => w.week.length === 10)).toBe(true);
  });
  it("sums recent ratings only for the last three months", () => {
    const r = recentRatings([{ m: 0, sku: "A", n: 10, rs: 10 }, { m: 3, sku: "A", n: 10, rs: 40 }, { m: 5, sku: "A", n: 10, rs: 45 }, { m: 5, sku: null, n: 9, rs: 9 }], 6);
    expect(r).toEqual({ A: { n: 20, rs: 85 } });
  });
});

describe("adsActions (the ad part of the 30-day plan)", () => {
  const days = [
    ...series("A", { spend: 200, acos: 0.15, organic: 400 }),
    ...series("C", { spend: 200, acos: 0.45, organic: 400, cvr: 0.04 }),
    ...series("D", { spend: 200, acos: 0.9, organic: 400, cvr: 0.004, clicks: 25 }),
  ];
  const m = computeAds({ days, unitProfit: { A: 300, C: 300, D: 300 } })!;
  const acts = adsActions(m);
  it("cuts in week 1, raises in week 2, and ends with a re-check in week 4", () => {
    expect(acts.find((a) => a.sku === "C")).toMatchObject({ week: 1, kind: "cut" });
    expect(acts.find((a) => a.sku === "D" && a.kind === "fix")?.week).toBe(1);
    expect(acts.find((a) => a.sku === "D" && a.kind === "check")?.week).toBe(3);
    expect(acts.find((a) => a.sku === "A")).toMatchObject({ week: 2, kind: "raise" });
    expect(acts.at(-1)).toMatchObject({ week: 4, kind: "check" });
    expect(acts.map((a) => a.week)).toEqual([...acts.map((a) => a.week)].sort());
  });
  it("states the budgets it asks for", () => expect(acts.find((a) => a.sku === "C")!.text).toMatch(/from [\d,]+ to [\d,]+ a month/));
  it("asks for profit per unit first when it is only assumed", () => {
    const a = adsActions(computeAds({ days })!);
    expect(a[0]).toMatchObject({ week: 1, kind: "setup" });
  });
  it("gives the chat whole-number percents and per-SKU reasons", () => {
    const c = adsChatContext(m).ads_advice;
    expect(c.skus.find((s) => s.sku === "A")).toMatchObject({ acos_pct: 15, break_even_acos_pct: 30, advice: "Spend more" });
    expect(c.skus.every((s) => s.reasons.length > 0)).toBe(true);
  });
});
