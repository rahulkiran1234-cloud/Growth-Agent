// The evidence gate: pure functions that decide whether an agent claim is backed by data.
// Nothing here talks to the database or the model, so it is fully unit-testable.

// ---- quotes -----------------------------------------------------------------------------------

const norm = (s: string) =>
  s.toLowerCase().replace(/[‘’“”"']/g, "").replace(/[\s ]+/g, " ").trim();

/** True if `quote` really appears in `passage`, ignoring case, whitespace and quote marks.
 *  A quote may skip text with "..." between fragments, but every fragment must be real (8+
 *  chars), appear in order, and at least one fragment must be substantial (12+ chars). */
export function quoteInPassage(quote: string, passage: string): boolean {
  const frags = norm(quote)
    .split(/\.{3}|…/)
    .map((f) => f.replace(/^[\s.,;:]+|[\s.,;:]+$/g, ""))
    .filter(Boolean);
  if (frags.length === 0 || !frags.some((f) => f.length >= 12)) return false;
  const p = norm(passage);
  let from = 0;
  for (const f of frags) {
    if (f.length < 8) return false;
    const at = p.indexOf(f, from);
    if (at < 0) return false;
    from = at + f.length;
  }
  return true;
}

// ---- safe arithmetic --------------------------------------------------------------------------

/** Evaluates + - * / ^ ( ) and percentages without eval-ing arbitrary code. */
export function safeCalc(expr: string): number {
  const e = expr.replace(/,/g, "").replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)").replace(/\^/g, "**");
  if (!/^[0-9+\-*/().\s*]+$/.test(e)) throw new Error("Only numbers and + - * / ( ) % ^ are allowed.");
  const v = new Function(`"use strict"; return (${e});`)() as unknown;
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error("The expression did not produce a finite number.");
  return Math.round(v * 1e4) / 1e4;
}

// ---- number tracing ---------------------------------------------------------------------------

export type NumTok = { raw: string; value: number; decimals: number; pct: boolean; scale: number };

// Things that look like numbers but aren't data claims (ids, dates, timeline words, star ratings).
const NOISE: RegExp[] = [
  /\bSKU-?\d+\b/gi, /\bchunk:\d+\b/gi, /\broi:\d+\b/gi, /\b\d{4}-\d{2}(?:-\d{2})?\b/g, /\b[PS]\d+\b/g,
  /\b\d+-day\b/gi, /\b(?:week|day|step|phase|top)s?\s*\d+(?:\s*[-–]\s*\d+)?/gi,
  /\b\d+(?:\s*[-–]\s*\d+)?\s*(?:days?|weeks?|months?|stars?|★)/gi, /\b20\d{2}\b/g,
];
const NUM_RE = /(?<![\w.,])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s?%|[kKmM](?![a-zA-Z]))?/g;

export function extractNumbers(text: string): NumTok[] {
  // "9–12%" and "4–8 percentage points" are two percentages each, not one: expand them so both ends get checked.
  let t = text
    .replace(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*(?:%|percent\b|percentage points?\b|pp\b)/gi, "$1% $2%")
    .replace(/(\d+(?:\.\d+)?)\s*(?:percentage points?\b|percent\b|pp\b)/gi, "$1%");
  for (const re of NOISE) t = t.replace(re, " ");
  const out: NumTok[] = [];
  for (const m of t.matchAll(NUM_RE)) {
    const num = m[1].replace(/,/g, "");
    const suffix = (m[2] ?? "").trim().toLowerCase();
    out.push({
      raw: (m[1] + (m[2] ?? "")).trim(),
      value: parseFloat(num),
      decimals: num.includes(".") ? num.split(".")[1].length : 0,
      pct: suffix === "%",
      scale: suffix === "k" ? 1e3 : suffix === "m" ? 1e6 : 1,
    });
  }
  return out;
}

/** Only numbers that could be a factual claim are checked: percentages, decimals, 3+ digit values. */
const needsCheck = (n: NumTok) => n.pct || n.decimals > 0 || n.scale > 1 || String(Math.trunc(n.value)).length >= 3;

export function numbersFromJson(value: unknown, into: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) into.push(Math.abs(value));
  else if (typeof value === "string") for (const n of extractNumbers(value)) into.push(Math.abs(n.value * n.scale));
  else if (Array.isArray(value)) value.forEach((v) => numbersFromJson(v, into));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersFromJson(v, into));
  return into;
}

/** Does `n` match any known value, allowing for the rounding the writer used? */
export function isKnown(n: NumTok, known: number[]): boolean {
  const v = n.value * n.scale;
  if (n.scale > 1) return known.some((k) => k !== 0 && Math.abs(k - v) / Math.abs(k) <= 0.06);
  const tol = 0.5 * Math.pow(10, -n.decimals) + 1e-9;
  return known.some((k) => Math.abs(k - v) <= tol || (n.pct && Math.abs(k * 100 - v) <= tol));
}

const SKIP_KEYS = new Set(["evidence_ref", "ref", "source_id", "id", "problem_id", "solution_id", "roi_id", "quote", "seller_ref", "metric_ref"]);

function leaves(value: unknown, skip: Set<string>, key = "", out: { v: string | number }[] = []) {
  if (skip.has(key)) return out;
  if (typeof value === "string" || typeof value === "number") out.push({ v: value });
  else if (Array.isArray(value)) value.forEach((x) => leaves(x, skip, key, out));
  else if (value && typeof value === "object") for (const [k, x] of Object.entries(value)) leaves(x, skip, k, out);
  return out;
}

/** Numbers in `output` (excluding ids/refs/quotes) that match nothing in `known`. `extraSkipKeys`
 *  names fields that are explicitly labelled assumptions rather than claims about the data. */
export function untracedNumbers(output: unknown, known: number[], extraSkipKeys: string[] = []): string[] {
  const bad = new Set<string>();
  const skip = new Set([...SKIP_KEYS, ...extraSkipKeys]);
  for (const { v } of leaves(output, skip)) {
    const toks: NumTok[] = typeof v === "number" ? [{ raw: String(v), value: v, decimals: String(v).includes(".") ? String(v).split(".")[1].length : 0, pct: false, scale: 1 }] : extractNumbers(v);
    for (const t of toks) if (needsCheck(t) && !isKnown(t, known)) bad.add(t.raw);
  }
  return [...bad];
}

// ---- references -------------------------------------------------------------------------------

/** A metric ref like "sql_kpis:returns" is valid only if that query was actually run. A ref
 *  without a SKU suffix matches any SKU-specific call of the same section. */
export function isValidKpiRef(ref: string, kpiKeys: string[]): boolean {
  const r = ref.trim().toLowerCase();
  return kpiKeys.some((k) => k.toLowerCase() === r || k.toLowerCase().startsWith(r + ":"));
}
