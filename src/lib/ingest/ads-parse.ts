import { autoMap, type Mapping } from "./columns";
import { newReport, parseNum, reject, type Report } from "./validate";
import { detectDateOrder, normalizeDate } from "./tracker-parse";

// Ads uploads: one row per day, SKU and campaign from the seller's advertising report. Only SKU-level numbers are used.

export type AdRecord = {
  date: string; sku: string; campaign: string; productName: string | null;
  impressions: number; clicks: number; spend: number; orders: number; units: number; adSales: number;
};

export const DEFAULT_CAMPAIGN = "";

/**
 * True when headers look like an advertising report, so it is not mistaken for sales (both have a date, a SKU and a sales
 * column). Real ads reports carry clicks, impressions or campaigns. A daily sales summary that merely includes ad spend
 * and ad orders columns is a sales file and must still be accepted as one.
 */
export function looksLikeAds(headers: string[]): boolean {
  const m = autoMap("ads", headers);
  return !!m.spend && !!m.sku && !!m.date && ["impressions", "clicks", "campaign"].some((f) => m[f]);
}

const clean = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ");
const countOrZero = (raw: string | undefined) => { const v = parseNum(raw); return v != null && v >= 0 ? Math.round(v) : 0; };

export function processAds(rows: string[][], headers: string[], mapping: Mapping) {
  const idx = (f: string) => (mapping[f] ? headers.indexOf(mapping[f]!) : -1);
  const [iDate, iSku, iCamp, iSpend, iSales, iName, iImp, iClk, iOrd, iUnits] =
    ["date", "sku", "campaign", "spend", "ad_sales", "product_name", "impressions", "clicks", "ad_orders", "ad_units"].map(idx);
  const rep = newReport(rows.length);
  const order = detectDateOrder(rows.map((r) => r[iDate] ?? ""));
  const byKey = new Map<string, AdRecord>();
  let merged = 0, clicksOverImpressions = 0, salesWithoutOrders = 0;
  const casing = new Map<string, string>();
  const campaigns = new Set<string>();

  rows.forEach((r, n) => {
    const line = n + 2;
    const date = normalizeDate(r[iDate] ?? "", order.monthFirst);
    if (!date) return reject(rep, line, "Invalid or missing date");
    const skuRaw = clean(r[iSku]);
    if (!skuRaw) return reject(rep, line, "Missing SKU");
    const spend = parseNum(r[iSpend]);
    if (spend === null || spend < 0) return reject(rep, line, "Invalid or missing ad spend (must be 0 or more)");
    const adSales = parseNum(r[iSales]);
    if (adSales === null || adSales < 0) return reject(rep, line, "Invalid or missing sales from ads (must be 0 or more)");
    const skuKey = skuRaw.toLowerCase();
    if (!casing.has(skuKey)) casing.set(skuKey, skuRaw);
    const sku = casing.get(skuKey)!;
    const campaign = iCamp >= 0 ? clean(r[iCamp]) || DEFAULT_CAMPAIGN : DEFAULT_CAMPAIGN;
    const rec: AdRecord = {
      date, sku, campaign, productName: iName >= 0 ? clean(r[iName]) || null : null,
      impressions: iImp >= 0 ? countOrZero(r[iImp]) : 0, clicks: iClk >= 0 ? countOrZero(r[iClk]) : 0,
      spend: Math.round(spend * 100) / 100, orders: iOrd >= 0 ? countOrZero(r[iOrd]) : 0, units: iUnits >= 0 ? countOrZero(r[iUnits]) : 0,
      adSales: Math.round(adSales * 100) / 100,
    };
    if (rec.clicks > rec.impressions && iImp >= 0) clicksOverImpressions++;
    if (rec.adSales > 0 && iOrd >= 0 && rec.orders === 0) salesWithoutOrders++;
    campaigns.add(campaign);
    const key = [date, skuKey, campaign.toLowerCase()].join("|");
    const prev = byKey.get(key);
    if (prev) { // an export can list one day/SKU/campaign several times (ad groups, targets): add them up
      merged++;
      prev.impressions += rec.impressions; prev.clicks += rec.clicks; prev.spend = Math.round((prev.spend + rec.spend) * 100) / 100;
      prev.orders += rec.orders; prev.units += rec.units; prev.adSales = Math.round((prev.adSales + rec.adSales) * 100) / 100;
      prev.productName ??= rec.productName;
    } else byKey.set(key, rec);
  });

  const records = [...byKey.values()];
  rep.validRows = records.length;
  rep.distinctSkus = casing.size;
  const dates = [...new Set(records.map((r) => r.date))].sort();
  if (dates.length) rep.dateRange = { from: dates[0], to: dates[dates.length - 1], days: Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 864e5) + 1 };
  const totalSpend = records.reduce((a, r) => a + r.spend, 0);
  const totalSales = records.reduce((a, r) => a + r.adSales, 0);

  if (rep.rejected.count / Math.max(rows.length, 1) > 0.3) rep.blockers.push(`More than 30% of rows were rejected (${rep.rejected.count} of ${rows.length}). Fix the file or the column mapping.`);
  if (rep.validRows < 3) rep.blockers.push(`Need at least 3 valid rows; found ${rep.validRows}.`);
  if (rep.validRows >= 3 && totalSpend <= 0) rep.blockers.push("Every row has zero ad spend, so there is nothing to analyse. Check that the spend column is the right one.");
  if (rep.validRows >= 3 && totalSpend > 0 && totalSales <= 0) rep.warnings.push("No sales from ads in this file. If your ads did sell, the sales column is probably mapped to the wrong column.");
  if (rep.dateRange && rep.dateRange.days < 14) rep.warnings.push(`Only ${rep.dateRange.days} days of ads data. Advice on spend needs at least 4 weeks to be reliable.`);
  if (order.monthFirst) rep.warnings.push("Dates were read month-first (a date in the file proved it).");
  else if (order.allAmbiguous) rep.warnings.push(`Dates like ${rows[0]?.[iDate] ?? "10-10-2025"} could be day-first or month-first; they were read day-first. Check the date range above.`);
  if (merged > 0) rep.warnings.push(`${merged} rows repeated a date, SKU and campaign; they were added together.`);
  if (iCamp < 0) rep.warnings.push("No campaign column mapped, so all rows are treated as one campaign. SKU-level advice is unaffected.");
  if (clicksOverImpressions > 0) rep.warnings.push(`${clicksOverImpressions} rows have more clicks than impressions; check that those two columns are mapped correctly.`);
  if (salesWithoutOrders > 0) rep.warnings.push(`${salesWithoutOrders} rows have ad sales but zero orders; check the orders column.`);
  return { records, report: { ...rep, campaigns: campaigns.size, totalSpend: Math.round(totalSpend), totalAdSales: Math.round(totalSales) } as Report & { campaigns: number; totalSpend: number; totalAdSales: number } };
}
