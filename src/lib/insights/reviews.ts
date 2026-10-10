import { products, type Filter, type ProductRow } from "./aggregate";
import type { Insights } from "./types";

// Decision support for the Reviews screen. Everything is a transparent rule over the seller's own numbers:
// no model is involved, and every threshold is a named constant that the screen explains.

/** Who can fix a complaint theme. A rule of thumb per theme, not a judgement about each review. */
export type Owner = "ours" | "supplier" | "mixed";
export const THEME_OWNER: Record<string, { owner: Owner; area: string; hint: string }> = {
  sizing_fit: { owner: "mixed", area: "Listing and product", hint: "Check your size chart and photos first; if they are right, the product pattern may be off." },
  packaging_damage: { owner: "ours", area: "Packing and shipping", hint: "Upgrade packaging and check how orders are handed to the courier." },
  delivery: { owner: "ours", area: "Logistics", hint: "Review courier performance and promised delivery times." },
  customer_support: { owner: "ours", area: "Customer service", hint: "Reply faster and resolve issues before the review is written." },
  price_value: { owner: "ours", area: "Pricing and positioning", hint: "Check the price against what the product delivers and what rivals charge." },
  quality: { owner: "supplier", area: "Manufacturing", hint: "Raise with the supplier; add incoming-batch checks." },
  other: { owner: "mixed", area: "Unclassified", hint: "Read the examples to see what customers mean." },
};
export const ownerOf = (topic: string) => THEME_OWNER[topic] ?? THEME_OWNER.other;
export const OWNER_LABEL: Record<Owner, string> = { ours: "We can fix", supplier: "Supplier / product", mixed: "Check first" };

/** Keyword buckets for what customers praise in 4-5 star reviews (the AI topic tags cover 1-3 star reviews only). */
export const POSITIVE_THEMES: Record<string, { label: string; re: string; keep: string }> = {
  quality: { label: "Quality", re: "quality|durable|sturdy|well made|well-made|solid", keep: "Hold supplier quality steady; sample-check every batch." },
  looks: { label: "Looks & design", re: "look|design|premium|beautiful|stylish|colou?r", keep: "Keep listing photos true to what you ship." },
  value: { label: "Value for money", re: "value|worth|affordable|bargain", keep: "Avoid price rises that are not matched by added value." },
  as_described: { label: "Matches the listing", re: "as described|as pictured|exactly as|matches", keep: "Keep titles, sizes and details accurate and current." },
  delivery: { label: "Fast delivery", re: "deliver|fast|quick|arrived|on time", keep: "Protect your dispatch time and watch courier delays." },
  fit: { label: "Fit & size", re: "true to size|fits|fit |comfortable", keep: "Keep the size guide accurate." },
  packaging: { label: "Packaging", re: "packag|packed|well-packed", keep: "Keep the packaging specification as it is." },
  support: { label: "Service", re: "support|service|helpful|replied", keep: "Keep reply times short." },
};

// Thresholds (shown to the user on the screen).
export const MIN_REVIEWS_FOR_VERDICT = 15;
export const MIN_REVIEWS_PER_HALF = 12;
export const SMALL_SAMPLE = 40;
export const PROTECT_RATING = 4.2;
export const WEAK_RATING = 3.4;
export const HIGH_LOW_SHARE = 40;
export const BIG_DROP = 0.3;
export const BIG_REVENUE_SHARE = 10;

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Months of the filter split into an early and a late half (the middle month of an odd span goes to the late half). */
export function halves(f: Filter): { early: number[]; late: number[] } {
  const idx = Array.from({ length: f.to - f.from + 1 }, (_, i) => f.from + i);
  const cut = Math.floor(idx.length / 2);
  return { early: idx.slice(0, cut), late: idx.slice(cut) };
}

type Agg = { n: number; avg: number | null; lowPct: number | null };
function agg(ins: Insights, months: number[], sku: string | null): Agg {
  const rr = ins.reviewRows.filter((r) => months.includes(r.m) && (!sku || r.sku === sku));
  const n = sum(rr.map((r) => r.n));
  return { n, avg: n > 0 ? r2(sum(rr.map((r) => r.rs)) / n) : null, lowPct: n > 0 ? r1((sum(rr.map((r) => r.low)) / n) * 100) : null };
}

