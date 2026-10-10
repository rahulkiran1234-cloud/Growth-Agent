import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { autoMap, missingRequired } from "./columns";
import { readTable } from "./table";
import { detectDateOrder, looksLikeTracker, normalizeDate, processTracker } from "./tracker-parse";
import { longDate, passageFor, priceMoves, summarizeProduct, type TrackedProduct } from "@/lib/insights/tracker";

const HEADERS = ["snapshot_date", "competitor_name", "competitor_product_name", "category", "listed_price", "discount_applied", "rating", "total_reviews", "new_reviews", "estimated_stock_status", "badge_or_promo", "data_type"];

describe("mapping your tracker columns", () => {
  it("maps every column automatically, with no AI needed", () => {
    const m = autoMap("competitor_tracker", HEADERS);
    expect(m).toMatchObject({
      snapshot_date: "snapshot_date", competitor: "competitor_name", product: "competitor_product_name", category: "category", price: "listed_price",
      discount_applied: "discount_applied", rating: "rating", total_reviews: "total_reviews", new_reviews: "new_reviews", stock_status: "estimated_stock_status",
      promo: "badge_or_promo", data_type: "data_type",
    });
    expect(missingRequired("competitor_tracker", m)).toEqual([]);
  });
  it("tolerates other header spellings", () => {
    const m = autoMap("competitor_tracker", ["Date", "Competitor", "Product", "Price", "On Sale", "Stock"]);
    expect(m).toMatchObject({ snapshot_date: "Date", competitor: "Competitor", product: "Product", price: "Price", discount_applied: "On Sale", stock_status: "Stock" });
  });
  it("recognises a tracker file so it is not uploaded as a plain document", () => {
    expect(looksLikeTracker(HEADERS)).toBe(true);
    expect(looksLikeTracker(["product", "price", "rating"])).toBe(false);
    expect(looksLikeTracker(["order_date", "sku", "units", "revenue"])).toBe(false);
  });
});

describe("dates like 10-10-2025 and 11-10-2025", () => {
  it("reads day-first when nothing proves otherwise, and flags it", () => {
    expect(detectDateOrder(["10-10-2025", "11-10-2025"])).toEqual({ monthFirst: false, allAmbiguous: true });
    expect(normalizeDate("11-10-2025", false)).toBe("2025-10-11");
  });
  it("is certain once a date has a day above 12", () => {
    expect(detectDateOrder(["10-10-2025", "13-10-2025"])).toEqual({ monthFirst: false, allAmbiguous: false });
    expect(detectDateOrder(["10-13-2025", "10-14-2025"])).toEqual({ monthFirst: true, allAmbiguous: false });
    expect(normalizeDate("10-14-2025", true)).toBe("2025-10-14");
    expect(normalizeDate("03-04-2025", true)).toBe("2025-03-04");
  });
  it("still accepts ISO dates", () => expect(normalizeDate("2025-10-10", false)).toBe("2025-10-10"));
});

describe("processTracker on a file in your format", async () => {
  const { headers, rows } = await readTable(readFileSync("fixtures/competitor_tracker_sample.csv"), "competitor_tracker_sample.csv");
  const t = processTracker(rows, headers, autoMap("competitor_tracker", headers));

  it("imports every row with three competitors and three products", () => {
    expect(t.report.blockers).toEqual([]);
    expect(t.records).toHaveLength(42);
    expect(t.report).toMatchObject({ validRows: 42, competitors: 3, products: 3 });
    expect(t.report.dateRange).toEqual({ from: "2025-10-10", to: "2025-10-23", days: 14 });
  });
  it("warns that the data says it is synthetic", () => {
    expect(t.report.warnings.join(" ")).toMatch(/synthetic_competitor_tracking/);
  });
  it("parses types: discount flag, rating, promo and stock", () => {
    const a = t.records.find((r) => r.competitor === "COMP_A" && r.date === "2025-10-11")!;
    expect(a).toMatchObject({ price: 271, discount: true, rating: 4.2, promo: "Coupon 5%", stock: "Low Stock", category: "Kitchen" });
    expect(t.records.find((r) => r.competitor === "COMP_B" && r.date === "2025-10-10")!.discount).toBe(false);
  });
  it("rejects bad rows with a reason and refuses a mostly broken file", () => {
    const bad = processTracker([["10-10-2025", "A", "P", "x"], ["oops", "A", "P", "5"], ["11-10-2025", "", "P", "5"], ["12-10-2025", "A", "P", "-3"]], ["d", "c", "p", "price"], { snapshot_date: "d", competitor: "c", product: "p", price: "price" });
    expect(bad.report.rejected.reasons).toMatchObject({ "Invalid or missing snapshot date": 1, "Missing competitor name": 1, "Invalid or missing price (must be above 0)": 2 });
    expect(bad.report.blockers.join(" ")).toMatch(/30%/);
  });
  it("keeps the last row when a product repeats on the same date", () => {
    const d = processTracker([["10-10-2025", "A", "P", "10"], ["10-10-2025", "a", "P", "12"], ["11-10-2025", "A", "P", "13"]], ["d", "c", "p", "price"], { snapshot_date: "d", competitor: "c", product: "p", price: "price" });
    expect(d.records).toHaveLength(2);
    expect(d.records[0].price).toBe(12);
    expect(d.report.warnings.join(" ")).toMatch(/repeated/);
  });
});

