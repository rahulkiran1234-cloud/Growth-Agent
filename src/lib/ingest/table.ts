import { parse } from "csv-parse/sync";
import { readSheet } from "read-excel-file/node";

export const MAX_ROWS = 200_000;
const DELIMS = [",", ";", "\t", "|"] as const;

export type TableMeta = {
  format: "csv" | "xlsx";
  delimiter?: string;
  /** Rows found above the header row (titles, report metadata, blank lines) and ignored. */
  skippedRows: number;
  encoding?: string;
};
export type Table = { headers: string[]; rows: string[][]; meta: TableMeta };

// ---- text decoding + delimiter sniffing -----------------------------------------------------

export function decodeText(buf: Buffer): { text: string; encoding: string } {
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(buf.subarray(2)), encoding: "utf-16le" };
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(buf.subarray(2)), encoding: "utf-16be" };
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString("utf8"), encoding: "utf-8" };
  // UTF-16 without a BOM shows up as lots of NUL bytes.
  const sample = buf.subarray(0, 400);
  if (sample.length > 4 && sample.filter((b) => b === 0).length > sample.length / 4) {
    return { text: new TextDecoder("utf-16le").decode(buf), encoding: "utf-16le" };
  }
  return { text: buf.toString("utf8"), encoding: "utf-8" };
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0, q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === d && !q) n++;
  }
  return n;
}

/** Picks the delimiter that splits the first lines into a consistent number of columns. */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 25);
  let best = ",", bestScore = -1;
  for (const d of DELIMS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const freq = new Map<number, number>();
    counts.filter((c) => c > 0).forEach((c) => freq.set(c, (freq.get(c) ?? 0) + 1));
    if (freq.size === 0) continue;
    const [mode, modeFreq] = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    const score = modeFreq * 1000 + mode; // consistency first, then width
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}

// ---- header row detection -------------------------------------------------------------------

const isNumeric = (s: string) => /^-?[\d.,₹$€£\s]+$/.test(s) || /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(s);
const filled = (r: string[]) => r.filter((c) => c.trim() !== "");

/** Finds the first row that looks like column titles, skipping report titles or blank preambles. */
export function detectHeaderRow(rows: string[][]): number {
  const window = rows.slice(0, 25);
  const widths = window.map((r) => filled(r).length);
  const freq = new Map<number, number>();
  widths.filter((w) => w >= 2).forEach((w) => freq.set(w, (freq.get(w) ?? 0) + 1));
  if (freq.size === 0) return 0;
  const modal = [...freq.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  for (let i = 0; i < window.length - 1; i++) {
    const cells = filled(window[i]);
    if (cells.length < modal) continue;
    const textual = cells.filter((c) => !isNumeric(c.trim())).length;
    if (textual / cells.length >= 0.6) return i;
  }
  return 0;
}

// ---- main entry -----------------------------------------------------------------------------

function finish(raw: string[][], meta: Omit<TableMeta, "skippedRows">): Table {
  const h = detectHeaderRow(raw);
  const headerCells = raw[h] ?? [];
  const width = Math.max(headerCells.length, ...raw.slice(h + 1, h + 50).map((r) => r.length));
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    const base = (headerCells[i] ?? "").trim() || `column_${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`; // duplicate titles get a suffix instead of failing
  });
  const rows = raw
    .slice(h + 1)
    .filter((r) => filled(r).length > 0)
    .map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim()));
  if (rows.length === 0) throw new Error("The file has no data rows.");
  if (rows.length > MAX_ROWS) throw new Error(`Too many rows (${rows.length}). The MVP limit is ${MAX_ROWS}.`);
  return { headers, rows, meta: { ...meta, skippedRows: h } };
}

const cellToString = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
};

export async function readTable(buf: Buffer, filename: string): Promise<Table> {
  const ext = filename.toLowerCase().split(".").pop();

  if (ext === "xlsx") {
    let data: unknown[][];
    try {
      data = (await readSheet(buf)) as unknown[][]; // first sheet
    } catch {
      throw new Error("Couldn't read this Excel file. Save it as .xlsx (not .xls) or export it as CSV.");
    }
    return finish(data.map((r) => r.map(cellToString)), { format: "xlsx" });
  }
  if (ext === "xls") throw new Error("Old .xls files aren't supported. Re-save as .xlsx or CSV.");

  const { text, encoding } = decodeText(buf);
  const delimiter = sniffDelimiter(text);
  let raw: string[][];
  try {
    raw = parse(text, { columns: false, skip_empty_lines: true, relax_column_count: true, relax_quotes: true, delimiter }) as string[][];
  } catch (e) {
    throw new Error(`Couldn't parse this as a table: ${(e as Error).message}`);
  }
  if (raw.length < 2) throw new Error("The file has no data rows.");
  return finish(raw, { format: "csv", delimiter, encoding });
}

export function describeMeta(m: TableMeta): string[] {
  const out: string[] = [];
  if (m.format === "xlsx") out.push("Read the first sheet of the Excel file.");
  if (m.delimiter && m.delimiter !== ",") out.push(`Detected ${m.delimiter === ";" ? "semicolon" : m.delimiter === "\t" ? "tab" : "pipe"}-separated values.`);
  if (m.encoding && m.encoding !== "utf-8") out.push(`Converted from ${m.encoding.toUpperCase()}.`);
  if (m.skippedRows > 0) out.push(`Ignored ${m.skippedRows} row${m.skippedRows > 1 ? "s" : ""} above the column titles.`);
  return out;
}
