import { autoMap, type Mapping } from "./columns";
import { newReport, parseDate, parseNum, reject, TRUE_SET, type Report } from "./validate";

// Competitor tracker uploads: a CSV/Excel of competitor product snapshots over time (one row per product per date).

export type TrackerRecord = {
  date: string; competitor: string; product: string; category: string | null; price: number; discount: boolean | null;
  rating: number | null; totalReviews: number | null; newReviews: number | null; stock: string | null; promo: string | null;
  dataType: string | null; comparableSku: string | null;
};

const DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/;

/** Day-first unless the file proves month-first (some date has a second part above 12 and none has a first part above 12). */
export function detectDateOrder(values: string[]): { monthFirst: boolean; allAmbiguous: boolean } {
  let firstOver = false, secondOver = false, any = 0, ambiguous = 0;
  for (const v of values) {
    const m = DMY.exec(v.trim());
    if (!m) continue;
    any++;
    const a = +m[1], b = +m[2];
    if (a > 12) firstOver = true;
    else if (b > 12) secondOver = true;
    else if (a !== b) ambiguous++;
  }
  return { monthFirst: secondOver && !firstOver, allAmbiguous: any > 0 && !firstOver && !secondOver && ambiguous > 0 };
}

export function normalizeDate(raw: string, monthFirst: boolean): string | null {
  const s = (raw ?? "").trim();
  const m = DMY.exec(s);
  if (m && monthFirst && +m[1] <= 12 && +m[2] <= 12) return parseDate(`${m[2]}-${m[1]}-${m[3]}`).iso;
  return parseDate(s).iso;
}

/** True when a CSV's headers look like a competitor tracker file (so it is not mistaken for a document). */
export function looksLikeTracker(headers: string[]): boolean {
  const m = autoMap("competitor_tracker", headers);
  const hits = ["snapshot_date", "competitor", "product", "price", "discount_applied", "stock_status", "new_reviews", "total_reviews"].filter((f) => m[f]).length;
  return !!m.competitor && !!m.price && hits >= 4;
}

const cleanName = (s: string) => s.trim().replace(/\s+/g, " ");
const intOrNull = (raw: string | undefined) => { const v = parseNum(raw); return v != null && Number.isInteger(v) && v >= 0 ? v : null; };

export function processTracker(rows: string[][], headers: string[], mapping: Mapping) {
  const idx = (f: string) => (mapping[f] ? headers.indexOf(mapping[f]!) : -1);
  const [iDate, iComp, iProd, iCat, iPrice, iDisc, iRating, iTotal, iNew, iStock, iPromo, iType, iSku] =
    ["snapshot_date", "competitor", "product", "category", "price", "discount_applied", "rating", "total_reviews", "new_reviews", "stock_status", "promo", "data_type", "comparable_sku"].map(idx);
  const rep = newReport(rows.length);
  const order = detectDateOrder(rows.map((r) => r[iDate] ?? ""));
  const byKey = new Map<string, TrackerRecord>();
  let duplicates = 0;
  const casing = new Map<string, string>();

  rows.forEach((r, n) => {
    const line = n + 2;
    const date = normalizeDate(r[iDate] ?? "", order.monthFirst);
    if (!date) return reject(rep, line, "Invalid or missing snapshot date");
    const compRaw = cleanName(r[iComp] ?? "");
    if (!compRaw) return reject(rep, line, "Missing competitor name");
    const product = cleanName(r[iProd] ?? "");
    if (!product) return reject(rep, line, "Missing product name");
    const price = parseNum(r[iPrice]);
    if (price === null || price <= 0) return reject(rep, line, "Invalid or missing price (must be above 0)");
    const compKey = compRaw.toLowerCase();
    if (!casing.has(compKey)) casing.set(compKey, compRaw);
    const rating = iRating >= 0 ? parseNum(r[iRating]) : null;
    const rec: TrackerRecord = {
      date, competitor: casing.get(compKey)!, product, category: iCat >= 0 ? cleanName(r[iCat] ?? "") || null : null, price,
      discount: iDisc >= 0 && (r[iDisc] ?? "").trim() !== "" ? TRUE_SET.has((r[iDisc] ?? "").trim().toLowerCase()) : null,
      rating: rating != null && rating >= 0 && rating <= 5 ? Math.round(rating * 100) / 100 : null,
      totalReviews: iTotal >= 0 ? intOrNull(r[iTotal]) : null, newReviews: iNew >= 0 ? intOrNull(r[iNew]) : null,
      stock: iStock >= 0 ? cleanName(r[iStock] ?? "") || null : null, promo: iPromo >= 0 ? cleanName(r[iPromo] ?? "") || null : null,
      dataType: iType >= 0 ? cleanName(r[iType] ?? "") || null : null, comparableSku: iSku >= 0 ? cleanName(r[iSku] ?? "") || null : null,
    };
    const key = [compKey, product.toLowerCase(), date].join("|");
    if (byKey.has(key)) duplicates++;
    byKey.set(key, rec); // a later row for the same product and date wins
  });

  const records = [...byKey.values()];
  rep.validRows = records.length;
  rep.duplicateRows = duplicates;
  const products = new Set(records.map((r) => `${r.competitor.toLowerCase()}|${r.product.toLowerCase()}`));
  rep.distinctSkus = products.size;
  const dates = [...new Set(records.map((r) => r.date))].sort();
  if (dates.length) rep.dateRange = { from: dates[0], to: dates[dates.length - 1], days: Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 864e5) + 1 };

  if (rep.rejected.count / Math.max(rows.length, 1) > 0.3) rep.blockers.push(`More than 30% of rows were rejected (${rep.rejected.count} of ${rows.length}). Fix the file or the column mapping.`);
  if (rep.validRows < 3) rep.blockers.push(`Need at least 3 valid rows; found ${rep.validRows}.`);
  if (dates.length === 1) rep.warnings.push("Only one snapshot date, so there is no trend yet. Price comparison will work; trends need more dates.");
  if (order.monthFirst) rep.warnings.push("Dates were read month-first (a date in the file proved it).");
  else if (order.allAmbiguous) rep.warnings.push(`Dates like ${rows[0]?.[iDate] ?? "10-10-2025"} could be day-first or month-first; they were read day-first. Check the date range above.`);
  if (duplicates > 0) rep.warnings.push(`${duplicates} rows repeated a competitor, product and date; the last one was kept.`);
  const synthetic = new Set(records.map((r) => r.dataType).filter((t): t is string => !!t && /synthetic|sample|dummy|test|demo/i.test(t)));
  if (synthetic.size) rep.warnings.push(`This file's data_type says "${[...synthetic].join(", ")}": the analysis will treat these numbers as real, so only use this for demos.`);
  if (iDisc < 0) rep.warnings.push("No discount column mapped, so discount frequency won't be shown.");
  if (iStock < 0) rep.warnings.push("No stock-status column mapped, so availability won't be shown.");
  return { records, report: { ...rep, competitors: casing.size, products: products.size } as Report & { competitors: number; products: number } };
}
