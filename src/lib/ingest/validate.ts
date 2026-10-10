import { createHash } from "node:crypto";
import type { Mapping } from "./columns";

export type Report = {
  totalRows: number;
  validRows: number;
  rejected: { count: number; reasons: Record<string, number>; samples: { line: number; reason: string }[] };
  dateRange: { from: string; to: string; days: number } | null;
  distinctSkus: number;
  duplicateRows: number;
  nullRates: Record<string, number>;
  currencySymbols: string[];
  warnings: string[];
  blockers: string[];
};

export type SaleRecord = {
  orderDate: string; sku: string; units: number; revenue: number; price: number; returned: boolean; customerHash: string | null;
};
export type ReviewRecord = { reviewDate: string; sku: string | null; rating: number; body: string };

// ---- primitive parsers -------------------------------------------------------------------------

export function parseDate(raw: string | undefined): { iso: string | null; ambiguous: boolean } {
  const s = (raw ?? "").trim();
  if (!s) return { iso: null, ambiguous: false };
  let y: number, m: number, d: number, ambiguous = false;
  let r = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (r) {
    [y, m, d] = [+r[1], +r[2], +r[3]];
  } else if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s))) {
    // Day-first by default (India/EU). If the middle part can't be a month, it's month-first.
    const a = +r[1], b = +r[2];
    y = +r[3];
    if (a > 12) [d, m] = [a, b];
    else if (b > 12) [m, d] = [a, b];
    else { [d, m] = [a, b]; ambiguous = a !== b; }
  } else return { iso: null, ambiguous: false };
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { iso: null, ambiguous: false };
  return { iso: dt.toISOString().slice(0, 10), ambiguous };
}

const CURRENCY = /(₹|\$|€|£|rs\.?|inr|usd|eur|gbp)/i;
export function parseNum(raw: string | undefined): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let c = s.replace(CURRENCY, "").replace(/\s/g, "");
  if (c.includes(",") && c.includes(".")) {
    // Both present: whichever comes last is the decimal mark ("1.499,00" European, "1,499.00" US).
    c = c.lastIndexOf(",") > c.lastIndexOf(".") ? c.replace(/\./g, "").replace(",", ".") : c.replace(/,/g, "");
  } else if (c.includes(",")) {
    // Only commas: "1,5" / "12,50" are decimals; "1,499" / "1,234,567" are thousands separators.
    c = /^-?\d+,\d{1,2}$/.test(c) ? c.replace(",", ".") : c.replace(/,/g, "");
  }
  if (!/^-?\d+(\.\d+)?$/.test(c)) return null;
  return Number(c);
}

export const TRUE_SET = new Set(["1", "true", "yes", "y", "returned", "refunded", "t"]);
const hashId = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 16);

// ---- shared report helpers -----------------------------------------------------------------

export function newReport(total: number): Report {
  return {
    totalRows: total, validRows: 0,
    rejected: { count: 0, reasons: {}, samples: [] },
    dateRange: null, distinctSkus: 0, duplicateRows: 0, nullRates: {}, currencySymbols: [],
    warnings: [], blockers: [],
  };
}
export function reject(rep: Report, line: number, reason: string) {
  rep.rejected.count++;
  rep.rejected.reasons[reason] = (rep.rejected.reasons[reason] ?? 0) + 1;
  if (rep.rejected.samples.length < 5) rep.rejected.samples.push({ line, reason });
}
function finishDates(rep: Report, dates: string[], ambiguousCount: number) {
  if (dates.length) {
    const sorted = [...dates].sort();
    const from = sorted[0], to = sorted[sorted.length - 1];
    rep.dateRange = { from, to, days: Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1 };
  }
  if (ambiguousCount > 0) rep.warnings.push(`${ambiguousCount} dates like 03/04/2026 are ambiguous; read as day/month/year.`);
}

// ---- sales -------------------------------------------------------------------------------------

