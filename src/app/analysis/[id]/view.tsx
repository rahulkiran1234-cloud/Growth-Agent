"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { STEP_NAMES } from "@/lib/agent/step-names";

type Line = { kind: "note" | "tool" | "result"; text: string };
type Gate = { repairs: number; dropped: string[]; warnings: string[] };
type StepState = { status: "pending" | "running" | "done" | "failed"; lines: Line[]; output?: Record<string, unknown>; gate?: Gate; durationMs?: number; tokens?: { in: number; out: number } };
type Status = "running" | "done" | "failed";

const blank = (): StepState[] => STEP_NAMES.map(() => ({ status: "pending", lines: [] }));

function toolLine(d: { tool: string; input: Record<string, unknown> }): string {
  const i = d.input ?? {};
  switch (d.tool) {
    case "sql_kpis": return `Querying ${i.section}${i.sku ? ` (${i.sku})` : ""}`;
    case "vector_search": return `Searching competitors: "${i.query}"${i.competitor ? ` (${i.competitor})` : ""}`;
    case "calc": return `Calculating ${i.expression}`;
    case "calc_roi": return `Estimating ROI: ${i.label}`;
    default: return d.tool;
  }
}

export default function AnalysisView({ id }: { id: string }) {
  const [steps, setSteps] = useState<StepState[]>(blank);
  const [status, setStatus] = useState<Status>("running");
  const [error, setError] = useState<{ message: string; step: number } | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [streamKey, setStreamKey] = useState(0);
  const lastSeq = useRef(0);
  const noteOpen = useRef<Record<number, boolean>>({}); // steps whose last line is a note still being appended to (steps can run in parallel)

  useEffect(() => {
    if (status !== "done") return;
    fetch(`/api/analyses/${id}/steps`).then((r) => r.json()).then((j) => setProjectId(j.analysis?.projectId ?? null)).catch(() => {});
  }, [status, id]);

  useEffect(() => {
    const es = new EventSource(`/api/analyses/${id}/events?after=${lastSeq.current}`);
    const upd = (n: number, f: (s: StepState) => StepState) => setSteps((p) => p.map((s, i) => (i === n - 1 ? f(s) : s)));
    const on = (type: string, fn: (d: Record<string, any>) => void) => // eslint-disable-line @typescript-eslint/no-explicit-any
      es.addEventListener(type, (e) => {
        const m = e as MessageEvent;
        if (m.lastEventId) lastSeq.current = Number(m.lastEventId);
        if (m.data) fn(JSON.parse(m.data));
      });

    on("step_started", (d) => { noteOpen.current[d.step] = false; upd(d.step, (s) => ({ ...s, status: "running" })); });
    on("note", (d) => {
      const append = !!noteOpen.current[d.step];
      noteOpen.current[d.step] = true;
      upd(d.step, (s) => {
        const last = s.lines[s.lines.length - 1];
        if (append && last?.kind === "note") return { ...s, lines: [...s.lines.slice(0, -1), { kind: "note", text: last.text + d.text }] };
        return { ...s, lines: [...s.lines, { kind: "note", text: d.text }] };
      });
    });
    on("tool_call", (d) => { noteOpen.current[d.step] = false; upd(d.step, (s) => ({ ...s, lines: [...s.lines, { kind: "tool", text: toolLine(d as never) }] })); });
    on("tool_result", (d) => { noteOpen.current[d.step] = false; upd(d.step, (s) => ({ ...s, lines: [...s.lines, { kind: "result", text: `↳ ${d.summary}` }] })); });
    on("step_output", (d) => { noteOpen.current[d.step] = false; setCost(d.total_cost_usd); upd(d.step, (s) => ({ ...s, status: "done", output: d.output, durationMs: d.duration_ms, tokens: d.tokens })); });
    on("gate", (d) => upd(d.step, (s) => ({ ...s, gate: { repairs: d.repairs, dropped: d.dropped, warnings: d.warnings } })));
    on("step_failed", (d) => d.step > 0 && upd(d.step, (s) => ({ ...s, status: "failed" })));
    on("done", () => { setStatus("done"); es.close(); });
    es.addEventListener("error", (e) => {
      const m = e as MessageEvent;
      if (!m.data) return; // connection hiccup: the browser reconnects with Last-Event-ID
      const d = JSON.parse(m.data);
      setError({ message: d.message, step: d.step ?? 0 });
      setStatus("failed");
      es.close();
    });
    return () => es.close();
  }, [id, streamKey]);

  async function retry() {
    const r = await fetch(`/api/analyses/${id}/resume`, { method: "POST" });
    if (!r.ok) return setError({ message: (await r.json()).error ?? "Could not resume", step: error?.step ?? 0 });
    setError(null);
    setStatus("running");
    setSteps((p) => p.map((s) => (s.status === "failed" ? { ...s, status: "pending" } : s)));
    setStreamKey((k) => k + 1);
  }

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-8">
      <div>
        <h1 className="text-xl font-semibold">Analysis {status === "running" ? "· running…" : status === "done" ? "· done" : "· failed"}</h1>
        <p className="text-xs text-neutral-500">
          {id}
          {cost !== null && <> · cost so far ${cost} (estimate)</>}
        </p>
      </div>

      {status === "done" && (
        <div className="flex flex-wrap gap-2">
          {projectId && <Link href={`/projects/${projectId}`} className="inline-block rounded-lg bg-brand px-4 py-2 font-semibold text-white no-underline hover:bg-brand-deep">Open your workspace →</Link>}
          <Link href={`/analysis/${id}/report`} className="inline-block rounded-lg border border-line bg-surface px-4 py-2 font-semibold no-underline hover:bg-[#f0efec]">Printable report</Link>
        </div>
      )}

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p>{error.message}</p>
          <p className="mt-1 text-xs">Finished steps are kept. Retrying continues from the first unfinished step.</p>
          <button onClick={retry} className="mt-2 rounded bg-red-700 px-3 py-1 text-white">Retry</button>
        </div>
      )}

      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="rounded border">
            <details open={s.status === "running" || s.status === "failed"}>
              <summary className="flex cursor-pointer items-center gap-2 p-3">
                <Dot status={s.status} />
                <span className="font-medium">Step {i + 1} · {STEP_NAMES[i]}</span>
                {s.durationMs != null && <span className="ml-auto text-xs text-neutral-500">{(s.durationMs / 1000).toFixed(0)}s{s.tokens ? ` · ${s.tokens.in + s.tokens.out} tokens` : ""}</span>}
              </summary>
              <div className="space-y-3 border-t p-3">
                {s.lines.length > 0 && (
                  <div className="space-y-0.5 rounded bg-neutral-50 p-2 font-mono text-xs">
                    {s.lines.map((l, k) => (
                      <p key={k} className={l.kind === "tool" ? "text-blue-700" : l.kind === "result" ? "text-neutral-500" : "text-neutral-800"}>{l.text}</p>
                    ))}
                  </div>
                )}
                {s.gate && <GatePanel gate={s.gate} />}
                {s.output && <Preview step={i + 1} out={s.output} />}
              </div>
            </details>
          </li>
        ))}
      </ol>
    </main>
  );
}

