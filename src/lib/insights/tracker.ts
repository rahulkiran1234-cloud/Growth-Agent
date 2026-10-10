// Competitor tracker: snapshots of competitor products over time. Pure functions only (no database, no React):
// they summarise a product's series, detect price moves, and write the short factual passages the AI analysis
// retrieves and quotes. Every figure here is computed by code.

export type SnapRow = {
  date: string; price: number; discount: boolean | null; rating: number | null;
  totalReviews: number | null; newReviews: number | null; stock: string | null; promo: string | null;
};
export type TrackedProduct = {
  competitor: string; product: string; category: string | null; comparableSku: string | null; dataType: string | null; series: SnapRow[];
};

export type ProductSummary = {
  snapshots: number; firstDate: string; lastDate: string;
  firstPrice: number; lastPrice: number; changePct: number | null; minPrice: number; maxPrice: number;
  discountSnapshots: number; discountPct: number | null; hasDiscountData: boolean;
  promos: { name: string; snapshots: number }[];
  firstRating: number | null; lastRating: number | null;
  firstReviews: number | null; lastReviews: number | null; newReviews: number | null;
  stockLowSnapshots: number; stockLowPct: number | null; latestStock: string | null;
};

const NO_PROMO = /^(|none|n\/a|na|no|nil|-|null)$/i;
const LOW_STOCK = /low|limited|few left|only \d+ left/i;
const OUT_STOCK = /out of stock|sold out|unavailable|oos/i;
const r1 = (v: number) => Math.round(v * 10) / 10;

export const isRealPromo = (p: string | null | undefined) => !!p && !NO_PROMO.test(p.trim());
export const isLowStock = (s: string | null | undefined) => !!s && (LOW_STOCK.test(s) || OUT_STOCK.test(s));

const sorted = (p: TrackedProduct) => [...p.series].sort((a, b) => a.date.localeCompare(b.date));

export function summarizeProduct(p: TrackedProduct): ProductSummary | null {
  const s = sorted(p);
  if (s.length === 0) return null;
  const first = s[0], last = s[s.length - 1];
  const prices = s.map((x) => x.price);
  const withDisc = s.filter((x) => x.discount != null);
  const discountSnapshots = withDisc.filter((x) => x.discount).length;
  const promoCount = new Map<string, number>();
  for (const x of s) if (isRealPromo(x.promo)) promoCount.set(x.promo!.trim(), (promoCount.get(x.promo!.trim()) ?? 0) + 1);
  const withStock = s.filter((x) => x.stock != null && x.stock !== "");
  const low = withStock.filter((x) => isLowStock(x.stock)).length;
  const firstRev = s.find((x) => x.totalReviews != null)?.totalReviews ?? null;
  const lastRev = [...s].reverse().find((x) => x.totalReviews != null)?.totalReviews ?? null;
  const anyNew = s.some((x) => x.newReviews != null);
  return {
    snapshots: s.length, firstDate: first.date, lastDate: last.date,
    firstPrice: first.price, lastPrice: last.price, changePct: first.price > 0 ? r1(((last.price - first.price) / first.price) * 100) : null,
    minPrice: Math.min(...prices), maxPrice: Math.max(...prices),
    discountSnapshots, discountPct: withDisc.length ? r1((discountSnapshots / withDisc.length) * 100) : null, hasDiscountData: withDisc.length > 0,
    promos: [...promoCount.entries()].map(([name, snapshots]) => ({ name, snapshots })).sort((a, b) => b.snapshots - a.snapshots),
    firstRating: first.rating, lastRating: last.rating,
    firstReviews: firstRev, lastReviews: lastRev,
    newReviews: anyNew ? s.reduce((t, x) => t + (x.newReviews ?? 0), 0) : firstRev != null && lastRev != null ? lastRev - firstRev : null,
    stockLowSnapshots: low, stockLowPct: withStock.length ? r1((low / withStock.length) * 100) : null,
    latestStock: [...s].reverse().find((x) => x.stock)?.stock ?? null,
  };
}

export type PriceMove = { date: string; from: number; to: number; pct: number };

/** Snapshot-to-snapshot price changes of at least `minPct` percent. */
export function priceMoves(p: TrackedProduct, minPct = 1): PriceMove[] {
  const s = sorted(p);
  const out: PriceMove[] = [];
  for (let i = 1; i < s.length; i++) {
    if (s[i - 1].price <= 0) continue;
    const pct = ((s[i].price - s[i - 1].price) / s[i - 1].price) * 100;
    if (Math.abs(pct) >= minPct) out.push({ date: s[i].date, from: s[i - 1].price, to: s[i].price, pct: r1(pct) });
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** 2025-10-10 -> "10 Oct 2025". */
export const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
/** 2025-10-10 -> "10 Oct". */
export const shortDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const n = (v: number) => (Math.round(v * 100) / 100).toString();
const sgn = (v: number) => `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v)}`;

/**
 * The factual passage the AI analysis can search and quote. One short line per fact so a quote can be copied
 * exactly. Numbers come from `summarizeProduct`, never from a model.
 */
export function passageFor(p: TrackedProduct): string | null {
  const s = summarizeProduct(p);
  if (!s) return null;
  const lines: string[] = [];
  lines.push(`Competitor tracker: ${p.competitor}, ${p.product}${p.category ? ` (category ${p.category})` : ""}. ${s.snapshots} snapshot${s.snapshots === 1 ? "" : "s"} from ${longDate(s.firstDate)} to ${longDate(s.lastDate)}.`);
  lines.push(
    s.snapshots > 1
      ? `Listed price: ${n(s.firstPrice)} on ${longDate(s.firstDate)} and ${n(s.lastPrice)} on ${longDate(s.lastDate)}${s.changePct != null ? ` (change ${sgn(s.changePct)}%)` : ""}; lowest ${n(s.minPrice)}, highest ${n(s.maxPrice)}.`
      : `Listed price: ${n(s.lastPrice)} on ${longDate(s.lastDate)}.`,
  );
  if (s.hasDiscountData) lines.push(`Discount applied on ${s.discountSnapshots} of ${p.series.filter((x) => x.discount != null).length} snapshots (${s.discountPct}%).`);
  if (s.promos.length) lines.push(`Promotions seen: ${s.promos.slice(0, 4).map((x) => `${x.name} (${x.snapshots} snapshot${x.snapshots === 1 ? "" : "s"})`).join(", ")}.`);
  if (s.lastRating != null) lines.push(s.snapshots > 1 && s.firstRating != null ? `Rating: ${n(s.firstRating)} on ${longDate(s.firstDate)} and ${n(s.lastRating)} on ${longDate(s.lastDate)}.` : `Rating: ${n(s.lastRating)}.`);
  if (s.lastReviews != null) lines.push(`Total reviews: ${s.firstReviews !== s.lastReviews && s.firstReviews != null ? `${s.firstReviews} to ${s.lastReviews}` : s.lastReviews}${s.newReviews != null && s.snapshots > 1 ? `; ${s.newReviews} new review${s.newReviews === 1 ? "" : "s"} recorded over the period` : ""}.`);
  if (s.stockLowPct != null) lines.push(`Stock status: low or out of stock on ${s.stockLowSnapshots} of ${p.series.filter((x) => x.stock).length} snapshots (${s.stockLowPct}%); latest status ${s.latestStock}.`);
  if (p.comparableSku) lines.push(`Comparable seller product: ${p.comparableSku}.`);
  return lines.join("\n");
}

/** Everything the screen needs about a product, in one place. */
export function describeProduct(p: TrackedProduct) {
  return { ...p, summary: summarizeProduct(p), moves: priceMoves(p) };
}