export type RatingTrend = { direction: "up" | "down" | "flat" | "unknown"; early: number | null; late: number | null; delta: number | null; earlyLow: number | null; lateLow: number | null };

/** Is the average rating going up or down? Compares the early half of the period with the late half. */
export function ratingTrend(ins: Insights, f: Filter): RatingTrend {
  const { early, late } = halves(f);
  const a = agg(ins, early, f.sku), b = agg(ins, late, f.sku);
  if (a.avg == null || b.avg == null || a.n < MIN_REVIEWS_PER_HALF || b.n < MIN_REVIEWS_PER_HALF) return { direction: "unknown", early: a.avg, late: b.avg, delta: null, earlyLow: a.lowPct, lateLow: b.lowPct };
  const delta = r2(b.avg - a.avg);
  return { direction: delta >= 0.05 ? "up" : delta <= -0.05 ? "down" : "flat", early: a.avg, late: b.avg, delta, earlyLow: a.lowPct, lateLow: b.lowPct };
}

export type Mover = { sku: string; reviews: number; early: number | null; late: number | null; delta: number | null; lowLate: number | null; impact: number; monthly: (number | null)[]; topTheme: { topic: string; pct: number } | null };

/** Which products moved ratings. `impact` = rating points lost x late-half reviews, so busy products that slip rank first. */
export function skuMovers(ins: Insights, f: Filter): Mover[] {
  const { early, late } = halves(f);
  const months = Array.from({ length: f.to - f.from + 1 }, (_, i) => f.from + i);
  return ins.skus.map((s) => {
    const a = agg(ins, early, s.sku), b = agg(ins, late, s.sku), all = agg(ins, months, s.sku);
    const ok = a.n >= MIN_REVIEWS_PER_HALF && b.n >= MIN_REVIEWS_PER_HALF && a.avg != null && b.avg != null;
    const delta = ok ? r2(b.avg! - a.avg!) : null;
    const monthly = months.map((m) => { const x = agg(ins, [m], s.sku); return x.n >= 3 ? x.avg : null; });
    const tops = themeShares(ins, months, s.sku);
    return { sku: s.sku, reviews: all.n, early: a.avg, late: b.avg, delta, lowLate: b.lowPct, impact: delta == null ? 0 : r2(-delta * b.n), monthly, topTheme: tops[0] ? { topic: tops[0].topic, pct: tops[0].pct } : null };
  }).filter((m) => m.reviews > 0);
}

function themeShares(ins: Insights, months: number[], sku: string | null) {
  const rr = ins.reviewRows.filter((r) => months.includes(r.m) && (!sku || r.sku === sku));
  const tagged = sum(rr.map((r) => r.tagged));
  const names = [...new Set(rr.flatMap((r) => Object.keys(r.t)))];
  return names.map((topic) => ({ topic, count: sum(rr.map((r) => r.t[topic] ?? 0)), pct: tagged > 0 ? r1((sum(rr.map((r) => r.t[topic] ?? 0)) / tagged) * 100) : 0 })).sort((x, y) => y.count - x.count);
}

export type Priority = "high" | "medium" | "low";
export type ThemeRow = { topic: string; count: number; pct: number; earlyPct: number; latePct: number; change: number; owner: Owner; area: string; hint: string; priority: Priority; why: string };