function Dot({ status }: { status: StepState["status"] }) {
  const c = status === "done" ? "bg-green-500" : status === "running" ? "animate-pulse bg-amber-500" : status === "failed" ? "bg-red-500" : "bg-neutral-300";
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${c}`} />;
}

function GatePanel({ gate }: { gate: Gate }) {
  const clean = gate.repairs === 0 && gate.dropped.length === 0 && gate.warnings.length === 0;
  return (
    <div className={`rounded p-2 text-xs ${clean ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`}>
      <p className="font-medium">
        Evidence check: {clean ? "all claims verified" : `${gate.repairs} fix attempt${gate.repairs === 1 ? "" : "s"}, ${gate.dropped.length} item${gate.dropped.length === 1 ? "" : "s"} removed`}
      </p>
      {gate.dropped.map((d, i) => <p key={i}>✂ Removed: {d}</p>)}
      {gate.warnings.map((w, i) => <p key={i}>⚠ Could not fully verify: {w}</p>)}
    </div>
  );
}

// ---- compact previews (the full report view is built in the next phase) --------------------

type R = Record<string, unknown>;
const arr = (v: unknown): R[] => (Array.isArray(v) ? (v as R[]) : []);
const str = (v: unknown) => (v == null ? "" : String(v));

function Preview({ step, out }: { step: number; out: R }) {
  return (
    <div className="space-y-2 text-sm">
      {step === 1 && (
        <>
          <p>{str(out.summary)}</p>
          <ul className="list-disc pl-5">{arr(out.metrics).slice(0, 8).map((m, i) => <li key={i}><b>{str(m.name)}:</b> {str(m.value)} <span className="text-neutral-500">({str(m.period)})</span></li>)}</ul>
        </>
      )}
      {step === 2 &&
        arr(out.competitors).map((c, i) => (
          <div key={i}>
            <p className="font-medium">{str(c.name)}</p>
            <ul className="list-disc pl-5">
              {arr(c.findings).map((f, k) => (
                <li key={k}>
                  <b>{str(f.topic)}:</b> {str(f.fact)} <code className="rounded bg-neutral-100 px-1 text-xs">{str(f.source_id)}</code>
                  {(f.source as R)?.stale ? <span className="ml-1 rounded bg-amber-100 px-1 text-xs text-amber-800">stale</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      {step === 3 && (
        <table className="w-full text-xs">
          <thead><tr className="text-left"><th>Attribute</th><th>Seller</th><th>Competitors</th><th>Verdict</th></tr></thead>
          <tbody>
            {arr(out.comparison).map((r, i) => (
              <tr key={i} className="border-t align-top">
                <td className="py-1 pr-2">{str(r.attribute)}</td>
                <td className="pr-2">{str(r.seller_value) || "unknown"}</td>
                <td className="pr-2">{arr(r.competitors).map((c, k) => <div key={k}>{str(c.name)}: {str(c.value) || "unknown"}</div>)}</td>
                <td>{str(r.verdict).replace("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {step === 4 &&
        arr(out.problems).map((p, i) => (
          <div key={i} className="rounded border p-2">
            <p><b>{str(p.id)} · {str(p.title)}</b> <span className="text-xs text-neutral-500">severity {str(p.severity)}, confidence {str(p.confidence)}</span></p>
            <p className="text-neutral-700">{str(p.description)}</p>
          </div>
        ))}
      {step === 5 &&
        arr(out.solutions).map((s, i) => {
          const roi = s.roi as R | null;
          return (
            <div key={i} className="rounded border p-2">
              <p><b>{str(s.id)} · {str(s.title)}</b> <span className="text-xs text-neutral-500">for {str(s.problem_id)}, effort {str(s.effort)}, confidence {str(s.confidence)}</span></p>
              <p className="text-neutral-700">{str(s.description)}</p>
              <p className="text-xs">{roi ? <>Estimated gain per month: <b>{Number(roi.gain_low_monthly).toLocaleString()}–{Number(roi.gain_high_monthly).toLocaleString()}</b> (assumption: {str(roi.lift_low_pct)}–{str(roi.lift_high_pct)}% lift on {str(roi.affected_share_pct)}% of {Number(roi.baseline_monthly).toLocaleString()})</> : "No ROI estimate"}</p>
            </div>
          );
        })}
      {step === 6 && (
        <>
          <p>{str(out.summary)}</p>
          {arr(out.weeks).map((w, i) => (
            <div key={i}>
              <p className="font-medium">Week {str(w.week)} · {str(w.theme)}</p>
              <ul className="list-disc pl-5">{arr(w.actions).map((a, k) => <li key={k}>{str(a.task)} <span className="text-xs text-neutral-500">({str(a.solution_id)} · {str(a.owner_role)} · track: {str(a.kpi_to_track)})</span></li>)}</ul>
            </div>
          ))}
        </>
      )}
      <details className="text-xs text-neutral-500">
        <summary className="cursor-pointer">Raw output</summary>
        <pre className="mt-1 max-h-72 overflow-auto rounded border bg-white p-2">{JSON.stringify(out, null, 2)}</pre>
      </details>
    </div>
  );
}
