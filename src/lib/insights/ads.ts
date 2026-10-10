// Ad spend advice per SKU. Everything here is plain arithmetic on the seller's own ads and sales data: the model
// never calculates these numbers. Pure functions, so they run in the browser and are easy to test.
import type { TrackedProduct } from "./tracker";

/** Ad numbers for one day and SKU (campaigns added together). `rev`/`su` are ALL sales that day (ads or not). */
export type AdDay = {
  d: string; sku: string; imp: number; clk: number; spend: number; ord: number; units: number; sales: number; rev: number; su: number;
};

// ---- thresholds (kept in one place so the screen can explain them) -----------------------------
export const WINDOW_DAYS = 28;            // "recent" = the last 4 weeks of ads data; the 4 weeks before are the comparison
export const MIN_CLICKS = 100;            // below this a SKU's ad results are mostly luck
export const MIN_SPEND_DAYS = 14;         // days with spend in the window
export const ASSUMED_MARGIN = 0.3;        // profit before ads as a share of price, when the seller has not entered one
export const SCALE_BELOW = 0.7;           // ACOS at or under 70% of break-even = room to spend more
export const SEVERE_ABOVE = 2;            // ACOS over 2x break-even = pause-level waste
export const LOW_CVR_VS_PORTFOLIO = 0.6;  // converts at under 60% of the typical SKU = the page is the problem, not the bid
export const MIN_CLICKS_FIX = 150;
export const LOW_CVR_ABSOLUTE = 0.01;    // with fewer than 3 comparable SKUs, under 1% of clicks becoming orders counts as "not converting"
export const ENOUGH_REVIEWS = 15;
export const WEAK_RATING = 3.5;           // do not advertise a SKU rated below this
export const PRICE_GAP_HIGH = 0.15;       // we are 15% above the comparable competitor
export const STEP_UP = 0.25;              // raise a good SKU by 25% at a time
export const STEP_CUT = 0.2;              // trim a SKU slightly over break-even by 20%
export const STEP_CUT_HARD = 0.5;
export const STEP_FIX = 0.3;
export const STEP_STOP = 0.7;
export const DIMINISHING = 0.6;           // extra spend is assumed to return only ~60% of the recent ROAS (low case 30%)

export type Stats = {
  spend: number; adSales: number; clicks: number; impressions: number; orders: number; units: number; revenue: number; unitsAll: number; spendDays: number;
};
export type Verdict = "scale" | "hold" | "cut" | "fix_first" | "dont_advertise" | "too_little";
export const VERDICT_LABEL: Record<Verdict, string> = {
  scale: "Spend more", hold: "Keep as is", cut: "Spend less", fix_first: "Fix the listing first", dont_advertise: "Pause ads", too_little: "Too little data",
};
export type Status = "under" | "on_track" | "over" | "unknown";
export const STATUS_LABEL: Record<Status, string> = { under: "Under-spending", on_track: "About right", over: "Over-spending", unknown: "Not enough data" };

export type WeekPoint = { week: string; spend: number; adSales: number; acos: number | null; organic: number | null; tacos: number | null };

export type SkuAds = {
  sku: string; name: string | null;
  recent: Stats; prior: Stats | null;
  acos: number | null; roas: number | null; cpc: number | null; ctr: number | null; cvr: number | null; tacos: number | null; adShare: number | null;
  priorAcos: number | null;
  price: number | null;
  unitProfit: number | null; profitSource: "entered" | "assumed" | "none";
  breakEvenAcos: number | null;
  /** Profit from ad-driven units minus ad spend over the recent window (negative = ads cost more than they earned). */
  netProfit: number | null;
  /** Spend above what the break-even ACOS allows, in the recent window. */
  wasted: number;
  rating: { avg: number; n: number } | null;
  priceGap: { pct: number; competitor: string } | null;
  verdict: Verdict; status: Status; reasons: string[];
  dailyNow: number; dailyNext: number; changePct: number;
  expected: { extraSalesLow: number; extraSalesHigh: number } | null;
  weeks: WeekPoint[];
};

