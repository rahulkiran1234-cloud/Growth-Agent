// Pure helpers (no database import) so client components can use them.
export type Metric = { key: string; label: string; value: number; unit: "money" | "pct" | "rating" | "count"; better: "up" | "down"; period?: string };

export type Verdict = "improved" | "worse" | "flat";
export type Comparison = { key: string; label: string; unit: Metric["unit"]; period?: string; periodBefore?: string; before: number; after: number | null; delta: number | null; deltaPct: number | null; verdict: Verdict | "missing" };

const FLAT_BAND = 0.01; // within 1% of the starting value counts as unchanged

/** Pure: compares a frozen snapshot against a fresh one. Metrics that vanished (e.g. no tagged reviews) are marked missing. */
export function compareMetrics(before: Metric[], after: Metric[]): Comparison[] {
  const now = new Map(after.map((x) => [x.key, x]));
  return before.map((b) => {
    const a = now.get(b.key);
    if (!a) return { key: b.key, label: b.label, unit: b.unit, periodBefore: b.period, before: b.value, after: null, delta: null, deltaPct: null, verdict: "missing" as const };
    const delta = Math.round((a.value - b.value) * 100) / 100;
    const deltaPct = b.value !== 0 ? Math.round(((a.value - b.value) / Math.abs(b.value)) * 1000) / 10 : null;
    const rel = b.value !== 0 ? Math.abs(a.value - b.value) / Math.abs(b.value) : a.value === b.value ? 0 : 1;
    const verdict: Verdict = rel <= FLAT_BAND ? "flat" : (a.value > b.value) === (b.better === "up") ? "improved" : "worse";
    return { key: b.key, label: b.label, unit: b.unit, period: a.period, periodBefore: b.period, before: b.value, after: a.value, delta, deltaPct, verdict };
  });
}

export function fmtMetric(v: number, unit: Metric["unit"]): string {
  if (unit === "pct") return `${v}%`;
  if (unit === "rating") return v.toFixed(2);
  return Math.round(v).toLocaleString("en-US");
}
