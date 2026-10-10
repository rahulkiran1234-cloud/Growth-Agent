import { describe, expect, it } from "vitest";
import writeExcelFile from "write-excel-file/node";
import { decodeText, detectHeaderRow, readTable, sniffDelimiter } from "./table";

const buf = (s: string) => Buffer.from(s, "utf8");

describe("sniffDelimiter", () => {
  it("detects comma, semicolon, tab and pipe", () => {
    expect(sniffDelimiter("a,b,c\n1,2,3\n4,5,6")).toBe(",");
    expect(sniffDelimiter("a;b;c\n1;2;3\n4;5;6")).toBe(";");
    expect(sniffDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(sniffDelimiter("a|b|c\n1|2|3")).toBe("|");
  });
  it("ignores delimiters inside quotes and decimal commas in semicolon files", () => {
    expect(sniffDelimiter('name;price\n"Lamp, large";1,5\n"Rug, small";2,5')).toBe(";");
  });
});

describe("detectHeaderRow", () => {
  it("skips title and blank preamble rows", () => {
    const rows = [["Sales report Q3", "", ""], ["Generated 2026-10-01", "", ""], ["", "", ""], ["date", "sku", "total"], ["2026-01-01", "A", "10"], ["2026-01-02", "B", "20"]];
    expect(detectHeaderRow(rows)).toBe(3);
  });
  it("returns 0 for a normal file", () => {
    expect(detectHeaderRow([["date", "sku"], ["2026-01-01", "A"], ["2026-01-02", "B"]])).toBe(0);
  });
});

describe("decodeText", () => {
  it("decodes UTF-16 LE with BOM and strips the UTF-8 BOM", () => {
    const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("a,b\n1,2", "utf16le")]);
    expect(decodeText(u16)).toEqual({ text: "a,b\n1,2", encoding: "utf-16le" });
    expect(decodeText(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf("x,y")])).text).toBe("x,y");
  });
});

describe("readTable", () => {
  it("reads a semicolon file with a preamble and padded headers", async () => {
    const t = await readTable(buf("Report;;\nrun on 5 Oct;;\nDate;SKU;Total\n01/02/2026;A;1.499,00\n02/02/2026;B;250,00\n"), "x.csv");
    expect(t.headers).toEqual(["Date", "SKU", "Total"]);
    expect(t.rows).toHaveLength(2);
    expect(t.meta).toMatchObject({ delimiter: ";", skippedRows: 2 });
  });
  it("suffixes duplicate and empty header names instead of failing", async () => {
    const t = await readTable(buf("a,a,\n1,2,3\n"), "x.csv");
    expect(t.headers).toEqual(["a", "a_2", "column_3"]);
  });
  it("rejects files with no data rows", async () => {
    await expect(readTable(buf("only,header\n"), "x.csv")).rejects.toThrow(/no data rows/);
  });
  it("round-trips an .xlsx file including dates and numbers", async () => {
    const xlsx = await writeExcelFile([
      ["order_date", "sku", "revenue"],
      [{ value: new Date(Date.UTC(2026, 3, 1)), format: "yyyy-mm-dd" }, "SKU-1", 1499.5],
      [{ value: new Date(Date.UTC(2026, 3, 2)), format: "yyyy-mm-dd" }, "SKU-2", 250],
    ] as never).toBuffer();
    const t = await readTable(Buffer.from(xlsx), "sales.xlsx");
    expect(t.headers).toEqual(["order_date", "sku", "revenue"]);
    expect(t.rows[0]).toEqual(["2026-04-01", "SKU-1", "1499.5"]);
    expect(t.meta.format).toBe("xlsx");
  });
  it("gives a helpful error for corrupt xlsx and old xls", async () => {
    await expect(readTable(buf("not a zip"), "bad.xlsx")).rejects.toThrow(/Excel/);
    await expect(readTable(buf("x"), "old.xls")).rejects.toThrow(/\.xls/);
  });
});