export type AdsModel = {
  asOf: string; from: string; windowDays: number; hasPrior: boolean; totalDays: number;
  skus: SkuAds[];
  totals: { spend: number; adSales: number; acos: number | null; tacos: number | null; revenue: number; adShare: number | null; wasted: number; priorSpend: number | null; priorAcos: number | null; priorTacos: number | null };
  plan: { dailyNow: number; dailyNext: number; freed: number; added: number; unspent: number; extraSalesLow: number; extraSalesHigh: number; monthlyNow: number; monthlyNext: number };
  weeks: WeekPoint[];
  warnings: string[];
  missingProfit: string[];
};

// ---- helpers --------------------------------------------------------------------------------
const DAY = 864e5;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const div = (a: number, b: number) => (b > 0 ? a / b : null);
const median = (v: number[]) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const empty = (): Stats => ({ spend: 0, adSales: 0, clicks: 0, impressions: 0, orders: 0, units: 0, revenue: 0, unitsAll: 0, spendDays: 0 });
function add(s: Stats, r: AdDay) {
  s.spend += r.spend; s.adSales += r.sales; s.clicks += r.clk; s.impressions += r.imp; s.orders += r.ord; s.units += r.units; s.revenue += r.rev; s.unitsAll += r.su;
  if (r.spend > 0) s.spendDays++;
}
const weekStart = (d: string) => { const x = new Date(`${d}T00:00:00Z`); return iso(x.getTime() - ((x.getUTCDay() + 6) % 7) * DAY); };

const plain = (v: number) => Math.round(v).toLocaleString("en-US");
const pc = (v: number) => `${Math.round(v * 100)}%`;

export type AdsInput = {
  days: AdDay[];
  names?: Record<string, string>;
  unitProfit?: Record<string, number>;
  /** Review totals per SKU in the last few months: sum of stars and count. */
  ratings?: Record<string, { rs: number; n: number }>;
  tracked?: TrackedProduct[];
  money?: (v: number) => string;
};

