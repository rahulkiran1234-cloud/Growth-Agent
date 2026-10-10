import type { Insights, MonthPoint, PriceEvent } from "./types";

// Pure functions (no database, no React) that turn the aligned arrays into whatever a screen needs,
// for the current period and product filter. Everything is deterministic and unit tested.

export type Filter = { from: number; to: number; sku: string | null };

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const pct = (a: number, b: number) => (b === 0 ? null : ((a - b) / Math.abs(b)) * 100);
const r1 = (v: number) => Math.round(v * 10) / 10;

export function defaultFilter(ins: Insights): Filter {
  return { from: 0, to: Math.max(0, ins.months.length - 1), sku: null };
}

/** Monthly series for the filter. A product filter limits sales and reviews to that product. */
export function monthly(ins: Insights, f: Filter): MonthPoint[] {
  const out: MonthPoint[] = [];
  const skus = f.sku ? ins.skus.filter((s) => s.sku === f.sku) : ins.skus;
  for (let i = f.from; i <= f.to; i++) {
    const revenue = sum(skus.map((s) => s.revenue[i]));
    const units = sum(skus.map((s) => s.units[i]));
    const orders = sum(skus.map((s) => s.orders[i]));
    const returned = sum(skus.map((s) => s.returned[i]));
    const rr = ins.reviewRows.filter((r) => r.m === i && (!f.sku || r.sku === f.sku));
    const n = sum(rr.map((r) => r.n));
    out.push({
      month: ins.months[i], revenue, units, orders,
      price: units > 0 ? revenue / units : null,
      returnRate: orders > 0 ? r1((returned / orders) * 100) : null,
      reviews: n,
      avgRating: n > 0 ? Math.round((sum(rr.map((r) => r.rs)) / n) * 100) / 100 : null,
      lowPct: n > 0 ? r1((sum(rr.map((r) => r.low)) / n) * 100) : null,
    });
  }
  return out;
}

export type ProductRow = { sku: string; revenue: number; units: number; orders: number; share: number; returnRate: number | null; price: number | null; reviews: number; avgRating: number | null; lowPct: number | null; topics: Record<string, number>; lowTagged: number };

/** One row per product over the period, sorted by revenue. */
export function products(ins: Insights, f: Filter): ProductRow[] {
  const total = sum(ins.skus.map((s) => sum(s.revenue.slice(f.from, f.to + 1))));
  return ins.skus.map((s) => {
    const rev = sum(s.revenue.slice(f.from, f.to + 1)), units = sum(s.units.slice(f.from, f.to + 1));
    const orders = sum(s.orders.slice(f.from, f.to + 1)), ret = sum(s.returned.slice(f.from, f.to + 1));
    const rr = ins.reviewRows.filter((r) => r.sku === s.sku && r.m >= f.from && r.m <= f.to);
    const n = sum(rr.map((r) => r.n));
    const topics: Record<string, number> = {};
    for (const r of rr) for (const [t, c] of Object.entries(r.t)) topics[t] = (topics[t] ?? 0) + c;
    return {
      sku: s.sku, revenue: rev, units, orders, share: total > 0 ? r1((rev / total) * 100) : 0,
      returnRate: orders > 0 ? r1((ret / orders) * 100) : null, price: units > 0 ? rev / units : null,
      reviews: n, avgRating: n > 0 ? Math.round((sum(rr.map((r) => r.rs)) / n) * 100) / 100 : null,
      lowPct: n > 0 ? r1((sum(rr.map((r) => r.low)) / n) * 100) : null, topics, lowTagged: sum(rr.map((r) => r.tagged)),
    };
  }).sort((a, b) => b.revenue - a.revenue);
}

export type TopicRow = { topic: string; count: number; pct: number; monthly: number[] };

/** Complaint themes on 1-3 star reviews: share of tagged low reviews, plus the month-by-month share. */
export function topics(ins: Insights, f: Filter): TopicRow[] {
  const rr = ins.reviewRows.filter((r) => r.m >= f.from && r.m <= f.to && (!f.sku || r.sku === f.sku));
  const totalTagged = sum(rr.map((r) => r.tagged));
  const names = [...new Set(rr.flatMap((r) => Object.keys(r.t)))];
  return names.map((topic) => {
    const count = sum(rr.map((r) => r.t[topic] ?? 0));
    const monthlyShare: number[] = [];
    for (let i = f.from; i <= f.to; i++) {
      const mr = rr.filter((r) => r.m === i);
      const tg = sum(mr.map((r) => r.tagged));
      monthlyShare.push(tg > 0 ? r1((sum(mr.map((r) => r.t[topic] ?? 0)) / tg) * 100) : 0);
    }
    return { topic, count, pct: totalTagged > 0 ? r1((count / totalTagged) * 100) : 0, monthly: monthlyShare };
  }).sort((a, b) => b.count - a.count);
}

/** What changed between two periods, split into the part due to volume and the part due to price. */
export function bridge(a: { revenue: number; units: number }, b: { revenue: number; units: number }) {
  if (a.units <= 0 || b.units <= 0) return null;
  const pa = a.revenue / a.units, pb = b.revenue / b.units;
  const volume = (b.units - a.units) * pa;
  const price = (pb - pa) * b.units;
  return { start: a.revenue, volume, price, end: b.revenue, total: b.revenue - a.revenue };
}

