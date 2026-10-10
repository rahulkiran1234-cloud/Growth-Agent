"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ev } from "@/components/workspace/evidence-drawer";
import { Card, Headline, Note, PageTitle, Pill } from "@/components/ui";
import { C } from "@/components/charts/charts";
import { compact, num } from "@/lib/insights/aggregate";
import type { Report } from "@/lib/report/build";
import { NeedsAnalysis, Stale, useView } from "./common";
import { AdsPlanCard } from "./ads-plan";
import { SkuPlaybook } from "./sku-playbook";
import { useWorkspace } from "@/components/workspace/workspace";

type Item = { adopted: boolean; owner: string; dueDate: string; week: number };
type Sol = Report["s5"] extends infer S ? (S extends { solutions: infer L } ? (L extends (infer E)[] ? E : never) : never) : never;
const EFFORT_X = { low: 0, medium: 1, high: 2 } as const;
const EFFORT_TONE = { low: "good", medium: "warn", high: "bad" } as const;

function ImpactMatrix({ sols, onPick, picked }: { sols: Sol[]; onPick: (id: string) => void; picked: string | null }) {
  const W = 420, H = 250, L = 46, B = 30, T = 14, R = 14;
  const withRoi = sols.filter((s) => s.roi);
  const max = Math.max(1, ...withRoi.map((s) => (s.roi!.gain_low_monthly + s.roi!.gain_high_monthly) / 2));
  const x = (e: keyof typeof EFFORT_X) => L + ((EFFORT_X[e] + 0.5) / 3) * (W - L - R);
  const y = (g: number) => T + (1 - g / (max * 1.15)) * (H - T - B);
  const placed = new Map<string, number>();
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Impact against effort for each recommended action">
        {[0, 1, 2].map((i) => <rect key={i} x={L + (i / 3) * (W - L - R)} y={T} width={(W - L - R) / 3} height={H - T - B} fill={i === 0 ? "#eef7ee" : "#f6f5f1"} stroke={C.grid} />)}
        {["Low effort", "Medium", "High effort"].map((t, i) => <text key={t} x={L + ((i + 0.5) / 3) * (W - L - R)} y={H - 10} textAnchor="middle" fontSize="11" fill={C.muted}>{t}</text>)}
        <text x={L + 6} y={T + 13} fontSize="10" fontWeight="700" fill="#1f7a1f">Quick wins</text>
        <text x={12} y={T + (H - T - B) / 2} fontSize="11" fill={C.muted} transform={`rotate(-90 12 ${T + (H - T - B) / 2})`} textAnchor="middle">Est. gain / month</text>
        {withRoi.map((s) => {
          const mid = (s.roi!.gain_low_monthly + s.roi!.gain_high_monthly) / 2;
          const n = placed.get(s.effort) ?? 0; placed.set(s.effort, n + 1);
          const cx = x(s.effort) + (n === 0 ? 0 : n % 2 ? 32 : -32), cy = y(mid);
          const r = 11 + 16 * Math.sqrt(mid / max);
          return (
            <g key={s.id} tabIndex={0} role="button" aria-label={`${s.id} ${s.title}, gain ${compact(s.roi!.gain_low_monthly)} to ${compact(s.roi!.gain_high_monthly)}`} onClick={() => onPick(s.id)} onKeyDown={(e) => e.key === "Enter" && onPick(s.id)} className="cursor-pointer outline-none">
              <circle cx={cx} cy={cy} r={r} fill={picked === s.id ? C.s2 : C.s1} fillOpacity={0.85} stroke="#fcfcfb" strokeWidth="2" />
              <text x={cx} y={cy + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">{s.id}</text>
              <title>{`${s.id}: ${s.title}. ${num(s.roi!.gain_low_monthly)}–${num(s.roi!.gain_high_monthly)} per month`}</title>
            </g>
          );
        })}
      </svg>
      {sols.some((s) => !s.roi) && <p className="text-[11px] text-muted">No estimate (not plotted): {sols.filter((s) => !s.roi).map((s) => s.id).join(", ")}</p>}
    </div>
  );
}

