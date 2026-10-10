// SKU playbook: for each product, what is wrong (price, reviews, ads, sales) and what to do about it, week by week.
// Rule-based and written by code from the seller's own data (no AI): every number comes from sales, reviews, ads or the
// competitor tracker, and every rule is a named threshold below. It suggests tests, never certainties.
import type { Insights } from "./types";
import { allProductEvents, defaultFilter, products } from "./aggregate";
import { ownerOf, skuHealth, type SkuHealth } from "./reviews";
import { adsActions, type AdsModel, type SkuAds } from "./ads";
import type { TrackedProduct } from "./tracker";

export const PRICE_GAP_ACT = 0.15;        // we are 15%+ above the comparable competitor product
export const PRICE_HEADROOM = -0.1;       // we are 10%+ below it
export const HEADROOM_RATING = 4.2;       // only suggest a price rise for a well-liked product
export const UNITS_FALLING = -5;          // units down 5%+ over the last 2 months vs the 2 before
export const TREND_MIN_MONTHS = 4;
export const TEST_RISE_PCT = 4;           // size of the suggested small price-rise test

export type Area = "price" | "reviews" | "ads" | "sales";
export type Severity = "high" | "medium" | "low";
export type Issue = { area: Area; severity: Severity; text: string };
export type Step = { week: 1 | 2 | 3 | 4; area: Area; text: string };
export type SkuPlay = { sku: string; revenueShare: number; priority: number; issues: Issue[]; steps: Step[]; headline: string };

const plain = (v: number) => Math.round(v).toLocaleString("en-US");
const pc = (v: number) => `${Math.round(v * 100)}%`;
const label = (t: string) => t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const sevScore: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

/** Units over the last two months against the two before (needs 4+ months of data). */
function unitsTrend(units: number[]): number | null {
  if (units.length < TREND_MIN_MONTHS) return null;
  const n = units.length, a = units[n - 1] + units[n - 2], b = units[n - 3] + units[n - 4];
  return b > 0 ? ((a - b) / b) * 100 : null;
}

