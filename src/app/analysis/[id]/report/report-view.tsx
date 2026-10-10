import Link from "next/link";
import { notFound } from "next/navigation";
import { buildReport, type Report } from "@/lib/report/build";
import { checkDate, fmtNum, fmtRange, GOAL_LABEL, summarizeGates } from "@/lib/report/format";
import { STEP_NAMES } from "@/lib/agent/step-names";
import type { StoredSolution } from "@/lib/agent/schemas";
import PlanEditor from "./plan-editor";
import ProgressCheck from "./progress-check";
import PrintButton from "./print-button";
import AdsSection from "./ads-section";
import { pdfAvailable } from "@/lib/pdf";
import { adAdvice } from "@/lib/ingest/ads";

const anchor = (id: string) => `src-${id.replace(":", "-")}`;

const LEVEL: Record<string, string> = {
  high: "bg-red-100 text-red-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-neutral-100 text-neutral-700",
};
const VERDICT: Record<string, string> = {
  seller_ahead: "bg-green-100 text-green-800",
  seller_behind: "bg-red-100 text-red-800",
  parity: "bg-neutral-100 text-neutral-700",
  unknown: "bg-neutral-50 text-neutral-500",
};

function Badge({ text, cls }: { text: string; cls: string }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{text}</span>;
}

/** A clickable citation marker that jumps to the source passage in the appendix. */
function Cite({ r, id }: { r: Report; id: string | null | undefined }) {
  if (!id) return null;
  const c = r.citations[id];
  return (
    <a href={`#${anchor(id)}`} title={c ? `${c.competitor} · ${c.title}${c.page ? ` p.${c.page}` : ""}` : id} className="ml-1 rounded bg-blue-50 px-1 text-[10px] text-blue-700 no-underline print:bg-transparent">
      [{c ? `${c.competitor}${c.page ? ` p.${c.page}` : ""}` : id}]
    </a>
  );
}

function Section({ n, title, id, children }: { n: number; title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-8">
      <h2 className="border-b pb-1 text-lg font-semibold">{n}. {title}</h2>
      <div className="mt-3 space-y-3 text-sm">{children}</div>
    </section>
  );
}

