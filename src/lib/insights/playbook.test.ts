import { describe, expect, it } from "vitest";
import { skuPlaybook } from "./playbook";
import { computeAds, type AdDay } from "./ads";
import type { Insights, ReviewRow } from "./types";
import type { TrackedProduct } from "./tracker";

const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
function row(m: number, sku: string, n: number, avg: number, topics: Record<string, number> = {}): ReviewRow {
  const rs = Math.round(avg * n);
  const low = Math.max(0, Math.round(n * Math.max(0, Math.min(1, (4.5 - avg) / 2.5))));
  const t: Record<string, number> = {};
  const total = Object.values(topics).reduce((a, b) => a + b, 0) || 1;
  for (const [k, w] of Object.entries(topics)) t[k] = Math.round((w / total) * low);
  return { m, sku, n, rs, low, tagged: Object.values(t).length ? low : 0, t, posN: n - low, pos: {} };
}
const flat = (id: string, price: number, units: number[]) => ({ sku: id, revenue: units.map((u) => u * price), units, orders: units, returned: units.map(() => 0) });

const ins: Insights = {
  months,
  skus: [
    flat("OURS", 100, [60, 60, 60, 60, 60, 60]),                // reviews we can fix
    flat("SUPP", 100, [60, 60, 60, 60, 60, 60]),                // supplier quality problem
    flat("PRICEY", 150, [100, 100, 100, 100, 70, 60]),          // dear against a competitor and falling
    flat("CHEAP", 80, [50, 50, 50, 50, 50, 50]),                // cheap, loved: room to raise
    flat("RISE", 100, [100, 100, 100, 100, 100, 100]),
    flat("QUIET", 100, [40, 40, 40, 40, 20, 18]),               // falling, nothing else wrong
    flat("FINE", 100, [50, 50, 50, 50, 50, 50]),                // nothing to do
  ],
  reviewRows: [
    ...months.map((_, m) => row(m, "OURS", 12, 3.6 - m * 0.12, { packaging_damage: 6, delivery: 3 })),
    ...months.map((_, m) => row(m, "SUPP", 12, 3.4 - m * 0.1, { quality: 9, delivery: 1 })),
    ...months.map((_, m) => row(m, "CHEAP", 12, 4.6)),
    ...months.map((_, m) => row(m, "PRICEY", 12, 4.0)),
  ],
  quotes: {}, praise: [], dataThrough: { sales: null, reviews: null }, counts: { sales: 1, reviews: 1, skus: 7 },
};
// RISE: its price went up in July and units fell afterwards
ins.skus[4] = { sku: "RISE", revenue: [100, 100, 100, 130, 120, 120].map((r, i) => r * [100, 100, 100, 80, 70, 70][i] / 100 * 1), units: [100, 100, 100, 80, 70, 70], orders: [100, 100, 100, 80, 70, 70], returned: [0, 0, 0, 0, 0, 0] };
ins.skus[4].revenue = [10000, 10000, 10000, 10400, 9100, 9100];

const comp = (sku: string, price: number): TrackedProduct => ({ competitor: "Rival", product: "R", category: null, comparableSku: sku, dataType: null, series: [{ date: "2026-09-29", price, discount: null, rating: null, totalReviews: null, newReviews: null, stock: null, promo: null }] });
const tracked = [comp("PRICEY", 100), comp("CHEAP", 100)];

const play = skuPlaybook({ ins, tracked });
const one = (sku: string) => play.find((p) => p.sku === sku);

describe("skuPlaybook", () => {
  it("tells you to fix reviews you control, with a week-1 task and a week-4 re-check", () => {
    const p = one("OURS")!;
    expect(p.issues.some((i) => i.area === "reviews" && i.severity === "high")).toBe(true);
    expect(p.steps.find((s) => s.area === "reviews")).toMatchObject({ week: 1 });
    expect(p.steps.some((s) => s.week === 4 && s.area === "reviews")).toBe(true);
  });
  it("sends product-quality problems to the supplier and holds reorders", () => {
    const p = one("SUPP")!;
    expect(p.steps.map((s) => s.text).join(" ")).toMatch(/supplier/i);
  });
  it("suggests a lower price when a SKU is dear against its competitor and units are falling, naming the price to test", () => {
    const p = one("PRICEY")!;
    const issue = p.issues.find((i) => i.area === "price")!;
    expect(issue.severity).toBe("high");
    expect(issue.text).toMatch(/50% above Rival/);
    const step = p.steps.find((s) => s.area === "price" && s.week === 2)!;
    expect(step.text).toMatch(/Test lowering PRICEY from about 150 to about 125/);
  });
  it("suggests a small price rise for a cheap, well-rated SKU", () => {
    const step = one("CHEAP")!.steps.find((s) => s.area === "price")!;
    expect(step.text).toMatch(/raising CHEAP by about 4%/);
  });
  it("flags a price rise that was followed by lower units, without claiming it caused them", () => {
    const p = one("RISE")!;
    const issue = p.issues.find((i) => i.area === "price")!;
    expect(issue.text).toMatch(/moved together/);
    expect(issue.text).not.toMatch(/because|caused/);
    expect(p.steps.some((s) => /back toward/.test(s.text))).toBe(true);
  });
  it("checks stock and listing when units fall for no visible reason", () => {
    const p = one("QUIET")!;
    expect(p.issues[0].area).toBe("sales");
    expect(p.steps[0].text).toMatch(/stock-outs/);
  });
  it("says nothing about a SKU that is fine", () => expect(one("FINE")).toBeUndefined());
  it("ranks bigger problems on bigger SKUs first", () => {
    const order = play.map((p) => p.sku);
    expect(order.indexOf("PRICEY")).toBeLessThan(order.indexOf("QUIET"));
  });
  it("steps come out in week order", () => {
    for (const p of play) expect(p.steps.map((s) => s.week)).toEqual([...p.steps.map((s) => s.week)].sort());
  });
});

describe("skuPlaybook with ads", () => {
  const day = (i: number) => new Date(Date.UTC(2026, 6, 1) + i * 864e5).toISOString().slice(0, 10);
  const adDays = (sku: string, spend: number, acos: number, rev: number): AdDay[] => Array.from({ length: 56 }, (_, i) => ({ d: day(i), sku, imp: 2000, clk: 20, spend, ord: 3, units: 3, sales: spend / acos, rev, su: rev / 100 }));
  const days = [...adDays("OURS", 200, 0.12, 5000), ...adDays("FINE", 200, 0.45, 4000)];
  const ads = computeAds({ days, unitProfit: { OURS: 30, FINE: 30 } })!;
  const p2 = skuPlaybook({ ins, tracked, ads });
  it("adds the ads steps for a SKU whose ads are losing money", () => {
    const fine = p2.find((p) => p.sku === "FINE")!;
    expect(fine.issues.some((i) => i.area === "ads")).toBe(true);
    expect(fine.steps.some((s) => s.area === "ads" && /Cut FINE/.test(s.text))).toBe(true);
  });
  it("holds back raising ads on a SKU whose reviews must be fixed first", () => {
    const ours = p2.find((p) => p.sku === "OURS")!;
    expect(ours.steps.some((s) => s.area === "ads" && /Hold off raising/.test(s.text))).toBe(true);
    expect(ours.steps.some((s) => s.area === "ads" && /^Raise /.test(s.text))).toBe(false);
  });
});