export default function Plan() {
  const v = useView();
  const { id: projectId } = useWorkspace();
  const report = v?.data.report ?? null;
  const [items, setItems] = useState<Record<string, Item>>({});
  const [picked, setPicked] = useState<string | null>(null);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMsg, setSaveMsg] = useState("");
  const [drag, setDrag] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFor = useRef<string | null>(null);

  const planIds = useMemo(() => {
    if (!report?.s6 || !report.s5) return [];
    const ids = new Set([...report.s6.top_actions, ...report.s6.weeks.flatMap((w) => w.actions.map((a) => a.solution_id))]);
    return report.s5.solutions.filter((s) => ids.has(s.id)).map((s) => s.id);
  }, [report]);

  // Initialise once per analysis from what was saved (adopted, owner, due date, scheduled week).
  useEffect(() => {
    if (!report?.s6 || loadedFor.current === report.analysis.id) return;
    loadedFor.current = report.analysis.id;
    const next: Record<string, Item> = {};
    for (const sid of planIds) {
      const saved = report.plan.find((p) => p.solutionId === sid);
      const suggested = report.s6.weeks.find((w) => w.actions.some((a) => a.solution_id === sid))?.week ?? 1;
      next[sid] = { adopted: saved?.adopted ?? false, owner: saved?.owner ?? "", dueDate: saved?.dueDate ?? "", week: saved?.week ?? suggested };
    }
    setItems(next);
  }, [report, planIds]);

  const persist = useCallback((next: Record<string, Item>) => {
    if (!report) return;
    if (timer.current) clearTimeout(timer.current);
    setSave("saving");
    timer.current = setTimeout(async () => {
      const r = await fetch(`/api/analyses/${report.analysis.id}/plan`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: Object.entries(next).map(([solutionId, i]) => ({ solutionId, adopted: i.adopted, owner: i.owner.trim() || null, dueDate: i.dueDate || null, week: i.week })) }),
      });
      if (r.ok) { setSave("saved"); setSaveMsg(""); } else { setSave("error"); setSaveMsg((await r.json().catch(() => ({}))).error ?? "Could not save"); }
    }, 500);
  }, [report]);

  const change = (sid: string, patch: Partial<Item>) => {
    setItems((prev) => { const next = { ...prev, [sid]: { ...prev[sid], ...patch } }; persist(next); return next; });
  };

  if (!v) return null;
  if (!report?.s5 || !report.s6) return <div className="space-y-4"><PageTitle title="Action Plan" sub="What to do first, and how it should move your numbers" /><SkuPlaybook /><AdsPlanCard /><NeedsAnalysis what="Solutions, ROI estimates and the 30-day plan" /></div>;

  const sols = report.s5.solutions;
  const byId = new Map(sols.map((s) => [s.id, s]));
  const rank = new Map(report.s6.ranking.map((r, i) => [r.id, i]));
  const top = [...sols].filter((s) => s.roi).sort((a, b) => (b.roi!.gain_high_monthly) - (a.roi!.gain_high_monthly))[0];
  const adopted = Object.values(items).filter((i) => i.adopted).length;
  const sel = picked ? byId.get(picked) : null;
  const problemOf = (pid: string) => report.s4?.problems.find((p) => p.id === pid);
  const tasksOf = (sid: string) => report.s6!.weeks.flatMap((w) => w.actions.filter((a) => a.solution_id === sid).map((a) => ({ ...a, week: w.week })));

  return (
    <div className="space-y-4">
      <PageTitle title="Action Plan" sub="What to do first, and how it should move your numbers" right={<span className="text-xs text-muted" role="status">{save === "saving" ? "Saving…" : save === "saved" ? "✓ Saved" : save === "error" ? saveMsg : `${adopted} of ${planIds.length} actions chosen`}</span>} />
      <Stale />
      <Headline
        title={top?.roi ? `Biggest estimated win: ${top.title}, about ${compact(top.roi.gain_low_monthly)}–${compact(top.roi.gain_high_monthly)} per month.` : "Pick the actions you will take in the next 30 days."}
        sub="Estimates are assumption-based ranges and overlap, so don't add them up. Each one shows its assumptions."
        right={<Pill tone="warn">Assumption-based</Pill>}
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title="Impact × effort" className="lg:col-span-1"><ImpactMatrix sols={sols} onPick={setPicked} picked={picked} /><p className="text-[11px] text-muted">Bubble size is the estimated monthly gain. Click one for details.</p></Card>
        <Card title="30-day plan" className="lg:col-span-2" right={<span className="text-xs text-muted">Drag a card to another week, or use its menu</span>}>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {[1, 2, 3, 4].map((w) => {
              const theme = report.s6!.weeks.find((x) => x.week === w)?.theme;
              const cards = planIds.filter((sid) => items[sid]?.week === w).sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99));
              return (
                <div key={w} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag) change(drag, { week: w }); setDrag(null); }} className={`min-h-32 rounded-lg bg-[#f1f0ec] p-2 ${drag ? "ring-1 ring-brand/40" : ""}`} aria-label={`Week ${w}`}>
                  <p className="text-xs font-bold">Week {w}</p>
                  {theme && <p className="mb-1.5 text-[10px] leading-tight text-muted">{theme}</p>}
                  {cards.map((sid) => {
                    const s = byId.get(sid)!, it = items[sid];
                    return (
                      <div key={sid} draggable onDragStart={() => setDrag(sid)} onDragEnd={() => setDrag(null)} className={`mb-1.5 cursor-grab rounded-lg border bg-surface p-2 text-xs ${picked === sid ? "border-brand" : "border-line"}`}>
                        <button type="button" className="text-left" onClick={() => setPicked(sid)}><b className="text-brand-deep">{sid}</b> {s.title}</button>
                        <p className="mt-0.5 text-[10px] text-muted">{s.roi ? `${compact(s.roi.gain_low_monthly)}–${compact(s.roi.gain_high_monthly)}/mo` : "no estimate"} · <Pill tone={EFFORT_TONE[s.effort]} icon={false}>{s.effort}</Pill></p>
                        <label className="mt-1 flex items-center gap-1"><input type="checkbox" checked={it.adopted} onChange={(e) => change(sid, { adopted: e.target.checked })} /> I&apos;ll do this</label>
                        {it.adopted && (
                          <div className="mt-1 flex gap-1">
                            <input aria-label={`Owner for ${sid}`} placeholder="Owner" value={it.owner} maxLength={80} onChange={(e) => setItems((p) => ({ ...p, [sid]: { ...p[sid], owner: e.target.value } }))} onBlur={() => persist(items)} className="w-1/2 min-w-0 rounded border border-line px-1 py-0.5" />
                            <input aria-label={`Due date for ${sid}`} type="date" value={it.dueDate} onChange={(e) => change(sid, { dueDate: e.target.value })} className="w-1/2 min-w-0 rounded border border-line px-1 py-0.5" />
                          </div>
                        )}
                        <select aria-label={`Week for ${sid}`} value={it.week} onChange={(e) => change(sid, { week: Number(e.target.value) })} className="mt-1 w-full rounded border border-line px-1 py-0.5 text-[10px] text-ink2">{[1, 2, 3, 4].map((x) => <option key={x} value={x}>Week {x}</option>)}</select>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <SkuPlaybook />
      <AdsPlanCard />

      {sel && (
        <Card title={`${sel.id} · ${sel.title}`} right={<button type="button" onClick={() => setPicked(null)} className="rounded-md border border-line px-2 py-0.5 text-xs hover:bg-[#f0efec]">Close</button>}>
          <div className="grid gap-4 text-sm md:grid-cols-3">
            <div className="space-y-1.5">
              <p className="text-ink2">{sel.description}</p>
              {problemOf(sel.problem_id) && <p className="text-xs text-muted">Fixes: <b className="text-ink2">{problemOf(sel.problem_id)!.title}</b></p>}
              <p className="text-xs">Confidence <Pill tone={sel.confidence === "high" ? "good" : sel.confidence === "medium" ? "warn" : "neutral"}>{sel.confidence}</Pill></p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted">Estimate</p>
              {sel.roi ? <p className="tnum"><b>{num(sel.roi.gain_low_monthly)}–{num(sel.roi.gain_high_monthly)}</b> per month<span className="block text-xs text-muted">Assumes a {sel.roi.lift_low_pct}–{sel.roi.lift_high_pct}% lift on {sel.roi.affected_share_pct}% of a {num(sel.roi.baseline_monthly)} monthly base.{sel.roi.one_time_cost ? ` One-off cost ${num(sel.roi.one_time_cost)}.` : ""}</span></p> : <p className="text-muted">No defensible baseline, so no estimate.</p>}
              {sel.assumptions.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs text-ink2">{sel.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>}
            </div>
            <div>
              <p className="text-xs font-semibold text-muted">Tasks and how to measure</p>
              <ul className="space-y-1 text-xs text-ink2">{tasksOf(sel.id).map((t, i) => <li key={i}><b>Week {t.week}:</b> {t.task} <span className="text-muted">({t.owner_role}). Track {t.kpi_to_track}; {t.how_measured}</span></li>)}</ul>
              {sel.risks.length > 0 && <p className="mt-1 text-xs text-warnink">Risks: {sel.risks.join("; ")}</p>}
            </div>
          </div>
        </Card>
      )}

      <Card title="What should move" right={<Link className="text-xs font-semibold text-brand-deep underline" href={`/projects/${projectId}/data`}>Run the 30-day check</Link>}>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="border-b border-line text-xs text-muted"><th className="py-1.5">KPI to watch</th><th>Where you start</th><th>Source</th></tr></thead>
          <tbody>{report.s6.baseline_snapshot.map((b, i) => <tr key={i} className="border-b border-line/60"><td className="py-1.5">{b.kpi}</td><td className="font-semibold tnum">{b.value}</td><td><Ev refId={b.ref} /></td></tr>)}</tbody>
        </table></div>
        <p className="mt-2 text-xs text-muted">When you choose actions, today&apos;s numbers are frozen. After about 30 days, re-upload your data and compare on the Data page.</p>
      </Card>
      <Note tone="info">Changes save automatically. The printable report has the same plan: <Link className="underline" href={`/analysis/${report.analysis.id}/report`}>open report</Link>.</Note>
    </div>
  );
}