/** Complaint groups ranked for action. High = big and not falling, or smaller but rising fast. */
export function themePriorities(ins: Insights, f: Filter): ThemeRow[] {
  const months = Array.from({ length: f.to - f.from + 1 }, (_, i) => f.from + i);
  const { early, late } = halves(f);
  const all = themeShares(ins, months, f.sku);
  const e = themeShares(ins, early, f.sku), l = themeShares(ins, late, f.sku);
  return all.map((t) => {
    const earlyPct = e.find((x) => x.topic === t.topic)?.pct ?? 0, latePct = l.find((x) => x.topic === t.topic)?.pct ?? 0;
    const change = early.length && late.length ? r1(latePct - earlyPct) : 0;
    const priority: Priority = (t.pct >= 15 && change >= -2) || (change >= 5 && t.pct >= 8) ? "high" : t.pct >= 8 ? "medium" : "low";
    const why = priority === "high" ? (change >= 5 ? `Rising fast (${change > 0 ? "+" : ""}${change} pts) and ${t.pct}% of complaints` : `${t.pct}% of complaints and not improving`) : priority === "medium" ? `${t.pct}% of complaints${change <= -2 ? ", already easing" : ""}` : `Only ${t.pct}% of complaints`;
    const o = ownerOf(t.topic);
    return { ...t, earlyPct, latePct, change, owner: o.owner, area: o.area, hint: o.hint, priority, why };
  });
}

/** How much of the complaint volume each kind of owner accounts for. */
export function ownerSplit(rows: ThemeRow[]): Record<Owner, number> {
  const total = sum(rows.map((r) => r.count));
  const out: Record<Owner, number> = { ours: 0, supplier: 0, mixed: 0 };
  if (total === 0) return out;
  for (const r of rows) out[r.owner] += r.count;
  (Object.keys(out) as Owner[]).forEach((k) => { out[k] = r1((out[k] / total) * 100); });
  return out;
}

export type Verdict = "protect" | "watch" | "fix_ours" | "fix_supplier" | "retire" | "investigate" | "not_enough";
export type SkuHealth = {
  sku: string; verdict: Verdict; reviews: number; avg: number | null; delta: number | null; lowPct: number | null; returnRate: number | null;
  revenueShare: number; revenuePerMonth: number; reasons: string[]; split: Record<Owner, number>; topThemes: { topic: string; pct: number }[];
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  protect: "Protect", watch: "Watch", fix_ours: "Fix it ourselves", fix_supplier: "Escalate to supplier", retire: "Consider retiring or replacing", investigate: "Investigate", not_enough: "Not enough reviews",
};

