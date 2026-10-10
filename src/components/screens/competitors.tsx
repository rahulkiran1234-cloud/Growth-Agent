"use client";
import Link from "next/link";
import { Ev } from "@/components/workspace/evidence-drawer";
import { Button, Card, Headline, Note, PageTitle, Pill, type Tone } from "@/components/ui";
import { NeedsAnalysis, Stale, useView } from "./common";
import { TrackerSection } from "./tracker-section";

const VERDICT: Record<string, { tone: Tone; label: string }> = {
  seller_ahead: { tone: "good", label: "Ahead" },
  seller_behind: { tone: "bad", label: "Behind" },
  parity: { tone: "neutral", label: "On par" },
  unknown: { tone: "warn", label: "Unknown" },
};

export default function Competitors() {
  const v = useView();
  if (!v) return null;
  const report = v.data.report;
  const id = v.ws.id;
  if (!report?.s3 || !report.s2) {
    return (
      <div className="space-y-4">
        <PageTitle title="Competitors" sub="How you compare, with every claim tied to a source" />
        <TrackerSection />
        <NeedsAnalysis what="Reading your competitor documents and tracking data and comparing them with your numbers" />
      </div>
    );
  }
  const rows = report.s3.comparison;
  const names = [...new Set([...report.s2.competitors.map((c) => c.name), ...rows.flatMap((r) => r.competitors.map((c) => c.name))])];
  const count = (k: string) => rows.filter((r) => r.verdict === k).length;
  const known = rows.filter((r) => r.verdict !== "unknown").length;
  const behind = count("seller_behind");
  const findings = report.s2.competitors.reduce((s, c) => s + c.findings.length, 0);

  return (
    <div className="space-y-4">
      <PageTitle title="Competitors" sub="How you compare, with every claim tied to a source" />
      <Stale />
      <TrackerSection />
      <Headline
        title={known === 0 ? "There is not enough comparable data to say how you compare yet." : behind > 0 ? `You are behind on ${behind} of ${known} comparable areas${count("seller_ahead") ? ` and ahead on ${count("seller_ahead")}` : ""}.` : `You are on par or ahead on all ${known} comparable areas.`}
        sub={`${names.length} competitor${names.length === 1 ? "" : "s"} · ${findings} findings, each checked against a quoted passage in your uploaded files.`}
        right={<Pill tone="info">Sources checked</Pill>}
      />

      <Card title="Scoreboard">
        <div className="flex h-3 overflow-hidden rounded-full bg-[#ecebe6]" role="img" aria-label={`${count("seller_ahead")} ahead, ${count("parity")} on par, ${count("seller_behind")} behind, ${count("unknown")} unknown`}>
          {[["seller_ahead", "#0ca30c"], ["parity", "#898781"], ["seller_behind", "#d03b3b"], ["unknown", "#fab219"]].map(([k, c]) => count(k) > 0 && <span key={k} style={{ width: `${(count(k) / rows.length) * 100}%`, background: c, marginRight: 2 }} />)}
        </div>
        <p className="mt-2 flex flex-wrap gap-3 text-xs text-ink2">{Object.entries(VERDICT).map(([k, m]) => <span key={k}><Pill tone={m.tone}>{m.label}</Pill> <b className="tnum">{count(k)}</b></span>)}</p>
      </Card>

      <Card title="Comparison matrix">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead><tr className="border-b border-line text-xs text-muted"><th className="py-1.5">Area</th><th>You</th>{names.map((n) => <th key={n}>{n}</th>)}<th>Verdict</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const m = VERDICT[r.verdict];
                return (
                  <tr key={r.attribute} className="border-b border-line/60 align-top">
                    <td className="py-2 pr-3 font-semibold">{r.attribute}<span className="block text-[11px] font-normal text-muted">{r.note}</span></td>
                    <td className="pr-3 font-semibold">{r.seller_value ?? <span className="font-normal text-muted">not in your data</span>} {r.seller_ref && <Ev refId={r.seller_ref} />}</td>
                    {names.map((n) => { const c = r.competitors.find((x) => x.name === n); return <td key={n} className="pr-3 text-ink2">{c?.value ?? <span className="text-muted">–</span>} {c?.source_id && <Ev refId={c.source_id} />}</td>; })}
                    <td><Pill tone={m.tone}>{m.label}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        {report.s2.competitors.map((c) => (
          <Card key={c.name} title={`Evidence · ${c.name}`} right={<span className="text-xs text-muted">{c.findings.length} verified findings</span>}>
            {c.findings.length === 0 ? <p className="text-sm text-muted">No verified findings for this competitor.</p> : (
              <ul className="space-y-2">
                {c.findings.map((f, i) => {
                  const src = report.citations[f.source_id];
                  return (
                    <li key={i} className="rounded-lg border border-line p-2.5">
                      <p className="text-sm"><b>{f.topic}.</b> {f.fact}</p>
                      <p className="mt-1 border-l-4 border-brand pl-2 text-xs italic text-ink2">&ldquo;{f.quote}&rdquo;</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted"><Ev refId={f.source_id} />{src ? `${src.title}${src.page ? ` · p.${src.page}` : ""}${src.docDate ? ` · ${src.docDate}` : ""}` : ""}<Pill tone="good">Quote verified</Pill></p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        ))}
      </div>

      {(report.s2.coverage_gaps.length > 0 || report.s3.missing_data.length > 0) && (
        <Card title="What we could not find" right={<Button href={`/projects/${id}/data`} variant="ghost">Add competitor files</Button>}>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink2">
            {[...report.s2.coverage_gaps, ...report.s3.missing_data].map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        </Card>
      )}
      <Note tone="info">Competitor claims are only shown when an exact quote from your uploaded file supports them. See the <Link className="underline" href={`/analysis/${report.analysis.id}/report#quality`}>quality section of the report</Link> for what was removed.</Note>
    </div>
  );
}
