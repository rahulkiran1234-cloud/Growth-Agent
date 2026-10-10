"use client";
import Link from "next/link";
import { useMemo } from "react";
import { BarsTrend, ChartCard, Sparkline, Waterfall, C } from "@/components/charts/charts";
import { Ev } from "@/components/workspace/evidence-drawer";
import { Button, Card, Delta, Headline, Note, PageTitle, Pill, type Tone } from "@/components/ui";
import { allProductEvents, bridge, compact, monthLabel, num, pctChange, salesVerdict, signed } from "@/lib/insights/aggregate";
import { SEVERITY_ORDER } from "@/lib/report/format";
import { NeedsAnalysis, NoData, RunAnalysis, Stale, useView } from "./common";

const SEV_TONE: Record<string, Tone> = { high: "bad", medium: "warn", low: "neutral" };

export default function Overview() {
  const v = useView();
  const report = v?.data.report ?? null;
  const pts = v?.pts;
  const first = pts?.[0], last = pts?.[pts.length - 1];

  const priceChanges = useMemo(() => (v ? allProductEvents(v.ins, { ...v.filter, sku: null }).slice(0, 4) : []), [v]);
  const br = useMemo(() => (first && last && pts && pts.length > 1 ? bridge({ revenue: first.revenue, units: first.units }, { revenue: last.revenue, units: last.units }) : null), [first, last, pts]);
  if (!v || !pts || !first || !last) return null;
  if (!v.hasSales) return <><PageTitle title="Overview" /><NoData /></>;

  const revPct = pctChange(last.revenue, first.revenue);
  const headline = (() => {
    if (!br || revPct == null) return `Revenue in ${monthLabel(last.month)} was ${compact(last.revenue)}.`;
    const dir = revPct < 0 ? "down" : "up";
    const driver = Math.abs(br.volume) >= Math.abs(br.price) ? "volume" : "price";
    const other = driver === "volume" ? "price" : "volume";
    return `Revenue is ${dir} ${Math.abs(revPct).toFixed(1)}% since ${monthLabel(first.month)}, driven mostly by ${driver} rather than ${other}.`;
  })();
  const sub = br ? `${monthLabel(first.month)} to ${monthLabel(last.month)}: ${br.volume < 0 ? "fewer units sold lowered" : "more units sold raised"} revenue by ${compact(Math.abs(br.volume))}, and a ${br.price < 0 ? "lower" : "higher"} average price ${br.price < 0 ? "lowered" : "raised"} it by ${compact(Math.abs(br.price))}.` : undefined;

  const problems = [...(report?.s4?.problems ?? [])].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const rank = new Map((report?.s6?.ranking ?? []).map((r, i) => [r.id, i]));
  const solutions = [...(report?.s5?.solutions ?? [])].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)).slice(0, 4);
  const rows = pts.map((p) => ({ label: monthLabel(p.month), revenue: Math.round(p.revenue), units: p.units }));
  const kpis: { label: string; value: string; delta: number | null; suffix: string; good: "up" | "down"; spark: (number | null)[]; color: string }[] = [
    { label: `Revenue (${monthLabel(last.month)})`, value: compact(last.revenue), delta: revPct, suffix: "%", good: "up", spark: pts.map((p) => p.revenue), color: C.s1 },
    { label: "Avg price", value: last.price ? num(last.price) : "n/a", delta: last.price && first.price ? pctChange(last.price, first.price) : null, suffix: "%", good: "up", spark: pts.map((p) => p.price), color: C.s2 },
    { label: "Avg rating", value: last.avgRating?.toFixed(2) ?? "n/a", delta: last.avgRating != null && first.avgRating != null ? last.avgRating - first.avgRating : null, suffix: "", good: "up", spark: pts.map((p) => p.avgRating), color: C.s1 },
    { label: "Low ratings (1-3★)", value: last.lowPct != null ? `${last.lowPct}%` : "n/a", delta: last.lowPct != null && first.lowPct != null ? last.lowPct - first.lowPct : null, suffix: " pts", good: "down", spark: pts.map((p) => p.lowPct), color: C.s2 },
    { label: "Return rate", value: last.returnRate != null ? `${last.returnRate}%` : "n/a", delta: last.returnRate != null && first.returnRate != null ? last.returnRate - first.returnRate : null, suffix: " pts", good: "down", spark: pts.map((p) => p.returnRate), color: C.s2 },
  ];

  return (
    <div className="space-y-4">
      <PageTitle title="Overview" sub={`${monthLabel(first.month)} – ${monthLabel(last.month)}${v.filter.sku ? ` · ${v.filter.sku}` : " · all products"}`} />
      <Stale />
      <Headline title={headline} sub={sub} right={report ? <Pill tone="info">Computed from your data</Pill> : null} />
      {!report && <Card><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-ink2">These charts come straight from your data. The AI analysis adds <b>why</b> it happened, competitor comparison and a 30-day plan.</p><RunAnalysis /></div></Card>}
      {report?.s6?.summary && <Card title="AI summary" right={<Pill tone="neutral">AI-written, figures checked</Pill>}><p className="text-sm text-ink2">{report.s6.summary}</p></Card>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-line bg-surface p-3">
            <p className="text-[11px] text-muted">{k.label}</p>
            <div className="flex items-end justify-between gap-1">
              <p className="text-2xl font-bold tracking-tight tnum">{k.value}</p>
              <Sparkline values={k.spark} color={k.color} />
            </div>
            <Delta value={k.delta} goodWhen={k.good} suffix={k.suffix} digits={k.suffix === "%" || k.suffix === " pts" ? 1 : 2} />
            <span className="ml-1 text-[11px] text-muted">vs {monthLabel(first.month)}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <ChartCard className="lg:col-span-2" title="Revenue by month" focus={`revenue by month ${v.filter.sku ?? "all products"}`} sub="Bars are monthly revenue" table={{ cols: ["Month", "Revenue", "Units", "Orders", "Avg price"], rows: pts.map((p) => [monthLabel(p.month), num(p.revenue), num(p.units), num(p.orders), p.price ? num(p.price) : "n/a"]) }}>
          <BarsTrend data={rows} dataKey="revenue" name="Revenue" yFmt={compact} valueFmt={num} />
        </ChartCard>
        <ChartCard title="What changed" sub={br ? `${monthLabel(first.month)} to ${monthLabel(last.month)}` : "Needs two months with sales"} focus="revenue bridge between the first and last month">
          {br ? <Waterfall steps={[{ name: monthLabel(first.month), value: br.start, kind: "total" }, { name: "Volume", value: br.volume, kind: "delta" }, { name: "Price", value: br.price, kind: "delta" }, { name: monthLabel(last.month), value: br.end, kind: "total" }]} fmt={compact} /> : <p className="py-10 text-center text-sm text-muted">Pick a period of at least two months.</p>}
          {br && <p className="mt-1 text-[11px] text-muted">Volume effect = change in units × old price. Price effect = change in average price × new units. Computed by code.</p>}
        </ChartCard>
      </div>

      <Card title="Price changes and what happened to sales" right={<Link className="text-xs font-semibold text-brand-deep underline" href={`/projects/${v.ws.id}/sales-price?tab=Price%20events`}>See all price changes</Link>}>
        {priceChanges.length === 0 ? <p className="text-sm text-muted">No product changed its price by 3% or more in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm tnum">
              <thead><tr className="border-b border-line text-xs text-muted"><th className="py-1.5">Product</th><th>When</th><th>Price</th><th>Units / month</th><th>What happened</th></tr></thead>
              <tbody>
                {priceChanges.map(({ sku, e }) => {
                  const sv = salesVerdict(e);
                  return (
                    <tr key={sku + e.month} className="border-b border-line/60">
                      <td className="py-1.5 font-semibold"><Link className="underline" href={`/projects/${v.ws.id}/sales-price?sku=${encodeURIComponent(sku)}`}>{sku}</Link></td>
                      <td>{monthLabel(e.month)}</td>
                      <td>{num(e.priceBefore)} → {num(e.priceAfter)} <b className={e.pricePct < 0 ? "text-crit" : "text-good"}>({signed(e.pricePct)}%)</b></td>
                      <td>{num(e.unitsBefore)} → {num(e.unitsAfter)} {e.unitsPct != null && <b className={e.unitsPct < 0 ? "text-crit" : "text-good"}>({signed(e.unitsPct)}%)</b>}</td>
                      <td><Pill tone={sv.kind === "up" ? "good" : sv.kind === "unknown" ? "neutral" : "warn"}>{sv.label}</Pill></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted">Averages over the months before and after each change. This shows what moved together, not what caused it.</p>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Top problems" right={report ? <Link className="text-xs font-semibold text-brand-deep underline" href={`/projects/${v.ws.id}/plan`}>Open action plan</Link> : null}>
          {!report ? <NeedsAnalysis what="Problem detection" /> : problems.length === 0 ? <p className="text-sm text-muted">No problems were confirmed by the evidence checks.</p> : (
            <ul className="divide-y divide-line">
              {problems.map((p) => (
                <li key={p.id} className="py-2">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                      <Pill tone={SEV_TONE[p.severity]}>{p.severity}</Pill>
                      <b className="min-w-0 flex-1">{p.title}</b>
                      <span className="text-[11px] text-muted">confidence {p.confidence}</span>
                    </summary>
                    <div className="mt-2 space-y-2 pl-1 text-sm text-ink2">
                      <p>{p.description}</p>
                      {p.metric_evidence.map((m, i) => <p key={i} className="text-xs">{m.detail} <Ev refId={m.ref} /></p>)}
                      {p.competitor_evidence.map((c, i) => <p key={i} className="rounded border-l-4 border-brand bg-page p-2 text-xs italic">&ldquo;{c.quote}&rdquo; <Ev refId={c.source_id} /></p>)}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Best next actions">
          {!report ? <p className="text-sm text-muted">Available after the AI analysis.</p> : (
            <ul className="space-y-2">
              {solutions.map((s) => (
                <li key={s.id} className="border-b border-line pb-2 text-sm last:border-0">
                  <p><b className="text-brand-deep">{s.id}</b> {s.title}</p>
                  <p className="text-xs text-muted">{s.roi ? `est. gain ${num(s.roi.gain_low_monthly)}–${num(s.roi.gain_high_monthly)} / month` : "no ROI estimate"} · effort {s.effort}</p>
                </li>
              ))}
              <Button href={`/projects/${v.ws.id}/plan`} className="w-full">Build my 30-day plan</Button>
            </ul>
          )}
        </Card>
      </div>
      {report && report.s1?.data_quality_notes?.length ? <Note tone="info">Data notes: {report.s1.data_quality_notes.join(" ")}</Note> : null}
    </div>
  );
}