const product = (series: Partial<TrackedProduct["series"][number]>[]): TrackedProduct => ({
  competitor: "COMP_A", product: "HomePro Oil Mister 500ml", category: "Kitchen", comparableSku: null, dataType: null,
  series: series.map((s, i) => ({ date: `2025-10-${String(10 + i).padStart(2, "0")}`, price: 100, discount: false, rating: 4.2, totalReviews: 400 + i, newReviews: 1, stock: "In Stock", promo: "None", ...s })),
});

describe("summaries and the passages the AI quotes", () => {
  const p = product([{}, { price: 95, discount: true, promo: "Coupon 5%", stock: "Low Stock" }, { price: 95, discount: true, promo: "Coupon 5%", stock: "Low Stock", newReviews: 3 }, { price: 100, newReviews: 0 }]);
  it("computes price change, discount share, promos, stock and review activity", () => {
    const s = summarizeProduct(p)!;
    expect(s).toMatchObject({ snapshots: 4, firstPrice: 100, lastPrice: 100, changePct: 0, minPrice: 95, maxPrice: 100, discountSnapshots: 2, discountPct: 50, stockLowSnapshots: 2, stockLowPct: 50, latestStock: "In Stock", newReviews: 5 });
    expect(s.promos).toEqual([{ name: "Coupon 5%", snapshots: 2 }]);
  });
  it("finds snapshot-to-snapshot price moves", () => {
    expect(priceMoves(p)).toEqual([{ date: "2025-10-11", from: 100, to: 95, pct: -5 }, { date: "2025-10-13", from: 95, to: 100, pct: 5.3 }]);
    expect(priceMoves(p, 6)).toEqual([]);
  });
  it("writes one short factual line per fact, with exact numbers", () => {
    const text = passageFor({ ...p, comparableSku: "SKU-01" })!;
    expect(text).toContain("Competitor tracker: COMP_A, HomePro Oil Mister 500ml (category Kitchen). 4 snapshots from 10 Oct 2025 to 13 Oct 2025.");
    expect(text).toContain("Listed price: 100 on 10 Oct 2025 and 100 on 13 Oct 2025 (change 0%); lowest 95, highest 100.");
    expect(text).toContain("Discount applied on 2 of 4 snapshots (50%).");
    expect(text).toContain("Promotions seen: Coupon 5% (2 snapshots).");
    expect(text).toContain("5 new reviews recorded over the period");
    expect(text).toContain("Comparable seller product: SKU-01.");
    expect(text.split("\n").every((l) => l.length < 200)).toBe(true);
  });
  it("copes with a single snapshot and missing optional columns", () => {
    const one = product([{ discount: null, rating: null, totalReviews: null, newReviews: null, stock: null, promo: null }]);
    const text = passageFor(one)!;
    expect(text).toContain("1 snapshot from 10 Oct 2025");
    expect(text).toContain("Listed price: 100 on 10 Oct 2025.");
    expect(text).not.toMatch(/Discount|Stock|Rating|reviews/);
    expect(passageFor({ ...one, series: [] })).toBeNull();
    expect(longDate("2025-10-05")).toBe("5 Oct 2025");
  });
});