export function computeAds(input: AdsInput): AdsModel | null {
  const { days } = input;
  const money = input.money ?? plain;
  if (!days.length) return null;
  const adDays = days.filter((d) => d.spend > 0 || d.clk > 0 || d.sales > 0);
  if (!adDays.length) return null;
  const asOf = adDays.reduce((m, r) => (r.d > m ? r.d : m), adDays[0].d);
  const first = adDays.reduce((m, r) => (r.d < m ? r.d : m), adDays[0].d);
  const totalDays = Math.round((t(asOf) - t(first)) / DAY) + 1;
  const windowDays = Math.min(WINDOW_DAYS, totalDays);
  const recentFrom = iso(t(asOf) - (windowDays - 1) * DAY);
  const priorFrom = iso(t(recentFrom) - windowDays * DAY);
  const hasPrior = totalDays >= windowDays * 2 - 7 && first <= iso(t(recentFrom) - (windowDays - 7) * DAY);

  const bySku = new Map<string, AdDay[]>();
  for (const r of days) { if (!bySku.has(r.sku)) bySku.set(r.sku, []); bySku.get(r.sku)!.push(r); }

  type Raw = { sku: string; recent: Stats; prior: Stats; rows: AdDay[] };
  const raws: Raw[] = [];
  for (const [sku, rows] of bySku) {
    const recent = empty(), prior = empty();
    for (const r of rows) {
      if (r.d >= recentFrom && r.d <= asOf) add(recent, r);
      else if (r.d >= priorFrom && r.d < recentFrom) add(prior, r);
    }
    if (recent.spend > 0 || recent.clicks > 0 || prior.spend > 0) raws.push({ sku, recent, prior, rows });
  }
  const tot = empty(), totPrior = empty();
  for (const r of raws) for (const k of Object.keys(tot) as (keyof Stats)[]) { tot[k] += r.recent[k]; totPrior[k] += r.prior[k]; }

  // What a typical SKU converts at: the yardstick for "this page isn't converting".
  const cvrs = raws.filter((r) => r.recent.clicks >= MIN_CLICKS_FIX).map((r) => div(r.recent.orders || r.recent.units, r.recent.clicks)).filter((v): v is number => v != null);
  const typicalCvr = cvrs.length >= 3 ? median(cvrs) : null;

  const skus: SkuAds[] = raws.map(({ sku, recent, prior, rows }) => {
    const units = recent.units || recent.orders;
    const price = recent.unitsAll > 0 && recent.revenue > 0 ? recent.revenue / recent.unitsAll : units > 0 && recent.adSales > 0 ? recent.adSales / units : null;
    const entered = input.unitProfit?.[sku];
    const unitProfit = entered != null ? entered : price != null ? price * ASSUMED_MARGIN : null;
    const profitSource: SkuAds["profitSource"] = entered != null ? "entered" : unitProfit != null ? "assumed" : "none";
    const breakEvenAcos = unitProfit != null && price ? Math.min(1, unitProfit / price) : null;
    const acos = div(recent.spend, recent.adSales), priorAcos = div(prior.spend, prior.adSales);
    const cvr = div(recent.orders || recent.units, recent.clicks);
    const netProfit = unitProfit != null ? units * unitProfit - recent.spend : null;
    const wasted = breakEvenAcos != null ? Math.max(0, recent.spend - recent.adSales * breakEvenAcos) : 0;

    const rt = input.ratings?.[sku];
    const rating = rt && rt.n >= ENOUGH_REVIEWS ? { avg: rt.rs / rt.n, n: rt.n } : null;
    let priceGap: SkuAds["priceGap"] = null;
    if (price) for (const p of input.tracked ?? []) {
      if (p.comparableSku !== sku || !p.series.length) continue;
      const theirs = p.series[p.series.length - 1].price;
      const gap = price / theirs - 1;
      if (!priceGap || gap > priceGap.pct) priceGap = { pct: gap, competitor: p.competitor };
    }

    const reasons: string[] = [];
    const lowData = recent.clicks < MIN_CLICKS || recent.spendDays < MIN_SPEND_DAYS;
    let verdict: Verdict, changePct = 0;
    const dailyNow = recent.spend / windowDays;
    const adSummary = acos != null ? `ACOS ${pc(acos)}` : "no sales from ads";
    const beText = breakEvenAcos != null ? ` against a break-even of ${pc(breakEvenAcos)}${profitSource === "assumed" ? " (assumed margin)" : ""}` : "";

    if (rating && rating.avg < WEAK_RATING) {
      verdict = "dont_advertise"; changePct = -STEP_STOP;
      reasons.push(`Rated ${rating.avg.toFixed(1)} from ${rating.n} recent reviews: shoppers see the rating next to the ad, so clicks are unlikely to turn into sales.`);
      reasons.push(`Spent ${money(recent.spend)} in the last ${windowDays} days for ${money(recent.adSales)} in ad sales (${adSummary}).`);
    } else if (lowData) {
      verdict = "too_little";
      reasons.push(`Only ${recent.clicks} clicks in the last ${windowDays} days (ads ran on ${recent.spendDays} of them). That is too few to judge; results this small are mostly luck.`);
      reasons.push("Keep the budget steady until it has at least 100 clicks, then check again.");
    } else if (breakEvenAcos == null || acos == null) {
      verdict = recent.adSales <= 0 && recent.spend > 0 ? "cut" : "hold";
      if (verdict === "cut") { changePct = -STEP_CUT_HARD; reasons.push(`${money(recent.spend)} spent in the last ${windowDays} days and no sales came from the ads.`); }
      else reasons.push("There is not enough price data to work out a break-even.");
    } else if (acos > breakEvenAcos) {
      const lowCvr = cvr != null && recent.clicks >= MIN_CLICKS_FIX && cvr < (typicalCvr != null ? typicalCvr * LOW_CVR_VS_PORTFOLIO : LOW_CVR_ABSOLUTE);
      if (lowCvr) {
        verdict = "fix_first"; changePct = -STEP_FIX;
        reasons.push(`Shoppers click but few buy: ${(cvr! * 100).toFixed(1)}% of clicks become orders${typicalCvr != null ? `, against about ${(typicalCvr * 100).toFixed(1)}% for a typical SKU in this account` : ""}.`);
        reasons.push(`${adSummary}${beText}: ${money(wasted)} of the ${money(recent.spend)} spent was above what this SKU can afford.`);
        if (priceGap && priceGap.pct >= PRICE_GAP_HIGH) reasons.push(`Priced ${pc(priceGap.pct)} above ${priceGap.competitor}'s comparable product, which may be putting shoppers off.`);
        if (rating && rating.avg < 4) reasons.push(`Rating is only ${rating.avg.toFixed(1)}; check the Reviews tab for what shoppers complain about.`);
        reasons.push("Pausing most of the spend until the page, price or reviews are fixed saves money. More budget would only buy more clicks that do not convert.");
      } else {
        verdict = "cut"; changePct = acos > breakEvenAcos * SEVERE_ABOVE ? -STEP_CUT_HARD : -STEP_CUT;
        reasons.push(`${adSummary}${beText}: each ${money(100)} of ads brings back ${money(100 / acos)} in sales and costs more than the product earns.`);
        reasons.push(`${money(wasted)} of the ${money(recent.spend)} spent in the last ${windowDays} days was above what this SKU can afford.`);
        reasons.push(changePct <= -STEP_CUT_HARD ? "The gap is large enough to cut hard and lower bids on the worst-converting targets." : "A moderate cut, plus lowering bids, should bring it back under break-even.");
      }
    } else if (acos <= breakEvenAcos * SCALE_BELOW) {
      const worsening = hasPrior && priorAcos != null && prior.spend > 0 && recent.spend > prior.spend * 1.25 && acos > priorAcos * 1.25;
      if (worsening) {
        verdict = "hold";
        reasons.push(`Profitable at ${adSummary}${beText}, but spend rose ${pc(recent.spend / prior.spend - 1)} and ACOS climbed from ${pc(priorAcos!)} to ${pc(acos)}: extra spend is already buying less.`);
        reasons.push("Hold here and watch whether ACOS settles before adding more.");
      } else {
        verdict = "scale"; changePct = STEP_UP;
        reasons.push(`${adSummary}${beText}: each ${money(100)} of ads brings back ${money(100 / acos)} in sales and still leaves a profit.`);
        if (netProfit != null) reasons.push(`Ads earned about ${money(netProfit)} after their own cost in the last ${windowDays} days.`);
        reasons.push(`Raise the budget by about ${pc(STEP_UP)}, then check again in 2 weeks. Returns usually shrink as spend grows.`);
      }
    } else {
      verdict = "hold";
      reasons.push(`${adSummary}${beText}: profitable, but the margin left after ads is thin.`);
      reasons.push("Keep the budget and work on lowering bids on weak targets rather than adding spend.");
    }
    if (verdict === "scale" && priceGap && priceGap.pct >= PRICE_GAP_HIGH) reasons.push(`Note: priced ${pc(priceGap.pct)} above ${priceGap.competitor}'s comparable product; watch conversion as spend grows.`);

    const dailyNext = Math.max(0, dailyNow * (1 + changePct));
    const status: Status = verdict === "too_little" ? "unknown" : changePct > 0 ? "under" : changePct < 0 ? "over" : "on_track";
    const roas = div(recent.adSales, recent.spend);
    const extraDaily = Math.max(0, dailyNext - dailyNow);
    const expected = verdict === "scale" && roas != null
      ? { extraSalesLow: extraDaily * 30 * roas * (DIMINISHING / 2), extraSalesHigh: extraDaily * 30 * roas * DIMINISHING } : null;

    // Weekly series for the charts (all weeks of data, oldest first).
    const wk = new Map<string, { spend: number; sales: number; rev: number }>();
    for (const r of rows) {
      const w = weekStart(r.d);
      const o = wk.get(w) ?? { spend: 0, sales: 0, rev: 0 };
      o.spend += r.spend; o.sales += r.sales; o.rev += r.rev; wk.set(w, o);
    }
    const weeks = [...wk.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([week, o]): WeekPoint => ({
      week, spend: Math.round(o.spend), adSales: Math.round(o.sales), acos: div(o.spend, o.sales),
      organic: o.rev > 0 ? Math.max(0, Math.round(o.rev - o.sales)) : null, tacos: div(o.spend, o.rev),
    }));

    return {
      sku, name: input.names?.[sku] ?? null, recent, prior: hasPrior ? prior : null,
      acos, roas, cpc: div(recent.spend, recent.clicks), ctr: div(recent.clicks, recent.impressions), cvr, tacos: div(recent.spend, recent.revenue),
      adShare: div(recent.adSales, recent.revenue), priorAcos: hasPrior ? priorAcos : null, price, unitProfit, profitSource, breakEvenAcos, netProfit, wasted,
      rating, priceGap, verdict, status, reasons, dailyNow, dailyNext, changePct, expected, weeks,
    };
  }).sort((a, b) => b.recent.spend - a.recent.spend);

  // Move money: what the cuts free up goes to the SKUs that earn it back, capped by each one's step.
  const freed = skus.reduce((a, s) => a + Math.max(0, s.dailyNow - s.dailyNext), 0);
  const room = skus.reduce((a, s) => a + Math.max(0, s.dailyNext - s.dailyNow), 0);
  const added = Math.min(freed, room);
  const unspent = freed - added;
  if (room > freed && room > 0) { // not enough freed to fund every raise: scale the raises down proportionally
    const k = freed / room;
    for (const s of skus) if (s.dailyNext > s.dailyNow) {
      s.dailyNext = s.dailyNow + (s.dailyNext - s.dailyNow) * k;
      s.changePct = s.dailyNow > 0 ? s.dailyNext / s.dailyNow - 1 : 0;
      if (s.expected && s.roas != null) { const extra = (s.dailyNext - s.dailyNow) * 30 * s.roas; s.expected = { extraSalesLow: extra * DIMINISHING / 2, extraSalesHigh: extra * DIMINISHING }; }
    }
  }
  const dailyNow = skus.reduce((a, s) => a + s.dailyNow, 0);
  const dailyNext = skus.reduce((a, s) => a + s.dailyNext, 0);

  const wk = new Map<string, { spend: number; sales: number; rev: number }>();
  for (const r of days) { const w = weekStart(r.d); const o = wk.get(w) ?? { spend: 0, sales: 0, rev: 0 }; o.spend += r.spend; o.sales += r.sales; o.rev += r.rev; wk.set(w, o); }
  const weeks = [...wk.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([week, o]): WeekPoint => ({
    week, spend: Math.round(o.spend), adSales: Math.round(o.sales), acos: div(o.spend, o.sales), organic: o.rev > 0 ? Math.max(0, Math.round(o.rev - o.sales)) : null, tacos: div(o.spend, o.rev),
  }));

  const warnings: string[] = [];
  const hasSales = days.some((d) => d.rev > 0);
  if (!hasSales) warnings.push("None of the SKUs in the ads file match a SKU in the sales file (or no sales are uploaded), so total sales, TACoS and organic sales can't be shown. Check that SKU names are the same in both files.");
  else {
    const unmatched = skus.filter((s) => s.recent.spend > 0 && s.recent.revenue === 0).map((s) => s.sku);
    if (unmatched.length) warnings.push(`${unmatched.length} advertised SKU${unmatched.length === 1 ? " has" : "s have"} no sales in the sales file for these dates (${unmatched.slice(0, 4).join(", ")}${unmatched.length > 4 ? ", …" : ""}). Check the SKU names match.`);
  }
  if (totalDays < 28) warnings.push(`Only ${totalDays} days of ads data. Advice is rough until there are at least 4 weeks.`);
  const missingProfit = skus.filter((s) => s.profitSource !== "entered" && s.recent.spend > 0).map((s) => s.sku);

  return {
    asOf, from: first, windowDays, hasPrior, totalDays, skus,
    totals: {
      spend: tot.spend, adSales: tot.adSales, acos: div(tot.spend, tot.adSales), tacos: tot.revenue > 0 ? div(tot.spend, tot.revenue) : null, revenue: tot.revenue,
      adShare: tot.revenue > 0 ? div(tot.adSales, tot.revenue) : null, wasted: skus.reduce((a, s) => a + s.wasted, 0),
      priorSpend: hasPrior ? totPrior.spend : null, priorAcos: hasPrior ? div(totPrior.spend, totPrior.adSales) : null, priorTacos: hasPrior && totPrior.revenue > 0 ? div(totPrior.spend, totPrior.revenue) : null,
    },
    plan: {
      dailyNow, dailyNext, freed, added, unspent,
      extraSalesLow: skus.reduce((a, s) => a + (s.expected?.extraSalesLow ?? 0), 0), extraSalesHigh: skus.reduce((a, s) => a + (s.expected?.extraSalesHigh ?? 0), 0),
      monthlyNow: dailyNow * 30, monthlyNext: dailyNext * 30,
    },
    weeks, warnings, missingProfit,
  };
}