export function skuPlaybook(input: { ins: Insights; tracked?: TrackedProduct[]; ads?: AdsModel | null; money?: (v: number) => string }): SkuPlay[] {
  const { ins } = input;
  const money = input.money ?? plain;
  if (!ins.months.length || !ins.skus.length) return [];
  const f = defaultFilter(ins);
  const prods = new Map(products(ins, f).map((p) => [p.sku, p]));
  const health = new Map<string, SkuHealth>(skuHealth(ins, f).map((h) => [h.sku, h]));
  const events = allProductEvents(ins, f);
  const adBySku = new Map<string, SkuAds>((input.ads?.skus ?? []).map((s) => [s.sku, s]));
  const adSteps = input.ads ? adsActions(input.ads, money).filter((a) => a.sku) : [];

  const out: SkuPlay[] = [];
  for (const s of ins.skus) {
    const p = prods.get(s.sku);
    if (!p || p.revenue <= 0) continue;
    const issues: Issue[] = [], steps: Step[] = [];
    const h = health.get(s.sku), ad = adBySku.get(s.sku);
    const trend = unitsTrend(s.units);
    const lastIdx = [...s.units.keys()].reverse().find((i) => s.units[i] > 0);
    const price = lastIdx != null ? s.revenue[lastIdx] / s.units[lastIdx] : p.price;
    const unitProfit = ad?.profitSource === "entered" ? ad.unitProfit : null;

    // ---- reviews -----------------------------------------------------------------------------
    if (h) {
      const top = h.topThemes[0];
      const topText = top ? `${label(top.topic)} (${top.pct}% of complaints)` : "the main complaint";
      if (h.verdict === "fix_ours") {
        issues.push({ area: "reviews", severity: "high", text: `Rated ${h.avg}${h.delta != null && h.delta < 0 ? `, down ${Math.abs(h.delta)}` : ""}; complaints are mostly about things you control. Biggest: ${topText}.` });
        steps.push({ week: 1, area: "reviews", text: `Fix ${topText.toLowerCase()} on ${s.sku}: ${top ? ownerOf(top.topic).hint : "read the latest low-rated reviews and fix what they name"}` });
        steps.push({ week: 4, area: "reviews", text: `Re-check ${s.sku}'s rating and share of 1–3★ reviews after the fix (today ${h.avg}, ${h.lowPct}% low).` });
      } else if (h.verdict === "fix_supplier") {
        issues.push({ area: "reviews", severity: "high", text: `Rated ${h.avg}; ${h.split.supplier}% of complaints are about the product itself. Biggest: ${topText}.` });
        steps.push({ week: 1, area: "reviews", text: `Send the supplier ${s.sku}'s top complaint (${topText.toLowerCase()}) with example reviews and ask for a fix before you reorder.` });
        steps.push({ week: 3, area: "reviews", text: `Hold new stock orders for ${s.sku} until the supplier confirms the fix.` });
      } else if (h.verdict === "retire") {
        issues.push({ area: "reviews", severity: "high", text: `Rated ${h.avg} with product-side complaints, and it brings only ${h.revenueShare}% of revenue.` });
        steps.push({ week: 1, area: "reviews", text: `Decide on ${s.sku}: ask the supplier for a fix by week 3, or plan to retire or replace it.` });
        steps.push({ week: 4, area: "reviews", text: `If the supplier has not fixed ${s.sku}, stop reordering and sell through the stock.` });
      } else if (h.verdict === "investigate") {
        issues.push({ area: "reviews", severity: "medium", text: `Rated ${h.avg}, but complaints are too mixed to point at one owner.` });
        steps.push({ week: 2, area: "reviews", text: `Read the 20 most recent 1–3★ reviews for ${s.sku} and sort them by who can fix each one.` });
      } else if (h.verdict === "watch" && h.delta != null && h.delta <= -0.15) {
        issues.push({ area: "reviews", severity: "low", text: `Rating is slipping (down ${Math.abs(h.delta)}) but is not yet a problem.` });
        steps.push({ week: 3, area: "reviews", text: `Watch ${s.sku}'s rating: act if it falls below ${3.4} or keeps dropping.` });
      } else if (h.verdict === "protect") {
        steps.push({ week: 4, area: "reviews", text: `Protect ${s.sku} (rated ${h.avg}): keep quality and packaging unchanged and ask happy buyers for reviews.` });
      }
    }

    // ---- price -------------------------------------------------------------------------------
    const gap = ad?.priceGap ?? (() => {
      let g: { pct: number; competitor: string } | null = null;
      for (const t of input.tracked ?? []) {
        if (t.comparableSku !== s.sku || !t.series.length || !price) continue;
        const pct = price / t.series[t.series.length - 1].price - 1;
        if (!g || pct > g.pct) g = { pct, competitor: t.competitor };
      }
      return g;
    })();
    const falling = trend != null && trend <= UNITS_FALLING;
    const rival = gap && price ? { price: price / (1 + gap.pct), ...gap } : null;
    if (rival && price && rival.pct >= PRICE_GAP_ACT) {
      const halfway = price - (price - rival.price) / 2;
      const hurts = falling || ad?.verdict === "fix_first";
      issues.push({ area: "price", severity: hurts ? "high" : "medium", text: `Priced ${pc(rival.pct)} above ${rival.competitor}'s comparable product${falling ? `, and units fell ${Math.abs(Math.round(trend!))}% over the last 2 months` : ""}.` });
      const cutBy = price - halfway;
      if (unitProfit != null && unitProfit - cutBy <= 0) steps.push({ week: 2, area: "price", text: `${s.sku} is priced above ${rival.competitor}, but a cut to about ${money(halfway)} would use up your whole profit of ${money(unitProfit)} a unit. Look at supplier cost or pack size instead of price.` });
      else steps.push({ week: 2, area: "price", text: `Test lowering ${s.sku} from about ${money(price)} to about ${money(halfway)} (halfway to ${rival.competitor}'s ${money(rival.price)}) for 2 weeks${unitProfit != null ? `; you would still keep about ${money(unitProfit - cutBy)} a unit` : " and check it still leaves you a profit"}.` });
      steps.push({ week: 4, area: "price", text: `Compare ${s.sku}'s units and ad conversion before and after the price test; keep the cut only if units rise.` });
    } else if (rival && price && rival.pct <= PRICE_HEADROOM && h && h.avg != null && h.avg >= HEADROOM_RATING && !falling) {
      issues.push({ area: "price", severity: "low", text: `Priced ${pc(-rival.pct)} below ${rival.competitor}'s comparable product and well rated (${h.avg}): there may be room to charge more.` });
      steps.push({ week: 3, area: "price", text: `Test raising ${s.sku} by about ${TEST_RISE_PCT}% (to around ${money(price * (1 + TEST_RISE_PCT / 100))}) for 2 weeks and watch units.` });
    }
    const last = events.filter((e) => e.sku === s.sku).map((e) => e.e).sort((a, b) => b.index - a.index)[0];
    if (last && last.unitsPct != null && last.monthsAfter >= 2) {
      if (last.pricePct > 0 && last.unitsPct <= UNITS_FALLING) {
        issues.push({ area: "price", severity: "medium", text: `After the ${last.pricePct}% price rise in ${last.month}, units were ${Math.abs(last.unitsPct)}% lower (they moved together; other causes are possible).` });
        steps.push({ week: 2, area: "price", text: `Test moving ${s.sku} back toward ${money(last.priceBefore)} for 2 weeks to see whether units recover.` });
      } else if (last.pricePct < 0 && last.unitsPct < 5) {
        issues.push({ area: "price", severity: "low", text: `The ${Math.abs(last.pricePct)}% price cut in ${last.month} did not bring more units, so cutting further is unlikely to help on its own.` });
      }
    }

    // ---- ads ---------------------------------------------------------------------------------
    const blockRaise = h && ["fix_ours", "fix_supplier", "retire", "investigate"].includes(h.verdict);
    if (ad) {
      const tone: Severity = ["dont_advertise", "cut", "fix_first"].includes(ad.verdict) ? (ad.wasted > 0 ? "high" : "medium") : "low";
      if (ad.verdict === "scale" && !blockRaise) issues.push({ area: "ads", severity: "low", text: `Ads pay back well (ACOS ${ad.acos != null ? pc(ad.acos) : "n/a"} against a break-even of ${ad.breakEvenAcos != null ? pc(ad.breakEvenAcos) : "n/a"}): room to spend more.` });
      else if (ad.verdict === "scale") issues.push({ area: "ads", severity: "low", text: `Ads look efficient, but the reviews need fixing first, so more spend is held back.` });
      else if (tone !== "low" || ad.verdict === "dont_advertise") issues.push({ area: "ads", severity: tone, text: `${ad.verdict === "dont_advertise" ? "Rating too low to advertise" : ad.verdict === "fix_first" ? "Clicks are not turning into orders" : `ACOS ${ad.acos != null ? pc(ad.acos) : "n/a"} is above break-even`}${ad.wasted > 0 ? `: about ${money(ad.wasted)} of the last ${input.ads!.windowDays} days' ad spend was above what this SKU can afford` : ""}.` });
      for (const a of adSteps.filter((x) => x.sku === s.sku)) {
        if (a.kind === "raise" && blockRaise) { steps.push({ week: 3, area: "ads", text: `Hold off raising ${s.sku}'s ads until its rating recovers, then raise by the amount on the Ads screen.` }); continue; }
        steps.push({ week: a.week, area: "ads", text: a.text });
      }
    }

    // ---- sales (only when nothing else explains a fall) --------------------------------------
    if (falling && issues.length === 0) {
      issues.push({ area: "sales", severity: "medium", text: `Units fell ${Math.abs(Math.round(trend!))}% over the last 2 months compared with the 2 before, with no clear cause in price, reviews or ads.` });
      steps.push({ week: 1, area: "sales", text: `Check ${s.sku} for stock-outs, a changed listing, lost search ranking or a new competitor.` });
    }

    const actionable = steps.filter((x) => !(x.area === "reviews" && /^Protect /.test(x.text) && issues.length === 0 && steps.length === 1));
    if (actionable.length === 0) continue;
    steps.sort((a, b) => a.week - b.week);
    const score = issues.reduce((a, i) => a + sevScore[i.severity], 0) * (0.5 + p.share / 10);
    const areas = [...new Set(issues.filter((i) => i.severity !== "low").map((i) => i.area))];
    out.push({
      sku: s.sku, revenueShare: p.share, priority: score, issues, steps,
      headline: areas.length === 0 ? "Doing fine: a few small things to keep it that way" : `Needs attention on ${areas.map((a) => ({ price: "price", reviews: "reviews", ads: "ads", sales: "sales" }[a])).join(", ")}`,
    });
  }
  return out.sort((a, b) => b.priority - a.priority);
}
