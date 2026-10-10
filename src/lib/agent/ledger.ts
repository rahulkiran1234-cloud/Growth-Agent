import { numbersFromJson, extractNumbers } from "./gate";

// The evidence ledger: everything the agent has actually seen or computed in this analysis.
// Steps may only cite what is in here. It is persisted with each step so a resumed run keeps it.
export type Passage = { content: string; competitor: string; title: string; page: number | null; docDate: string | null };

export type Roi = {
  id: string;
  label: string;
  baseline_monthly: number;
  affected_share_pct: number;
  lift_low_pct: number;
  lift_high_pct: number;
  gain_low_monthly: number;
  gain_high_monthly: number;
  one_time_cost: number;
  basis: string;
};

export type Ledger = {
  /** key like "sql_kpis:returns" or "sql_kpis:sku_trend:SKU-01" -> JSON result */
  kpi: Record<string, string>;
  passages: Record<string, Passage>;
  calc: { expr: string; result: number }[];
  roi: Record<string, Roi>;
};

export const emptyLedger = (): Ledger => ({ kpi: {}, passages: {}, calc: [], roi: {} });

/** Steps that ran in parallel each saved a snapshot; merge them into one complete ledger. */
export function mergeLedgers(ls: Ledger[]): Ledger {
  const out = emptyLedger();
  const seen = new Set<string>();
  for (const l of ls) {
    Object.assign(out.kpi, l.kpi);
    Object.assign(out.passages, l.passages);
    Object.assign(out.roi, l.roi);
    for (const c of l.calc) {
      const k = `${c.expr}=${c.result}`;
      if (!seen.has(k)) { seen.add(k); out.calc.push(c); }
    }
  }
  return out;
}

/** Numbers that came from seller data tools and calculations (valid ROI baselines). */
export function dataNumbers(l: Ledger): number[] {
  const out: number[] = [];
  for (const blob of Object.values(l.kpi)) {
    try { numbersFromJson(JSON.parse(blob), out); } catch { /* ignore malformed */ }
  }
  for (const c of l.calc) out.push(Math.abs(c.result));
  for (const r of Object.values(l.roi)) out.push(r.gain_low_monthly, r.gain_high_monthly, r.baseline_monthly, r.one_time_cost);
  return out;
}

/** Everything a claim could legitimately be traced to: data, calculations, retrieved passages
 *  and the outputs of earlier (already gated) steps. */
export function allKnownNumbers(l: Ledger, priorOutputs: unknown[] = []): number[] {
  const out = dataNumbers(l);
  for (const p of Object.values(l.passages)) for (const n of extractNumbers(p.content)) out.push(Math.abs(n.value * n.scale));
  for (const o of priorOutputs) numbersFromJson(o, out);
  return out;
}
