import type Anthropic from "@anthropic-ai/sdk";
import { hybridSearch } from "@/lib/rag/search";
import { embed } from "@/lib/rag/voyage";
import { formatHitsForPrompt } from "@/lib/rag/citations";
import { KPI_SECTIONS, KpiSection, sqlKpis } from "./kpis";
import { isKnown, extractNumbers, safeCalc } from "./gate";
import { dataNumbers, Ledger, Roi } from "./ledger";

export type ToolResult = { content: string; summary: string };

// ---- definitions ------------------------------------------------------------------------------

export const SQL_KPIS_TOOL: Anthropic.Tool = {
  name: "sql_kpis",
  description: "Compute KPIs from the seller's uploaded data. Returns JSON rows. Cite results as \"sql_kpis:<section>\" (or \"sql_kpis:sku_trend:<SKU>\").",
  input_schema: {
    type: "object",
    properties: {
      section: { type: "string", enum: [...KPI_SECTIONS] },
      sku: { type: "string", description: "Required only for section=sku_trend, e.g. SKU-01" },
    },
    required: ["section"],
  },
};

export const VECTOR_SEARCH_TOOL: Anthropic.Tool = {
  name: "vector_search",
  description:
    "Search the seller's uploaded competitor documents. Returns passages, each with a [chunk:N] id. " +
    "You MUST cite these ids for any competitor claim. Use a specific topic (e.g. 'free shipping threshold', 'return policy'). " +
    "You may issue several searches in one turn.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string" },
      competitor: { type: "string", description: "Optional: restrict to one competitor by exact name" },
      k: { type: "integer", minimum: 1, maximum: 10 },
    },
    required: ["query"],
  },
};

export const CALC_TOOL: Anthropic.Tool = {
  name: "calc",
  description:
    "Exact arithmetic. Use it for EVERY percentage change, difference or ratio you state; never do maths in your head. " +
    "Supports + - * / ^ ( ) and %. Example: (1499 - 1319) / 1499 * 100",
  input_schema: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
};

export const CALC_ROI_TOOL: Anthropic.Tool = {
  name: "calc_roi",
  description:
    "Estimate the monthly gain of a solution. baseline_monthly MUST be a number from sql_kpis (e.g. last month's revenue of the affected SKUs). " +
    "The lift percentages are YOUR ASSUMPTIONS: keep them conservative and explain the basis. Returns an roi_id to reference in the solution.",
  input_schema: {
    type: "object",
    properties: {
      label: { type: "string", description: "What this estimate is for" },
      baseline_monthly: { type: "number", description: "Monthly revenue (or other money amount) the change applies to, taken from sql_kpis" },
      affected_share_pct: { type: "number", description: "Share of that baseline the change affects, 0-100" },
      lift_low_pct: { type: "number", description: "Conservative % improvement on the affected amount, 0-30" },
      lift_high_pct: { type: "number", description: "Optimistic % improvement, >= lift_low_pct, max 30 (above 15 needs strong evidence)" },
      one_time_cost: { type: "number", description: "Estimated one-off cost, same units (0 if none)" },
      basis: { type: "string", description: "Why these lift values are reasonable (an assumption, not a measurement)" },
    },
    required: ["label", "baseline_monthly", "affected_share_pct", "lift_low_pct", "lift_high_pct", "basis"],
  },
};

// ---- executors (each records what it returned in the ledger) -------------------------------------

export async function execSqlKpis(projectId: string, ledger: Ledger, input: { section: KpiSection; sku?: string }): Promise<ToolResult> {
  if (!KPI_SECTIONS.includes(input.section)) return { content: `Unknown section "${input.section}". Use one of: ${KPI_SECTIONS.join(", ")}`, summary: "invalid section" };
  const data = await sqlKpis(projectId, input.section, input.sku);
  const key = `sql_kpis:${input.section}${input.sku ? `:${input.sku}` : ""}`;
  const content = JSON.stringify(data);
  ledger.kpi[key] = content;
  return { content, summary: `${key} → ${Array.isArray(data) ? data.length + " rows" : "1 result"}` };
}