/** Last-3-months rating totals per SKU from the monthly review rows (sum of stars, count). */
export function recentRatings(rows: { m: number; sku: string | null; n: number; rs: number }[], monthCount: number): Record<string, { rs: number; n: number }> {
  const out: Record<string, { rs: number; n: number }> = {};
  for (const r of rows) {
    if (!r.sku || r.m < monthCount - 3) continue;
    const o = (out[r.sku] ??= { rs: 0, n: 0 });
    o.rs += r.rs; o.n += r.n;
  }
  return out;
}

/** Compact, model-readable summary of the advice. Percentages are whole-number percents and money is rounded, so quoting them is easy to verify. */
export function adsChatContext(m: AdsModel) {
  const r0 = (v: number | null) => (v == null ? null : Math.round(v));
  const p0 = (v: number | null) => (v == null ? null : Math.round(v * 100));
  return {
    ads_advice: {
      window_days: m.windowDays, data_through: m.asOf,
      total_spend: r0(m.totals.spend), total_ad_sales: r0(m.totals.adSales), acos_pct: p0(m.totals.acos), tacos_pct: p0(m.totals.tacos), wasted_spend: r0(m.totals.wasted),
      monthly_budget_now: r0(m.plan.monthlyNow), monthly_budget_suggested: r0(m.plan.monthlyNext),
      skus: m.skus.map((s) => ({
        sku: s.sku, advice: VERDICT_LABEL[s.verdict], spend: r0(s.recent.spend), ad_sales: r0(s.recent.adSales), acos_pct: p0(s.acos), break_even_acos_pct: p0(s.breakEvenAcos),
        profit_per_unit_source: s.profitSource, monthly_budget_now: r0(s.dailyNow * 30), monthly_budget_suggested: r0(s.dailyNext * 30), reasons: s.reasons,
      })),
    },
  };
}

