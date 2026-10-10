"use client";
import { useMemo, useState } from "react";
import { ChartCard, HBars, LineTrend, ProductScatter, C } from "@/components/charts/charts";
import { Card, Headline, Note, PageTitle, Pill } from "@/components/ui";
import { monthLabel, num, signed } from "@/lib/insights/aggregate";
import { NoData, topicLabel, useView } from "./common";

export default function Customers() {
  const v = useView();
  const [picked, setPicked] = useState<string | null>(null);
  const topic = useMemo(() => picked ?? v?.tops[0]?.topic ?? null, [picked, v]);
  if (!v) return null;
  if (!v.hasReviews) return <><PageTitle title="Customers" /><NoData>Upload a reviews file to see ratings, complaint themes and how they connect to returns.</NoData></>;

  const { pts, tops, ins, filter, ws } = v;
  const withR = pts.filter((p) => p.reviews > 0);
  const first = withR[0], last = withR[withR.length - 1];
  const totalReviews = pts.reduce((s, p) => s + p.reviews, 0);
  const lowDelta = first && last && first.lowPct != null && last.lowPct != null ? last.lowPct - first.lowPct : null;
  const headline = first && last && first !== last && lowDelta != null
    ? `Low-rated reviews ${lowDelta > 0 ? "rose" : "fell"} from ${first.lowPct}% to ${last.lowPct}% between ${monthLabel(first.month)} and ${monthLabel(last.month)}${tops[0] ? `; ${topicLabel(tops[0].topic).toLowerCase()} is the most common complaint (${tops[0].pct}%)` : ""}.`
    : `${num(totalReviews)} reviews in this period${tops[0] ? `; ${topicLabel(tops[0].topic).toLowerCase()} is the most common complaint (${tops[0].pct}%)` : ""}.`;

  const rating = pts.map((p) => ({ label: monthLabel(p.month), rating: p.avgRating }));
  const low = pts.map((p) => ({ label: monthLabel(p.month), low: p.lowPct }));
  const retRows = v.prods.filter((p) => p.orders >= 20 && p.returnRate != null).sort((a, b) => (b.returnRate ?? 0) - (a.returnRate ?? 0)).slice(0, 8);
  const scatter = v.prods.filter((p) => p.orders >= 20 && p.reviews >= 10 && p.returnRate != null && p.lowPct != null).map((p) => ({ sku: p.sku, x: p.lowPct!, y: p.returnRate!, z: p.revenue }));
  const topThemes = tops.slice(0, 4);
  const quotes = (topic && ins.quotes[topic]) || [];
  const tagged = tops.length > 0;

  return (
    <div className="space-y-4">
      <PageTitle title="Customers" sub="Ratings, complaint themes and returns" />
      <Headline title={headline} right={<Pill tone="neutral">{num(totalReviews)} reviews</Pill>} sub={retRows[0] && tops[0] ? `${retRows[0].sku} has the highest return rate (${retRows[0].returnRate}%).` : undefined} />

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Average rating by month" sub="Out of 5" focus="average rating by month" table={{ cols: ["Month", "Avg rating", "Reviews"], rows: pts.map((p) => [monthLabel(p.month), p.avgRating ?? "n/a", p.reviews]) }}>
          <LineTrend data={rating} series={[{ key: "rating", name: "Avg rating", color: C.s1 }]} yFmt={(x) => x.toFixed(1)} valueFmt={(_, x) => x.toFixed(2)} domain={[(m: number) => Math.max(1, Math.floor((m - 0.2) * 5) / 5), (m: number) => Math.min(5, Math.ceil((m + 0.2) * 5) / 5)]} height={200} />
        </ChartCard>
        <ChartCard title="Share of 1–3★ reviews" sub="Lower is better" focus="share of low-rated reviews by month" table={{ cols: ["Month", "Low-rated share", "Reviews"], rows: pts.map((p) => [monthLabel(p.month), p.lowPct != null ? `${p.lowPct}%` : "n/a", p.reviews]) }}>
          <LineTrend data={low} series={[{ key: "low", name: "1–3★ share", color: C.s2 }]} yFmt={(x) => `${Math.round(x)}%`} valueFmt={(_, x) => `${x}%`} height={200} />
        </ChartCard>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <ChartCard className="lg:col-span-2" title="What unhappy customers mention" sub="Share of tagged 1–3★ reviews (a review can mention several themes). Click a theme to read examples." focus="complaint themes in low-rated reviews" table={{ cols: ["Theme", "Mentions", "Share"], rows: tops.map((t) => [topicLabel(t.topic), t.count, `${t.pct}%`]) }}>
          {tagged ? <HBars items={tops.map((t, i) => ({ name: topicLabel(t.topic), value: t.pct, color: i === 0 ? C.s2 : C.s1, hint: `${t.count} mentions` }))} max={Math.max(40, tops[0].pct)} onPick={(name) => setPicked(tops.find((t) => topicLabel(t.topic) === name)?.topic ?? null)} active={topic ? topicLabel(topic) : null} /> : <p className="py-8 text-center text-sm text-muted">Themes appear once reviews have been tagged. This happens automatically after upload.</p>}
        </ChartCard>
        <Card title={topic ? `In their words: ${topicLabel(topic)}` : "In their words"}>
          {quotes.length === 0 ? <p className="text-sm text-muted">No examples to show.</p> : (
            <ul className="space-y-2">{quotes.map((q, i) => (
              <li key={i} className="rounded-r-lg border-l-4 border-brand bg-page p-2 text-sm italic text-ink2">&ldquo;{q.text}&rdquo;
                <span className="mt-0.5 block text-[11px] not-italic text-muted">{"★".repeat(q.rating)}{"☆".repeat(5 - q.rating)} · {q.date}{q.sku ? ` · ${q.sku}` : ""}</span></li>
            ))}</ul>
          )}
          <p className="mt-2 text-[11px] text-muted">Most recent real reviews with this theme.</p>
        </Card>
      </div>

      {topThemes.length > 1 && (
        <Card title="Themes over time" right={<span className="text-xs text-muted">Share of low-rated reviews per month</span>}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {topThemes.map((t) => {
              const d = pts.map((p, i) => ({ label: monthLabel(p.month), v: t.monthly[i] }));
              const a = t.monthly[0], b = t.monthly[t.monthly.length - 1];
              return (
                <div key={t.topic}>
                  <p className="text-xs font-semibold">{topicLabel(t.topic)} <span className={`tnum ${b - a > 0 ? "text-crit" : "text-good"}`}>{signed(b - a)} pts</span></p>
                  <LineTrend data={d} series={[{ key: "v", name: topicLabel(t.topic), color: C.s1 }]} yFmt={(x) => `${Math.round(x)}%`} valueFmt={(_, x) => `${x}%`} height={110} />
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Return rate by product" sub="Products with at least 20 orders" focus="return rate by product">
          {retRows.length === 0 ? <p className="py-6 text-center text-sm text-muted">No product has enough orders yet.</p> : <HBars items={retRows.map((p, i) => ({ name: p.sku, value: p.returnRate!, color: i < 2 ? C.s2 : C.s1, hint: `${p.orders} orders` }))} fmt={(x) => `${x}%`} onPick={(sku) => ws.setFilter({ ...filter, sku })} active={filter.sku} />}
        </ChartCard>
        <ChartCard title="Do unhappy reviews and returns go together?" sub="Each dot is a product; bigger dots earn more revenue" focus="relationship between return rate and share of low-rated reviews by product">
          {scatter.length < 3 ? <p className="py-10 text-center text-sm text-muted">Needs at least 3 products with 20+ orders and 10+ reviews.</p> : <ProductScatter points={scatter} xLabel="1–3★ review share" yLabel="Return rate" />}
          <p className="text-[11px] text-muted">Products in the top right have both problems. This shows association, not cause.</p>
        </ChartCard>
      </div>
      {!tagged && <Note tone="info">Review themes use AI tagging that runs after upload. If it did not run, re-upload the reviews file.</Note>}
    </div>
  );
}