export default async function ReportView({ id }: { id: string }) {
  const r = await buildReport(id);
  if (!r) notFound();

  if (r.analysis.status !== "done") {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p>This analysis is {r.analysis.status}, so there is no report yet.</p>
        <Link className="text-blue-700 underline" href={`/analysis/${id}`}>Back to the analysis</Link>
      </main>
    );
  }

  const ads = await adAdvice(r.project.id).catch(() => null); // current ads data; null when no ads report is uploaded
  const sols = r.s5?.solutions ?? [];
  const solById = new Map(sols.map((s) => [s.id, s]));
  const gate = summarizeGates(r.gates);
  const finished = r.analysis.finishedAt ?? r.analysis.startedAt;
  const recheckOn = checkDate(finished);
  const topIds = (r.s6?.top_actions ?? []).filter((x) => solById.has(x));
  const problems = r.s4?.problems ?? [];

  return (
    <div className="bg-white text-neutral-900">
      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Header */}
        <header>
          <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
            <Link href={`/projects/${r.project.id}`} className="text-sm text-neutral-500 hover:underline">← {r.project.name}</Link>
            <div className="flex gap-2">
              <PrintButton />
              {pdfAvailable() && <a href={`/api/analyses/${id}/report.pdf`} className="rounded bg-black px-3 py-1.5 text-sm text-white no-underline">Download PDF</a>}
            </div>
          </div>
          <h1 className="mt-3 text-2xl font-bold">Growth report: {r.project.name}</h1>
          <p className="text-sm text-neutral-500">
            Goal: {GOAL_LABEL[r.project.goal as keyof typeof GOAL_LABEL] ?? r.project.goal} · generated {finished.slice(0, 10)} · analysis {id.slice(0, 8)}
          </p>
        </header>

        {/* 1. Summary */}
        <Section n={1} title="Summary">
          {r.s6 ? <p className="text-base">{r.s6.summary}</p> : <p className="text-neutral-500">The action plan step did not complete.</p>}
          {topIds.length > 0 && (
            <div>
              <h3 className="font-semibold">Do these first</h3>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                {topIds.map((sid) => {
                  const s = solById.get(sid)!;
                  return <li key={sid}><b>{s.title}</b> <span className="text-neutral-600">(est. {fmtRange(s.roi?.gain_low_monthly, s.roi?.gain_high_monthly)} per month, effort {s.effort})</span></li>;
                })}
              </ol>
            </div>
          )}
          {problems.length > 0 && (
            <div>
              <h3 className="font-semibold">Biggest problems found</h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {problems.slice(0, 3).map((p) => <li key={p.id}>{p.title} <Badge text={p.severity} cls={LEVEL[p.severity]} /></li>)}
              </ul>
            </div>
          )}
          <p className="rounded border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
            <b>How much to trust this:</b> every competitor claim links to the passage it came from. Before this report was finalised, {gate.removed} unverifiable claim{gate.removed === 1 ? " was" : "s were"} removed and {gate.unverified} figure{gate.unverified === 1 ? " is" : "s are"} flagged as unverified. Impact numbers are <b>estimates built on stated assumptions</b>, not forecasts. <a className="underline" href="#quality">Details</a>.
          </p>
        </Section>

        {/* 2. Current state */}
        <Section n={2} title="Where you stand today">
          {r.s1 ? (
            <>
              <p>{r.s1.summary}</p>
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead><tr className="border-b text-xs text-neutral-500"><th className="py-1">Metric</th><th>Value</th><th>Period</th></tr></thead>
                <tbody>{r.s1.metrics.map((m, i) => <tr key={i} className="break-inside-avoid border-b"><td className="py-1 pr-2">{m.name}</td><td className="pr-2 font-medium">{m.value}</td><td className="text-neutral-500">{m.period}</td></tr>)}</tbody>
              </table></div>
              {r.s1.trends.length > 0 && <ul className="list-disc space-y-1 pl-5">{r.s1.trends.map((t, i) => <li key={i}>{t.description}</li>)}</ul>}
              {r.s1.review_themes.length > 0 && (
                <div className="break-inside-avoid">
                  <h3 className="font-semibold">What unhappy customers talk about</h3>
                  <div className="overflow-x-auto"><table className="mt-1 w-full text-left text-sm">
                    <thead><tr className="border-b text-xs text-neutral-500"><th className="py-1">Theme</th><th>Reviews (1–3★)</th><th>Share of low-rated reviews</th></tr></thead>
                    <tbody>{r.s1.review_themes.map((t, i) => <tr key={i} className="border-b"><td className="py-1">{t.theme.replace(/_/g, " ")}</td><td>{fmtNum(t.count)}</td><td>{t.share_of_low_reviews_pct}%</td></tr>)}</tbody>
                  </table></div>
                </div>
              )}
              {r.s1.data_quality_notes.length > 0 && <p className="text-xs text-neutral-500">Data notes: {r.s1.data_quality_notes.join(" · ")}</p>}
            </>
          ) : <p className="text-neutral-500">Not available.</p>}
        </Section>

        {/* 3. Comparison */}
        <Section n={3} title="How you compare">
          {r.s3 && r.s3.comparison.length > 0 ? (() => {
            const names = [...new Set(r.s3.comparison.flatMap((row) => row.competitors.map((c) => c.name)))];
            return (
              <div className="overflow-x-auto"><table className="w-full text-left text-xs">
                <thead><tr className="border-b text-neutral-500"><th className="py-1">Attribute</th><th>You</th>{names.map((n) => <th key={n}>{n}</th>)}<th>Verdict</th></tr></thead>
                <tbody>
                  {r.s3.comparison.map((row, i) => (
                    <tr key={i} className="break-inside-avoid border-b align-top">
                      <td className="py-1 pr-2 font-medium">{row.attribute}</td>
                      <td className="pr-2">{row.seller_value ?? <span className="text-neutral-400">unknown</span>}</td>
                      {names.map((n) => {
                        const c = row.competitors.find((x) => x.name === n);
                        return <td key={n} className="pr-2">{c?.value ? <>{c.value}<Cite r={r} id={c.source_id} /></> : <span className="text-neutral-400">unknown</span>}</td>;
                      })}
                      <td><Badge text={row.verdict.replace("_", " ")} cls={VERDICT[row.verdict]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            );
          })() : <p className="text-neutral-500">No comparison could be built from the documents provided.</p>}
          {r.s3 && r.s3.missing_data.length > 0 && <p className="text-xs text-neutral-500">Could not compare: {r.s3.missing_data.join("; ")}</p>}

          {r.s2 && r.s2.competitors.some((c) => c.findings.length > 0) && (
            <div>
              <h3 className="font-semibold">What we found about each competitor</h3>
              {r.s2.competitors.filter((c) => c.findings.length > 0).map((c) => (
                <details key={c.name} open className="mt-1 break-inside-avoid">
                  <summary className="cursor-pointer font-medium">{c.name}</summary>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {c.findings.map((f, i) => (
                      <li key={i}><b>{f.topic}:</b> {f.fact}<Cite r={r} id={f.source_id} />{f.source?.stale && <span className="ml-1"><Badge text="old document" cls="bg-amber-100 text-amber-800" /></span>}</li>
                    ))}
                  </ul>
                </details>
              ))}
              {r.s2.coverage_gaps.length > 0 && <p className="mt-1 text-xs text-neutral-500">Not found in your documents: {r.s2.coverage_gaps.join("; ")}</p>}
            </div>
          )}
        </Section>

        {/* 4. Problems */}
        <Section n={4} title="Problems holding you back">
          {problems.length === 0 && <p className="text-neutral-500">No well-evidenced problems were found.</p>}
          {problems.map((p) => (
            <article key={p.id} className="break-inside-avoid rounded border p-3">
              <h3 className="font-semibold">{p.id} · {p.title}</h3>
              <p className="mt-0.5 text-xs"><Badge text={`severity ${p.severity}`} cls={LEVEL[p.severity]} /> <Badge text={`confidence ${p.confidence}`} cls="bg-neutral-100 text-neutral-700" /></p>
              <p className="mt-2">{p.description}</p>
              <p className="mt-2 text-xs font-semibold text-neutral-500">EVIDENCE</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs">
                {p.metric_evidence.map((e, i) => <li key={`m${i}`}>{e.detail} <span className="text-neutral-400">({e.ref})</span></li>)}
                {p.competitor_evidence.map((e, i) => <li key={`c${i}`}>{e.detail} <i className="text-neutral-600">“{e.quote}”</i><Cite r={r} id={e.source_id} /></li>)}
              </ul>
            </article>
          ))}
          {r.s4 && r.s4.insufficient_data.length > 0 && <p className="text-xs text-neutral-500">Gaps in the data: {r.s4.insufficient_data.join("; ")}</p>}
        </Section>

        {/* 5. Solutions */}
        <Section n={5} title="What to do about it, and what it might be worth">
          {sols.length === 0 && <p className="text-neutral-500">No solutions were produced.</p>}
          {sols.map((s: StoredSolution, i) => (
            <article key={s.id} className="break-inside-avoid rounded border p-3">
              <h3 className="font-semibold">#{i + 1} · {s.title} <span className="text-xs font-normal text-neutral-500">({s.id} for {s.problem_id})</span></h3>
              <p className="mt-0.5 text-xs"><Badge text={`effort ${s.effort}`} cls="bg-neutral-100 text-neutral-700" /> <Badge text={`confidence ${s.confidence}`} cls="bg-neutral-100 text-neutral-700" /></p>
              <p className="mt-2">{s.description}</p>
              <p className="mt-2">
                <b>Estimated gain per month: {fmtRange(s.roi?.gain_low_monthly, s.roi?.gain_high_monthly)}</b>
                {s.roi && <span className="text-xs text-neutral-600"> · assumes a {s.roi.lift_low_pct}–{s.roi.lift_high_pct}% lift on {s.roi.affected_share_pct}% of a monthly base of {fmtNum(s.roi.baseline_monthly)}{s.roi.one_time_cost ? `; one-off cost ${fmtNum(s.roi.one_time_cost)}` : ""}</span>}
              </p>
              {s.roi && <p className="text-xs text-neutral-600">Why that lift: {s.roi.basis}</p>}
              {s.assumptions.length > 0 && <p className="mt-1 text-xs"><b>Assumptions:</b> {s.assumptions.join(" · ")}</p>}
              {s.risks.length > 0 && <p className="text-xs"><b>Risks:</b> {s.risks.join(" · ")}</p>}
            </article>
          ))}
          {sols.length > 0 && <p className="text-xs text-neutral-500">Estimates rest on the stated assumptions, not on measured results. Several actions affect the same sales, so the ranges overlap and must not be added together. Amounts are in your data&apos;s own currency (none was specified).</p>}
        </Section>

        {/* 6. Plan */}
        <Section n={6} title="Your 30-day plan">
          {r.s6 ? (
            <>
              {r.s6.weeks.slice().sort((a, b) => a.week - b.week).map((w) => (
                <div key={w.week} className="break-inside-avoid">
                  <h3 className="font-semibold">Week {w.week}: {w.theme}</h3>
                  <ul className="mt-1 space-y-1">
                    {w.actions.map((a, i) => (
                      <li key={i} className="rounded border-l-4 border-neutral-300 pl-2">
                        {a.task} <span className="text-xs text-neutral-500">({a.solution_id} · {a.owner_role})</span>
                        <div className="text-xs text-neutral-600">Track: {a.kpi_to_track}. {a.how_measured}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              {r.s6.baseline_snapshot.length > 0 && (
                <div className="break-inside-avoid">
                  <h3 className="font-semibold">Where you start (baseline)</h3>
                  <div className="overflow-x-auto"><table className="mt-1 w-full text-left text-xs">
                    <thead><tr className="border-b text-neutral-500"><th className="py-1">KPI</th><th>Value now</th><th>Source query</th></tr></thead>
                    <tbody>{r.s6.baseline_snapshot.map((b, i) => <tr key={i} className="border-b"><td className="py-1 pr-2">{b.kpi}</td><td className="pr-2 font-medium">{b.value}</td><td className="text-neutral-400">{b.ref}</td></tr>)}</tbody>
                  </table></div>
                  <p className="mt-1 text-xs">Re-upload your data on or after <b>{recheckOn}</b> to see what changed.</p>
                </div>
              )}

              <PlanEditor
                analysisId={id}
                recheckOn={recheckOn}
                solutions={[...new Set([...topIds, ...r.s6.weeks.flatMap((w) => w.actions.map((a) => a.solution_id))])]
                  .filter((sid) => solById.has(sid))
                  .map((sid) => { const s = solById.get(sid)!; return { id: sid, title: s.title, gain: fmtRange(s.roi?.gain_low_monthly, s.roi?.gain_high_monthly), effort: s.effort, top: topIds.includes(sid) }; })}
                initial={Object.fromEntries(r.plan.map((p) => [p.solutionId, { adopted: p.adopted, owner: p.owner, dueDate: p.dueDate }]))}
              />
              <ProgressCheck analysisId={id} projectId={r.project.id} />
            </>
          ) : <p className="text-neutral-500">The plan step did not complete.</p>}
        </Section>

        {/* 7. Ads (code-built; renders nothing when no ads report is uploaded) */}
        {ads && <AdsSection m={ads} n={7} />}

        {/* 8. Quality */}
        <Section n={ads ? 8 : 7} title="How this report was checked" id="quality">
          <p>Each step&apos;s output is validated by code before the next step sees it. Claims that can&apos;t be traced to your data or to a quoted competitor passage are removed or flagged rather than passed on.</p>
          <div className="overflow-x-auto"><table className="w-full text-left text-xs">
            <thead><tr className="border-b text-neutral-500"><th className="py-1">Step</th><th>Self-corrections</th><th>Claims removed</th><th>Figures unverified</th></tr></thead>
            <tbody>
              {r.gates.map((g) => (
                <tr key={g.step} className="border-b"><td className="py-1">{g.step}. {STEP_NAMES[g.step - 1]}</td><td>{g.repairs}</td><td>{g.dropped.length}</td><td>{g.warnings.length}</td></tr>
              ))}
            </tbody>
          </table></div>
          {r.gates.some((g) => g.dropped.length > 0) && (
            <div className="text-xs">
              <b>Removed because they couldn&apos;t be verified:</b>
              <ul className="list-disc pl-5">{r.gates.flatMap((g) => g.dropped.map((d, i) => <li key={`${g.step}-${i}`}>Step {g.step}: {d}</li>))}</ul>
            </div>
          )}
          {r.gates.some((g) => g.warnings.length > 0) && (
            <div className="text-xs">
              <b>Left in, but not fully verified:</b>
              <ul className="list-disc pl-5">{r.gates.flatMap((g) => g.warnings.map((w, i) => <li key={`${g.step}-${i}`}>Step {g.step}: {w}</li>))}</ul>
            </div>
          )}
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-neutral-600">
            <li>A figure is &ldquo;verified&rdquo; when it matches a result computed from your data or a calculator call. That shows the figure exists, not that every sentence around it is right: read the evidence next to each problem.</li>
            <li>Competitor information comes only from the documents you uploaded and is only as current as their dates (older ones are flagged).</li>
            <li>Your own shipping, returns and warranty policies were not in the data, so they are shown as unknown rather than guessed.</li>
            <li>Model {r.analysis.model ?? "n/a"} · {fmtNum(r.analysis.inputTokens + r.analysis.outputTokens)} tokens · estimated AI cost ${r.analysis.costUsd}.</li>
          </ul>
        </Section>

        {/* Sources */}
        {Object.keys(r.citations).length > 0 && (
          <section className="mt-8">
            <h2 className="border-b pb-1 text-lg font-semibold">Sources</h2>
            <ul className="mt-3 space-y-2 text-xs">
              {Object.values(r.citations).sort((a, b) => a.sourceId.localeCompare(b.sourceId, undefined, { numeric: true })).map((c) => (
                <li key={c.sourceId} id={anchor(c.sourceId)} className="break-inside-avoid">
                  <b>[{c.competitor}{c.page ? ` p.${c.page}` : ""}]</b> {c.title}{c.docDate ? `, dated ${c.docDate}` : ""} <span className="text-neutral-400">({c.sourceId})</span>
                  <div className="text-neutral-600">{c.snippet}{c.snippet.length >= 280 ? "…" : ""}</div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
