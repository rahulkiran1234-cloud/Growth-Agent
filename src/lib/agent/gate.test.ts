import { describe, expect, it } from "vitest";
import { extractNumbers, isKnown, isValidKpiRef, numbersFromJson, quoteInPassage, safeCalc, untracedNumbers } from "./gate";

describe("quoteInPassage", () => {
  const passage = "Free shipping on all orders above Rs 999.\nOrders are packed in double-wall cartons with corner guards; damage rate below 1%.";
  it("accepts a faithful quote regardless of case, whitespace and quote marks", () => {
    expect(quoteInPassage("free shipping on all ORDERS above Rs 999", passage)).toBe(true);
    expect(quoteInPassage('"packed in double-wall cartons with corner guards"', passage)).toBe(true);
    expect(quoteInPassage("damage rate below 1%...", passage)).toBe(true);
  });
  it("allows skipping text with an ellipsis, but only between real in-order fragments", () => {
    expect(quoteInPassage("Free shipping on all orders ... double-wall cartons with corner guards", passage)).toBe(true);
    expect(quoteInPassage("double-wall cartons with corner guards ... Free shipping on all orders", passage)).toBe(false); // wrong order
    expect(quoteInPassage("Free shipping on all orders ... lifetime warranty applies", passage)).toBe(false); // invented fragment
    expect(quoteInPassage("Free shipping on all orders ... of ... and", passage)).toBe(false); // filler fragments
  });
  it("rejects invented, altered or too-short quotes", () => {
    expect(quoteInPassage("Free shipping on all orders above Rs 499", passage)).toBe(false);
    expect(quoteInPassage("cartons", passage)).toBe(false);
    expect(quoteInPassage("lifetime warranty on every product sold", passage)).toBe(false);
  });
});

describe("safeCalc", () => {
  it("evaluates arithmetic, percentages and powers", () => {
    expect(safeCalc("(1499 - 1319) / 1499 * 100")).toBe(12.0080);
    expect(safeCalc("1,000 * 12%")).toBe(120);
    expect(safeCalc("2^3")).toBe(8);
  });
  it("refuses anything that isn't plain arithmetic", () => {
    for (const bad of ["process.exit(1)", "1; alert(1)", "constructor", "1/0", "abc", "require('fs')"]) expect(() => safeCalc(bad)).toThrow();
  });
});

describe("extractNumbers", () => {
  it("ignores ids, dates, years and timeline words", () => {
    const toks = extractNumbers("SKU-01 in 2026-04 and Sep 2026: a 30-day plan, week 2, top 3, 4 stars, chunk:42");
    expect(toks).toEqual([]);
  });
  it("expands ranges and 'percentage points' so every end is checked", () => {
    expect(extractNumbers("a 9–12% lift").map((x) => x.raw)).toEqual(["9%", "12%"]);
    expect(extractNumbers("returns fall 4-8 percentage points").map((x) => x.raw)).toEqual(["4%", "8%"]);
    expect(extractNumbers("up 5 percent").map((x) => x.raw)).toEqual(["5%"]);
    expect(untracedNumbers({ d: "a 9–12% lift" }, [12, 9.2])).toEqual([]); // both ends match something
    expect(untracedNumbers({ d: "a 9–12% lift" }, [12])).toEqual(["9%"]); // the unsupported end is caught
    expect(extractNumbers("Weeks 1–2 and 2026-04 plan")).toEqual([]); // dates/timeline still ignored
  });
  it("parses separators, percentages and k/M suffixes", () => {
    const t = extractNumbers("Revenue 5,885,713 fell 13.8% to 5.9M; price 1.2k");
    expect(t.map((x) => x.raw)).toEqual(["5,885,713", "13.8%", "5.9M", "1.2k"]);
    expect(t[1]).toMatchObject({ pct: true, decimals: 1 });
    expect(t[2].scale).toBe(1e6);
  });
});

describe("untracedNumbers", () => {
  const known = [881072, 727577, 36.8, 21, 1499, 1319, 0.12];
  it("passes numbers that match data, allowing for rounding", () => {
    expect(untracedNumbers({ d: "Revenue fell from 881,072 to 727,577; low-rating share 36.8%; 21% returns" }, known)).toEqual([]);
    expect(untracedNumbers({ d: "about 36.75% (rounded from 36.8)" }, [36.75])).toEqual([]);
    expect(untracedNumbers({ d: "Revenue is about 0.7M" }, [727577])).toEqual([]);
  });
  it("treats a fraction in the data as matching the same percentage", () => {
    expect(untracedNumbers({ d: "a 12% reduction" }, known)).toEqual([]);
  });
  it("flags numbers that appear in no tool result", () => {
    expect(untracedNumbers({ d: "Return rate is 47% and revenue 1,234,567" }, known).sort()).toEqual(["1,234,567", "47%"]);
  });
  it("does not check small plain integers or skipped keys", () => {
    expect(untracedNumbers({ d: "3 SKUs and 12 reviews", evidence_ref: "sql_kpis:returns 99.5%", quote: "123.45" }, known)).toEqual([]);
  });
  it("can exempt fields that are labelled assumptions", () => {
    const out = { description: "A change", assumptions: ["we hope for a 22% lift"] };
    expect(untracedNumbers(out, known)).toEqual(["22%"]);
    expect(untracedNumbers(out, known, ["assumptions"])).toEqual([]);
  });
  it("checks numeric JSON values too", () => {
    expect(untracedNumbers({ share_pct: 15.2 }, [15.2])).toEqual([]);
    expect(untracedNumbers({ share_pct: 99.9 }, [15.2])).toEqual(["99.9"]);
  });
});

describe("isKnown / numbersFromJson", () => {
  it("collects numbers from nested JSON including number-like strings", () => {
    expect(numbersFromJson({ a: [{ revenue: 100.5 }], b: "1,200 units" }).sort((x, y) => x - y)).toEqual([100.5, 1200]);
  });
  it("matches within rounding tolerance only", () => {
    const tok = (value: number, decimals: number) => ({ raw: String(value), value, decimals, pct: false, scale: 1 });
    expect(isKnown(tok(13.8, 1), [13.77])).toBe(true);
    expect(isKnown(tok(13.8, 1), [13.9])).toBe(false);
  });
});

describe("isValidKpiRef", () => {
  const keys = ["sql_kpis:returns", "sql_kpis:sku_trend:SKU-01"];
  it("accepts executed queries, with or without the SKU suffix", () => {
    expect(isValidKpiRef("sql_kpis:returns", keys)).toBe(true);
    expect(isValidKpiRef("sql_kpis:sku_trend", keys)).toBe(true);
    expect(isValidKpiRef("SQL_KPIS:sku_trend:sku-01", keys)).toBe(true);
  });
  it("rejects queries that were never run", () => {
    expect(isValidKpiRef("sql_kpis:ratings", keys)).toBe(false);
    expect(isValidKpiRef("sql_kpis:sku_trend:SKU-02", keys)).toBe(false);
    expect(isValidKpiRef("made_up", keys)).toBe(false);
  });
});
