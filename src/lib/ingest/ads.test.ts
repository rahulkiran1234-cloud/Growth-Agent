import { describe, expect, it } from "vitest";
import { autoMap, missingRequired } from "./columns";
import { looksLikeAds, processAds } from "./ads-parse";

// The header row the seller's own ads export uses.
const HEADERS = ["date", "sku", "product_name", "campaign_name", "impressions", "clicks", "spend_inr", "cpc_inr", "orders_attributed", "units_sold", "sales_attributed_inr", "ctr_pct", "conversion_rate_pct", "acos_pct", "roas"];
const row = (date: string, sku: string, camp: string, imp: number, clk: number, spend: number, orders: number, sales: number) =>
  [date, sku, "500ml 2-in-1", camp, String(imp), String(clk), String(spend), "", String(orders), String(orders), String(sales), "", "", "", ""];

describe("ads column detection", () => {
  const m = autoMap("ads", HEADERS);
  it("maps the seller's own export without help", () => {
    expect(m).toMatchObject({
      date: "date", sku: "sku", campaign: "campaign_name", spend: "spend_inr", ad_sales: "sales_attributed_inr", product_name: "product_name",
      impressions: "impressions", clicks: "clicks", orders: "orders_attributed", units: "units_sold",
    });
    expect(missingRequired("ads", m)).toEqual([]);
  });
  it("does not map the ratios we recompute (cpc, ctr, conversion, acos, roas)", () => {
    const used = Object.values(m);
    for (const h of ["cpc_inr", "ctr_pct", "conversion_rate_pct", "acos_pct", "roas"]) expect(used).not.toContain(h);
  });
  it("understands other common names", () => {
    const o = autoMap("ads", ["Day", "Advertised SKU", "Campaign Name", "Ad Spend", "Total Revenue", "Views", "Clicks"]);
    expect(o).toMatchObject({ date: "Day", sku: "Advertised SKU", campaign: "Campaign Name", spend: "Ad Spend", ad_sales: "Total Revenue", impressions: "Views", clicks: "Clicks" });
  });
  it("reports what is missing", () => expect(missingRequired("ads", autoMap("ads", ["date", "sku", "clicks"]))).toEqual(["Ad spend", "Sales from ads"]));
  it("recognises an ads report, and not a sales file", () => {
    expect(looksLikeAds(HEADERS)).toBe(true);
    expect(looksLikeAds(["order_date", "order_id", "sku", "units", "price", "revenue", "returned", "customer_id"])).toBe(false);
  });
});

describe("processAds", () => {
  const map = autoMap("ads", HEADERS);
  const ok = [
    row("01-07-2026", "SKU-01", "Auto", 487, 12, 140.5, 1, 1454),
    row("02-07-2026", "SKU-01", "Auto", 363, 9, 99, 0, 0),
    row("02-07-2026", "SKU-02", "Auto", 440, 10, 120, 2, 2400),
  ];
  it("loads valid rows", () => {
    const r = processAds(ok, HEADERS, map);
    expect(r.report.blockers).toEqual([]);
    expect(r.records).toHaveLength(3);
    expect(r.records[0]).toMatchObject({ date: "2026-07-01", sku: "SKU-01", campaign: "Auto", spend: 140.5, adSales: 1454, clicks: 12, orders: 1 });
    expect(r.report.distinctSkus).toBe(2);
    expect(r.report.dateRange).toMatchObject({ from: "2026-07-01", to: "2026-07-02" });
  });
  it("rejects rows with a bad date, missing SKU or unreadable money, and says why", () => {
    const bad = [...ok, row("not a date", "SKU-01", "A", 1, 1, 5, 0, 0), row("03-07-2026", "", "A", 1, 1, 5, 0, 0), row("03-07-2026", "SKU-03", "A", 1, 1, -5, 0, 0)];
    const r = processAds(bad, HEADERS, map);
    expect(r.records).toHaveLength(3);
    expect(Object.keys(r.report.rejected.reasons).sort()).toEqual(["Invalid or missing ad spend (must be 0 or more)", "Invalid or missing date", "Missing SKU"]);
  });
  it("adds up rows that share a day, SKU and campaign (ad groups) instead of dropping them", () => {
    const rows = [row("01-07-2026", "SKU-01", "Auto", 100, 5, 50, 1, 500), row("01-07-2026", "sku-01", "auto", 200, 7, 70, 0, 0), ...ok.slice(1)];
    const r = processAds(rows, HEADERS, map);
    const a = r.records.find((x) => x.date === "2026-07-01")!;
    expect(a).toMatchObject({ impressions: 300, clicks: 12, spend: 120, orders: 1, adSales: 500 });
    expect(r.report.warnings.join(" ")).toMatch(/added together/);
  });
  it("treats blank counts as zero but blocks a file with no spend at all", () => {
    const r = processAds([row("01-07-2026", "A", "", 0, 0, 0, 0, 0), row("02-07-2026", "A", "", 0, 0, 0, 0, 0), row("03-07-2026", "A", "", 0, 0, 0, 0, 0)], HEADERS, map);
    expect(r.report.blockers.join(" ")).toMatch(/zero ad spend/);
  });
  it("blocks when most rows are rejected or there are too few", () => {
    expect(processAds(ok.slice(0, 2), HEADERS, map).report.blockers.join(" ")).toMatch(/at least 3/);
    const junk = Array.from({ length: 5 }, () => row("x", "A", "", 1, 1, 1, 0, 0));
    expect(processAds([...ok, ...junk], HEADERS, map).report.blockers.join(" ")).toMatch(/30%/);
  });
  it("accepts currency symbols and thousands separators", () => {
    const r = processAds([row("01-07-2026", "A", "x", 10, 1, 5, 1, 1), ["02-07-2026", "A", "", "x", "10", "1", "₹1,250.50", "", "1", "1", "₹12,499", "", "", "", ""], row("03-07-2026", "A", "x", 1, 1, 1, 0, 0)], HEADERS, map);
    expect(r.records[1]).toMatchObject({ spend: 1250.5, adSales: 12499 });
  });
  it("warns about suspicious columns and short history", () => {
    const r = processAds([row("01-07-2026", "A", "x", 5, 20, 50, 0, 900), ...ok], HEADERS, map);
    const w = r.report.warnings.join(" ");
    expect(w).toMatch(/more clicks than impressions/);
    expect(w).toMatch(/ad sales but zero orders/);
    expect(w).toMatch(/Only \d+ days/);
  });
  it("works without a campaign column", () => {
    const h = HEADERS.filter((x) => x !== "campaign_name");
    const rows = ok.map((r) => r.filter((_, i) => i !== 3));
    const r = processAds(rows, h, autoMap("ads", h));
    expect(r.records.every((x) => x.campaign === "")).toBe(true);
    expect(r.report.warnings.join(" ")).toMatch(/No campaign column/);
  });
});