export function processSales(rows: string[][], headers: string[], mapping: Mapping) {
  const idx = (f: string) => (mapping[f] ? headers.indexOf(mapping[f]!) : -1);
  const [iDate, iSku, iUnits, iRev, iPrice, iRet, iCust] = ["order_date", "sku", "units", "revenue", "price", "returned", "customer_id"].map(idx);
  const rep = newReport(rows.length);
  const records: SaleRecord[] = [];
  const dates: string[] = [];
  const skus = new Set<string>();
  const seen = new Set<string>();
  const currency = new Set<string>();
  let ambiguous = 0;
  let nullCust = 0, nullRet = 0;

  rows.forEach((r, n) => {
    const line = n + 2;
    const date = parseDate(r[iDate]);
    if (!date.iso) return reject(rep, line, "Invalid or missing order date");
    const sku = (r[iSku] ?? "").trim();
    if (!sku) return reject(rep, line, "Missing SKU");

    for (const i of [iRev, iPrice]) {
      const m = i >= 0 ? CURRENCY.exec(r[i] ?? "") : null;
      if (m) currency.add(m[1].toUpperCase());
    }

    let units = 1;
    if (iUnits >= 0) {
      const u = parseNum(r[iUnits]);
      if (u === null || !Number.isInteger(u) || u <= 0) return reject(rep, line, "Invalid units (must be a positive whole number)");
      units = u;
    }
    const revIn = iRev >= 0 ? parseNum(r[iRev]) : null;
    const priceIn = iPrice >= 0 ? parseNum(r[iPrice]) : null;
    if (iRev >= 0 && revIn === null && priceIn === null) return reject(rep, line, "Invalid revenue");
    if (revIn === null && priceIn === null) return reject(rep, line, "No revenue or price value");
    const revenue = revIn ?? priceIn! * units;
    const price = priceIn ?? revenue / units;
    if (revenue < 0 || price < 0) return reject(rep, line, "Negative revenue or price");

    const returned = iRet >= 0 ? TRUE_SET.has((r[iRet] ?? "").trim().toLowerCase()) : false;
    if (iRet >= 0 && !(r[iRet] ?? "").trim()) nullRet++;
    const cust = iCust >= 0 ? (r[iCust] ?? "").trim() : "";
    if (iCust >= 0 && !cust) nullCust++;

    const key = [date.iso, sku, units, revenue, cust].join("|");
    if (seen.has(key)) rep.duplicateRows++;
    seen.add(key);

    if (date.ambiguous) ambiguous++;
    dates.push(date.iso);
    skus.add(sku);
    records.push({ orderDate: date.iso, sku, units, revenue, price: +price.toFixed(2), returned, customerHash: cust ? hashId(cust) : null });
  });

  rep.validRows = records.length;
  rep.distinctSkus = skus.size;
  rep.currencySymbols = [...currency];
  if (iCust >= 0 && rows.length) rep.nullRates.customer_id = +((nullCust / rows.length) * 100).toFixed(1);
  if (iRet >= 0 && rows.length) rep.nullRates.returned = +((nullRet / rows.length) * 100).toFixed(1);
  finishDates(rep, dates, ambiguous);

  if (rep.rejected.count / Math.max(rows.length, 1) > 0.1) rep.blockers.push(`More than 10% of rows were rejected (${rep.rejected.count} of ${rows.length}). Fix the file or the column mapping.`);
  if (rep.validRows < 100) rep.blockers.push(`Need at least 100 valid orders for a trustworthy analysis; found ${rep.validRows}.`);
  if (rep.dateRange && rep.dateRange.days < 30) rep.blockers.push(`Need at least 30 days of history; found ${rep.dateRange.days}.`);
  if (rep.duplicateRows / Math.max(rep.validRows, 1) > 0.02) rep.warnings.push(`${rep.duplicateRows} rows look like exact duplicates; they were kept.`);
  if (iRet < 0) rep.warnings.push("No returned-flag column mapped, so return-rate analysis will be unavailable.");
  if (iUnits < 0) rep.warnings.push("No units column mapped; every order is counted as 1 unit.");
  if (rep.currencySymbols.length > 1) rep.warnings.push(`Multiple currency markers found (${rep.currencySymbols.join(", ")}); amounts are NOT converted.`);
  else if (rep.currencySymbols.length === 0) rep.warnings.push("No currency detected; amounts are treated as plain numbers.");

  return { records, report: rep };
}

// ---- reviews -----------------------------------------------------------------------------------

export function processReviews(rows: string[][], headers: string[], mapping: Mapping) {
  const idx = (f: string) => (mapping[f] ? headers.indexOf(mapping[f]!) : -1);
  const [iDate, iRating, iBody, iSku] = ["review_date", "rating", "body", "sku"].map(idx);
  const rep = newReport(rows.length);
  const records: ReviewRecord[] = [];
  const dates: string[] = [];
  let ambiguous = 0;

  rows.forEach((r, n) => {
    const line = n + 2;
    const date = parseDate(r[iDate]);
    if (!date.iso) return reject(rep, line, "Invalid or missing review date");
    const rating = parseNum(r[iRating]);
    if (rating === null || rating < 1 || rating > 5) return reject(rep, line, "Rating must be a number from 1 to 5");
    const body = (r[iBody] ?? "").trim();
    if (!body) return reject(rep, line, "Empty review text");
    if (date.ambiguous) ambiguous++;
    dates.push(date.iso);
    records.push({ reviewDate: date.iso, sku: iSku >= 0 ? (r[iSku] ?? "").trim() || null : null, rating: Math.round(rating), body: body.slice(0, 2000) });
  });

  rep.validRows = records.length;
  finishDates(rep, dates, ambiguous);
  if (rep.rejected.count / Math.max(rows.length, 1) > 0.3) rep.blockers.push(`More than 30% of rows were rejected (${rep.rejected.count} of ${rows.length}).`);
  if (rep.validRows < 20) rep.blockers.push(`Need at least 20 valid reviews; found ${rep.validRows}.`);
  if (iSku < 0) rep.warnings.push("No SKU column mapped; review themes can't be tied to products.");
  return { records, report: rep };
}