/** Keep, fix, escalate or retire? A transparent rule set (see the constants above). It informs the decision; it does not make it. */
export function skuHealth(ins: Insights, f: Filter): SkuHealth[] {
  const prods: ProductRow[] = products(ins, { ...f, sku: null });
  const months = Array.from({ length: f.to - f.from + 1 }, (_, i) => f.from + i);
  const movers = new Map(skuMovers(ins, f).map((m) => [m.sku, m]));
  return prods.filter((p) => p.reviews > 0).map((p) => {
    const mv = movers.get(p.sku)!;
    const themes = themeShares(ins, months, p.sku);
    const split: Record<Owner, number> = { ours: 0, supplier: 0, mixed: 0 };
    const tot = sum(themes.map((t) => t.count));
    for (const t of themes) split[ownerOf(t.topic).owner] += t.count;
    (Object.keys(split) as Owner[]).forEach((k) => { split[k] = tot ? r1((split[k] / tot) * 100) : 0; });
    const avg = p.avgRating, delta = mv.delta, low = p.lowPct;
    const base = { sku: p.sku, reviews: p.reviews, avg, delta, lowPct: low, returnRate: p.returnRate, revenueShare: p.share, revenuePerMonth: months.length ? Math.round(p.revenue / months.length) : 0, split, topThemes: themes.slice(0, 3).map((t) => ({ topic: t.topic, pct: t.pct })) };
    const reasons: string[] = [];
    if (avg != null) reasons.push(`Average rating ${avg}${delta != null ? `, ${delta > 0 ? "up" : delta < 0 ? "down" : "unchanged"}${delta !== 0 ? ` ${Math.abs(delta)}` : ""} from the early to the late part of the period` : ""}.`);
    if (low != null) reasons.push(`${low}% of reviews are 1-3 stars.`);
    if (p.returnRate != null) reasons.push(`Return rate ${p.returnRate}%.`);
    if (p.reviews < MIN_REVIEWS_FOR_VERDICT || avg == null) return { ...base, verdict: "not_enough" as Verdict, reasons: [`Only ${p.reviews} reviews in this period; at least ${MIN_REVIEWS_FOR_VERDICT} are needed for a verdict.`] };

    if (avg >= PROTECT_RATING && (delta == null || delta >= -0.15)) return { ...base, verdict: "protect" as Verdict, reasons };
    const problem = avg <= WEAK_RATING || (low ?? 0) >= HIGH_LOW_SHARE || (delta != null && delta <= -BIG_DROP);
    if (!problem) return { ...base, verdict: "watch" as Verdict, reasons };

    const improving = delta != null && delta > 0;
    if (split.supplier >= 50) {
      reasons.push(`${split.supplier}% of complaints are about product quality, which is on the supplier side.`);
      const big = p.share >= BIG_REVENUE_SHARE;
      if (big) reasons.push(`It brings ${p.share}% of revenue, so work with the supplier on a fix before any thought of retiring it.`);
      if (avg <= WEAK_RATING && !improving && !big) {
        reasons.push(`It brings only ${p.share}% of revenue (about ${base.revenuePerMonth.toLocaleString("en-US")} a month), so retiring or replacing it is a realistic option if the supplier cannot fix it.`);
        return { ...base, verdict: "retire" as Verdict, reasons };
      }
      return { ...base, verdict: "fix_supplier" as Verdict, reasons };
    }
    if (split.ours + split.mixed >= 50) {
      reasons.push(`${split.ours + split.mixed}% of complaints are about things we control (listing, packing, delivery, service)${split.mixed ? "; some sizing complaints may also be product-side, so check the size chart first" : ""}.`);
      return { ...base, verdict: "fix_ours" as Verdict, reasons };
    }
    return { ...base, verdict: "investigate" as Verdict, reasons: [...reasons, "Complaint themes are too mixed to point at one owner."] };
  }).sort((a, b) => b.revenueShare - a.revenueShare);
}

export type Praise = { key: string; label: string; pct: number; count: number; keep: string };

/** What customers praise (keyword match in 4-5 star reviews), overall or for one product. */
export function praiseThemes(ins: Insights, f: Filter, sku: string | null = f.sku): Praise[] {
  const rr = ins.reviewRows.filter((r) => r.m >= f.from && r.m <= f.to && (!sku || r.sku === sku));
  const posN = sum(rr.map((r) => r.posN));
  if (posN === 0) return [];
  return Object.entries(POSITIVE_THEMES).map(([key, t]) => {
    const count = sum(rr.map((r) => r.pos[key] ?? 0));
    return { key, label: t.label, count, pct: r1((count / posN) * 100), keep: t.keep };
  }).filter((p) => p.count > 0).sort((a, b) => b.count - a.count);
}

export type Star = { sku: string; reviews: number; avg: number; delta: number | null; strengths: Praise[]; trend: "up" | "down" | "steady" | "unknown"; monthly: (number | null)[] };

/** Your best-reviewed products, with what they are praised for, so you know what to keep doing. */
export function topProducts(ins: Insights, f: Filter, minReviews = 20, limit = 8): Star[] {
  const movers = new Map(skuMovers(ins, f).map((m) => [m.sku, m]));
  const avgOf = new Map(products(ins, { ...f, sku: null }).map((p) => [p.sku, p.avgRating]));
  return [...movers.values()]
    .filter((m) => m.reviews >= minReviews && avgOf.get(m.sku) != null)
    .map((m) => {
      return { sku: m.sku, reviews: m.reviews, avg: avgOf.get(m.sku)!, delta: m.delta, strengths: praiseThemes(ins, f, m.sku).slice(0, 2), trend: m.delta == null ? ("unknown" as const) : m.delta >= 0.1 ? ("up" as const) : m.delta <= -0.1 ? ("down" as const) : ("steady" as const), monthly: m.monthly };
    })
    .sort((a, b) => b.avg - a.avg).slice(0, limit);
}