export type AdAction = { week: 1 | 2 | 3 | 4; sku: string | null; kind: "pause" | "cut" | "fix" | "raise" | "check" | "setup"; text: string };

/** The ad part of the 30-day plan, written by code from the advice: cuts first (week 1), raises once the cuts have freed the money (week 2). */
export function adsActions(m: AdsModel, money: (v: number) => string = plain): AdAction[] {
  const out: AdAction[] = [];
  const monthly = (v: number) => money(v * 30);
  const pctText = (c: number) => `${Math.abs(Math.round(c * 100))}%`;
  if (m.missingProfit.length > 0) {
    out.push({ week: 1, sku: null, kind: "setup", text: `Enter your profit per unit for ${m.missingProfit.length === 1 ? m.missingProfit[0] : `the ${m.missingProfit.length} SKUs`} on the Ads screen (break-even is assumed at ${Math.round(ASSUMED_MARGIN * 100)}% margin until you do), then re-read the advice.` });
  }
  for (const s of m.skus) {
    const now = monthly(s.dailyNow), next = monthly(s.dailyNext);
    if (s.verdict === "dont_advertise") out.push({ week: 1, sku: s.sku, kind: "pause", text: `Pause most ads on ${s.sku} (${now} → ${next} a month). ${s.reasons[0]}` });
    else if (s.verdict === "cut") out.push({ week: 1, sku: s.sku, kind: "cut", text: `Cut ${s.sku}'s ad budget from ${now} to ${next} a month (−${pctText(s.changePct)}) and lower bids on the targets that do not sell.` });
    else if (s.verdict === "fix_first") {
      out.push({ week: 1, sku: s.sku, kind: "fix", text: `Cut ${s.sku} to ${next} a month (from ${now}) and fix what stops clicks turning into orders: price, images, description and reviews.` });
      out.push({ week: 3, sku: s.sku, kind: "check", text: `Check whether ${s.sku} converts better after the fixes. Only restore its budget if more of its clicks become orders.` });
    } else if (s.verdict === "scale" && s.changePct > 0.005) out.push({ week: 2, sku: s.sku, kind: "raise", text: `Raise ${s.sku}'s ad budget from ${now} to ${next} a month (+${pctText(s.changePct)}).` });
  }
  out.push({ week: 4, sku: null, kind: "check", text: `Upload a fresh ads report and compare each SKU's ACOS with the last ${m.windowDays} days. Step back on any SKU you raised whose ACOS went above its break-even.` });
  return out.sort((a, b) => a.week - b.week);
}