/** Embeds all queries of one model turn in a single request (the free Voyage tier allows only 3
 *  requests a minute) and remembers them, so repeated searches never re-embed. */
export async function prefetchQueryEmbeddings(cache: Map<string, number[]>, queries: string[]) {
  const todo = [...new Set(queries.filter((q) => typeof q === "string" && q.length > 0 && !cache.has(q)))];
  if (todo.length === 0) return;
  const vecs = await embed(todo, "query");
  todo.forEach((q, i) => cache.set(q, vecs[i]));
}

export async function execVectorSearch(projectId: string, ledger: Ledger, input: { query: string; competitor?: string; k?: number }, cache?: Map<string, number[]>): Promise<ToolResult> {
  const hits = await hybridSearch({ projectId, query: input.query, competitor: input.competitor ?? null, k: Math.min(input.k ?? 6, 10), queryEmbedding: cache?.get(input.query) });
  for (const h of hits) {
    ledger.passages[h.sourceId] = { content: h.content, competitor: h.competitor, title: h.title, page: h.page, docDate: h.docDate };
  }
  return { content: formatHitsForPrompt(hits), summary: `"${input.query}"${input.competitor ? ` (${input.competitor})` : ""} → ${hits.length} passages` };
}

export function execCalc(ledger: Ledger, input: { expression: string }): ToolResult {
  try {
    const result = safeCalc(input.expression);
    ledger.calc.push({ expr: input.expression, result });
    return { content: String(result), summary: `${input.expression} = ${result}` };
  } catch (e) {
    return { content: `Calculation error: ${(e as Error).message}`, summary: "calc error" };
  }
}

export type RoiInput = {
  label: string; baseline_monthly: number; affected_share_pct: number; lift_low_pct: number; lift_high_pct: number; one_time_cost?: number; basis: string;
};

export function execCalcRoi(ledger: Ledger, input: RoiInput): ToolResult {
  const err = (m: string): ToolResult => ({ content: `ROI error: ${m}`, summary: "roi error" });
  const { baseline_monthly: base, affected_share_pct: share, lift_low_pct: lo, lift_high_pct: hi } = input;
  if (![base, share, lo, hi].every((n) => typeof n === "number" && Number.isFinite(n))) return err("all numeric inputs are required.");
  if (base <= 0) return err("baseline_monthly must be positive.");
  if (share <= 0 || share > 100) return err("affected_share_pct must be between 0 and 100.");
  if (lo < 0 || hi < lo || hi > 30) return err("need 0 <= lift_low_pct <= lift_high_pct <= 30.");
  if (!input.basis || input.basis.trim().length < 15) return err("explain the basis for the lift assumption.");
  // The baseline must come from seller data, not from the model's imagination.
  const [tok] = extractNumbers(String(base));
  if (!tok || !isKnown({ ...tok, decimals: 0 }, dataNumbers(ledger))) {
    return err(`baseline_monthly ${base} does not match any number returned by sql_kpis or calc. Fetch it first (e.g. sku_trend) and use that figure.`);
  }
  const id = `roi:${Object.keys(ledger.roi).length + 1}`;
  const r: Roi = {
    id, label: input.label, baseline_monthly: base, affected_share_pct: share, lift_low_pct: lo, lift_high_pct: hi,
    gain_low_monthly: Math.round(base * (share / 100) * (lo / 100)),
    gain_high_monthly: Math.round(base * (share / 100) * (hi / 100)),
    one_time_cost: Math.max(0, Math.round(input.one_time_cost ?? 0)), basis: input.basis.trim(),
  };
  ledger.roi[id] = r;
  return { content: JSON.stringify({ roi_id: id, gain_low_monthly: r.gain_low_monthly, gain_high_monthly: r.gain_high_monthly, one_time_cost: r.one_time_cost }), summary: `${id}: ${r.gain_low_monthly}–${r.gain_high_monthly}/month` };
}
