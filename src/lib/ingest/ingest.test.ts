import { describe, expect, it } from "vitest";
import { autoMap, missingRequired } from "./columns";
import { parseDate, parseNum, processReviews, processSales } from "./validate";
import { chunkText } from "./chunk";

describe("autoMap", () => {
  it("maps common marketplace-style headers", () => {
    const m = autoMap("sales", ["Order Date", "Seller SKU", "Qty", "Item Total", "Unit Price", "Buyer ID"]);
    expect(m).toMatchObject({ order_date: "Order Date", sku: "Seller SKU", units: "Qty", revenue: "Item Total", price: "Unit Price", customer_id: "Buyer ID" });
  });
  it("uses each header once and leaves unknowns null", () => {
    const m = autoMap("reviews", ["date", "stars", "review text", "foo"]);
    expect(m).toMatchObject({ review_date: "date", rating: "stars", body: "review text", sku: null });
  });
  it("reports missing required fields", () => {
    expect(missingRequired("sales", { order_date: "d", sku: "s", units: null, revenue: null, price: null, returned: null, customer_id: null })).toContain("Revenue or unit price (at least one)");
  });
});

describe("parsers", () => {
  it("parses ISO and day-first dates, rejects impossible ones", () => {
    expect(parseDate("2026-04-01").iso).toBe("2026-04-01");
    expect(parseDate("25/12/2026").iso).toBe("2026-12-25");
    expect(parseDate("12/25/2026").iso).toBe("2026-12-25");
    expect(parseDate("03/04/2026")).toEqual({ iso: "2026-04-03", ambiguous: true });
    expect(parseDate("31/02/2026").iso).toBeNull();
    expect(parseDate("not a date").iso).toBeNull();
  });
  it("parses numbers with currency and separators", () => {
    expect(parseNum("₹1,499.50")).toBe(1499.5);
    expect(parseNum("Rs. 999")).toBe(999);
    expect(parseNum("1.499,00")).toBe(1499);
    expect(parseNum("1,499.00")).toBe(1499);
    expect(parseNum("12,50")).toBe(12.5);
    expect(parseNum("1,499")).toBe(1499);
    expect(parseNum("1,234,567")).toBe(1234567);
    expect(parseNum("abc")).toBeNull();
    expect(parseNum("")).toBeNull();
  });
});

const headers = ["date", "sku", "qty", "total"];
const mapping = { order_date: "date", sku: "sku", units: "qty", revenue: "total", price: null, returned: null, customer_id: null };
const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

describe("processSales", () => {
  it("accepts good rows and blocks thin data", () => {
    const rows = Array.from({ length: 5 }, (_, i) => [day(i), "A", "1", "100"]);
    const { report } = processSales(rows, headers, mapping);
    expect(report.validRows).toBe(5);
    expect(report.blockers.join(" ")).toMatch(/at least 100/);
  });
  it("passes a healthy dataset and flags no currency", () => {
    const rows = Array.from({ length: 150 }, (_, i) => [day(i % 60), `S${i % 7}`, "2", "250"]);
    const { report, records } = processSales(rows, headers, mapping);
    expect(report.blockers).toEqual([]);
    expect(records[0].price).toBe(125);
    expect(report.dateRange?.days).toBe(60);
    expect(report.warnings.join(" ")).toMatch(/No currency/);
  });
  it("rejects bad rows with reasons and blocks when >10% are bad", () => {
    const good = Array.from({ length: 100 }, (_, i) => [day(i % 40), "A", "1", "10"]);
    const bad = Array.from({ length: 20 }, () => ["bad-date", "A", "1", "10"]);
    const { report } = processSales([...good, ...bad], headers, mapping);
    expect(report.rejected.reasons["Invalid or missing order date"]).toBe(20);
    expect(report.blockers.join(" ")).toMatch(/10%/);
  });
  it("hashes customer ids", () => {
    const m = { ...mapping, customer_id: "cust" };
    const { records } = processSales([[day(0), "A", "1", "10", "alice@example.com"]], [...headers, "cust"], m);
    expect(records[0].customerHash).toMatch(/^[0-9a-f]{16}$/);
    expect(records[0].customerHash).not.toContain("alice");
  });
});

describe("processReviews", () => {
  it("validates rating range and empty text", () => {
    const rows = [["2026-01-01", "5", "great"], ["2026-01-02", "9", "bad rating"], ["2026-01-03", "3", ""]];
    const { report, records } = processReviews(rows, ["d", "r", "t"], { review_date: "d", rating: "r", body: "t", sku: null });
    expect(records).toHaveLength(1);
    expect(Object.keys(report.rejected.reasons)).toHaveLength(2);
  });
});

describe("chunkText", () => {
  it("keeps short text as one chunk", () => {
    expect(chunkText("Hello\n\nWorld")).toEqual(["Hello\n\nWorld"]);
  });
  it("splits long text with overlap and never exceeds the limit by much", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ` + "word ".repeat(60)).join("\n\n");
    const chunks = chunkText(text, 1000, 150);
    expect(chunks.length).toBeGreaterThan(5);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(1000 + 150));
    expect(chunks.join(" ")).toContain("Paragraph 39");
  });
  it("hard-splits a single huge paragraph", () => {
    expect(chunkText("x".repeat(5000), 2000, 200).length).toBeGreaterThanOrEqual(3);
  });
});
