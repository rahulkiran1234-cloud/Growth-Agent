// Pure helpers for the report. Fixed "en-US" formatting so server-rendered pages and PDFs read the same everywhere.
export const fmtNum = (n: number) => Math.round(n).toLocaleString("en-US");

export const fmtRange = (lo: number | null | undefined, hi: number | null | undefined) =>
  lo == null || hi == null ? "not estimated" : `${fmtNum(lo)}–${fmtNum(hi)}`;

export type Gate = { step: number; repairs: number; dropped: string[]; warnings: string[]; repair_log?: string[] };

/** One-line trust summary across all steps. */
export function summarizeGates(gates: Gate[]) {
  return {
    steps: gates.length,
    repairs: gates.reduce((s, g) => s + g.repairs, 0),
    removed: gates.reduce((s, g) => s + g.dropped.length, 0),
    unverified: gates.reduce((s, g) => s + g.warnings.length, 0),
    cleanSteps: gates.filter((g) => g.dropped.length === 0 && g.warnings.length === 0).length,
  };
}

/** The date to re-measure: `days` after `from` (YYYY-MM-DD). */
export function checkDate(from: Date | string, days = 30): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export const GOAL_LABEL = { revenue: "Grow revenue", rating: "Improve rating", margin: "Improve margin" } as const;