const EVENT_MIN_MOVE_PCT = 3;

/**
 * Detects price changes (>= 3% month on month) and reports the plain before/after impact.
 * Elasticity (% change in units per % change in price) is only returned when there are at least 2
 * months on each side; confidence is "medium" with 3+ months each side, otherwise "low".
 */
export function priceEvents(series: Pick<MonthPoint, "month" | "revenue" | "units">[]): PriceEvent[] {
  const pts = series.map((s) => ({ ...s, price: s.units > 0 ? s.revenue / s.units : null }));
  const idx: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1].price, b = pts[i].price;
    if (a != null && b != null && Math.abs((b / a - 1) * 100) >= EVENT_MIN_MOVE_PCT) idx.push(i);
  }
  const seg = (from: number, to: number) => {
    const s = pts.slice(from, to + 1).filter((p) => p.units > 0);
    const units = sum(s.map((p) => p.units)), revenue = sum(s.map((p) => p.revenue));
    return { n: s.length, price: units > 0 ? revenue / units : 0, units: s.length ? units / s.length : 0, revenue: s.length ? revenue / s.length : 0 };
  };
  return idx.map((i, k) => {
    const before = seg(k > 0 ? idx[k - 1] : 0, i - 1);
    const after = seg(i, k + 1 < idx.length ? idx[k + 1] - 1 : pts.length - 1);
    const pricePct = pct(after.price, before.price) ?? 0;
    const unitsPct = pct(after.units, before.units);
    const enough = before.n >= 2 && after.n >= 2 && Math.abs(pricePct) >= EVENT_MIN_MOVE_PCT && unitsPct != null;
    return {
      month: pts[i].month, index: i, priceBefore: before.price, priceAfter: after.price, pricePct: r1(pricePct),
      unitsBefore: before.units, unitsAfter: after.units, unitsPct: unitsPct == null ? null : r1(unitsPct),
      revenueBefore: before.revenue, revenueAfter: after.revenue, revenuePct: (() => { const v = pct(after.revenue, before.revenue); return v == null ? null : r1(v); })(),
      monthsBefore: before.n, monthsAfter: after.n,
      elasticity: enough ? Math.round((unitsPct! / pricePct) * 100) / 100 : null,
      confidence: enough ? (before.n >= 3 && after.n >= 3 ? "medium" : "low") : null,
    };
  });
}

/** What happened to units after a price change, in three plain buckets (within 5% counts as "stayed about the same"). */
export function salesVerdict(e: Pick<PriceEvent, "unitsPct">): { kind: "up" | "flat" | "down" | "unknown"; label: string } {
  if (e.unitsPct == null) return { kind: "unknown", label: "Not enough sales to tell" };
  if (e.unitsPct >= 5) return { kind: "up", label: "Sales went up" };
  if (e.unitsPct <= -5) return { kind: "down", label: "Sales went down" };
  return { kind: "flat", label: "Sales stayed about the same" };
}

/** Every price change found across products (or one product), biggest price move first. */
export function allProductEvents(ins: Insights, f: Filter): { sku: string; e: PriceEvent }[] {
  const skus = f.sku ? ins.skus.filter((s) => s.sku === f.sku) : ins.skus;
  return skus.flatMap((s) => {
    const series = ins.months.slice(f.from, f.to + 1).map((m, k) => ({ month: m, revenue: s.revenue[f.from + k], units: s.units[f.from + k] }));
    return priceEvents(series).map((e) => ({ sku: s.sku, e }));
  }).sort((a, b) => Math.abs(b.e.pricePct) - Math.abs(a.e.pricePct));
}

/** Plain-language reading of an event. Never claims causation. */
export function readEvent(e: PriceEvent): { tone: "good" | "warn" | "neutral"; text: string } {
  const v = salesVerdict(e);
  if (v.kind === "unknown") return { tone: "neutral", text: "Not enough sales around this change to read it." };
  const cut = e.pricePct < 0;
  if (cut) {
    if (v.kind === "up") return { tone: "good", text: "Sales went up after the price cut." };
    if (v.kind === "flat") return { tone: "warn", text: "Sales stayed about the same after the price cut, so the cut did not bring more customers." };
    return { tone: "warn", text: "Sales went down after the price cut, so price alone does not explain sales here." };
  }
  if (v.kind === "down") return { tone: "warn", text: "Sales went down after the price rise." };
  return { tone: "good", text: v.kind === "up" ? "Sales went up even after the price rise." : "Sales held steady after the price rise." };
}

/** Compact number: 727577 -> "727.6k". */
export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (a >= 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return Math.round(v).toLocaleString("en-US");
}

export const num = (v: number) => Math.round(v).toLocaleString("en-US");
export const signed = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
export const monthLabel = (m: string) => ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m.slice(5, 7)) - 1] + (m.slice(2, 4) !== String(new Date().getFullYear()).slice(2) ? ` ${m.slice(2, 4)}` : "");
export const pctChange = pct;
