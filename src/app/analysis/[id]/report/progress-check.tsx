"use client";
import { useState } from "react";
import { fmtMetric, type Comparison } from "@/lib/report/metrics-pure";

type Result =
  | { ready: false; reason: string }
  | {
      ready: true; adoptedAt: string; checkOn: string; dataUnchanged: boolean;
      dataThroughBefore: { sales: string | null; reviews: string | null }; dataThroughNow: { sales: string | null; reviews: string | null };
      actions: { solutionId: string; owner: string | null; dueDate: string | null }[]; comparison: Comparison[];
    };

const BADGE = { improved: "bg-green-100 text-green-800", worse: "bg-red-100 text-red-800", flat: "bg-neutral-100 text-neutral-700", missing: "bg-neutral-50 text-neutral-500" } as const;
const LABEL = { improved: "Improved", worse: "Worse", flat: "Unchanged", missing: "No data" } as const;

export default function ProgressCheck({ analysisId, projectId }: { analysisId: string; projectId: string }) {
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true); setErr("");
    const r = await fetch(`/api/analyses/${analysisId}/progress`);
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Could not compare");
    setRes(j);
  }

  return (
    <div className="mt-4 print:hidden">
      <h3 className="font-semibold">30-day check</h3>
      <p className="text-xs text-neutral-600">
        After about 30 days, <a className="underline" href={`/projects/${projectId}/data`}>re-upload your latest sales and reviews</a> (a re-upload replaces the old file), then compare against the numbers frozen when you saved your plan. No new AI run is needed.
      </p>
      <button type="button" onClick={run} disabled={busy} className="mt-2 rounded bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50">{busy ? "Comparing…" : "Compare with my latest data"}</button>
      {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
      {res && !res.ready && <p className="mt-2 text-sm">{res.reason}</p>}
      {res && res.ready && (
        <div className="mt-3 space-y-2 text-sm">
          {res.dataUnchanged && <p className="rounded bg-amber-50 p-2 text-amber-900">Your data still ends on the same dates as when you started (sales to {res.dataThroughNow.sales ?? "n/a"}, reviews to {res.dataThroughNow.reviews ?? "n/a"}), so nothing can have changed yet. Upload fresh files first.</p>}
          <p className="text-xs text-neutral-600">Baseline frozen {res.adoptedAt.slice(0, 10)} (data through {res.dataThroughBefore.sales ?? "n/a"}) · re-check date {res.checkOn} · actions: {res.actions.map((a) => a.solutionId).join(", ")}</p>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs">
            <thead><tr className="border-b text-neutral-500"><th className="py-1">KPI</th><th>Before</th><th>Now</th><th>Change</th><th></th></tr></thead>
            <tbody>
              {res.comparison.map((c) => (
                <tr key={c.key} className="border-b">
                  <td className="py-1 pr-2">{c.label}{c.periodBefore && c.period && c.periodBefore !== c.period ? <span className="text-neutral-400"> ({c.periodBefore} → {c.period})</span> : null}</td>
                  <td className="pr-2">{fmtMetric(c.before, c.unit)}</td>
                  <td className="pr-2 font-medium">{c.after == null ? "n/a" : fmtMetric(c.after, c.unit)}</td>
                  <td className="pr-2">{c.delta == null ? "" : `${c.delta > 0 ? "+" : ""}${c.unit === "pct" ? `${c.delta} pts` : fmtMetric(c.delta, c.unit)}${c.deltaPct != null && c.unit !== "pct" ? ` (${c.deltaPct > 0 ? "+" : ""}${c.deltaPct}%)` : ""}`}</td>
                  <td><span className={`inline-block rounded px-1.5 py-0.5 font-medium ${BADGE[c.verdict]}`}>{LABEL[c.verdict]}</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="text-xs text-neutral-500">This shows what moved, not why. Seasonality, promotions and other changes also affect these numbers, so treat it as evidence to discuss, not proof that the plan worked.</p>
        </div>
      )}
    </div>
  );
}
