"use client";
import { useMemo, useState } from "react";
import { ChartCard, HBars, LineTrend, Sparkline, StackedBars, C } from "@/components/charts/charts";
import { Card, Headline, Note, PageTitle, Pill, type Tone } from "@/components/ui";
import { monthLabel, signed } from "@/lib/insights/aggregate";
import {
  BIG_DROP, BIG_REVENUE_SHARE, HIGH_LOW_SHARE, MIN_REVIEWS_FOR_VERDICT, MIN_REVIEWS_PER_HALF, OWNER_LABEL, PROTECT_RATING, SMALL_SAMPLE, VERDICT_LABEL, WEAK_RATING,
  ownerSplit, praiseThemes, ratingTrend, skuHealth, skuMovers, themePriorities, topProducts, type Owner, type Verdict,
} from "@/lib/insights/reviews";
import { NoData, topicLabel, useView } from "./common";

const VERDICT_TONE: Record<Verdict, Tone> = { protect: "good", watch: "neutral", fix_ours: "info", fix_supplier: "warn", retire: "bad", investigate: "warn", not_enough: "neutral" };
const PRIORITY_TONE = { high: "bad", medium: "warn", low: "neutral" } as const;
const OWNER_TONE: Record<Owner, Tone> = { ours: "info", supplier: "warn", mixed: "neutral" };
const OWNER_COLOR: Record<Owner, string> = { ours: C.s1, supplier: C.s2, mixed: "#c3c2b7" };

export default function Reviews() {
  const v = useView();
  const [picked, setPicked] = useState<string | null>(null);

  const calc = useMemo(() => {
    if (!v) return null;
    const { ins, filter } = v;
    const themes = themePriorities(ins, filter);
    return {
      trend: ratingTrend(ins, filter),
      movers: skuMovers(ins, filter),
      themes,
      split: ownerSplit(themes),
      health: skuHealth(ins, { ...filter, sku: null }),
      stars: topProducts(ins, filter),
      praise: praiseThemes(ins, { ...filter, sku: null }),
    };
  }, [v]);
  if (!v || !calc) return null;
  if (!v.hasReviews) return <><PageTitle title="Reviews" /><NoData>Upload a reviews file to see rating trends, which products drag ratings down, and what to fix first.</NoData></>;

  const { ins, filter, pts, ws } = v;
  const { trend, movers, themes, split, health, stars, praise } = calc;
  const slipping = movers.filter((m) => m.delta != null && m.delta <= -0.1).sort((a, b) => b.impact - a.impact);
  const improving = movers.filter((m) => m.delta != null && m.delta >= 0.1).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, 4);
  const needsAction = health.filter((h) => ["fix_ours", "fix_supplier", "retire", "investigate"].includes(h.verdict));
  const topic = picked ?? themes[0]?.topic ?? null;
  const topicRow = themes.find((t) => t.topic === topic);

  const trendWord = trend.direction === "down" ? "going down" : trend.direction === "up" ? "going up" : trend.direction === "flat" ? "holding steady" : null;
  const headline = trendWord && trend.early != null && trend.late != null
    ? `Ratings are ${trendWord}: ${trend.early} → ${trend.late} (early vs late part of the period)${slipping[0] && !filter.sku ? `. ${slipping[0].sku} is the biggest drag (${slipping[0].early} → ${slipping[0].late}).` : "."}`
    : "There are not enough reviews in both halves of this period to call a trend. Widen the period.";

  const volume = pts.map((p) => ({ label: monthLabel(p.month), positive: p.reviews > 0 && p.lowPct != null ? Math.round(p.reviews * (1 - p.lowPct / 100)) : 0, negative: p.reviews > 0 && p.lowPct != null ? Math.round(p.reviews * (p.lowPct / 100)) : 0 }));
  const rating = pts.map((p) => ({ label: monthLabel(p.month), rating: p.avgRating }));
  const scope = filter.sku ?? "all products";

  return (
    <div className="space-y-4">
      <PageTitle title="Reviews" sub="Trends, what is dragging ratings down, who can fix it, and what to protect" />
      <Headline title={headline} sub={needsAction.length ? `${needsAction.length} product${needsAction.length === 1 ? "" : "s"} need${needsAction.length === 1 ? "s" : ""} a decision: see Product decisions below.` : undefined}
        right={trend.direction !== "unknown" ? <Pill tone={trend.direction === "down" ? "bad" : trend.direction === "up" ? "good" : "neutral"}>{trend.direction === "down" ? "Falling" : trend.direction === "up" ? "Rising" : "Flat"}</Pill> : null} />

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Average rating by month" sub={`${scope}. Out of 5`} focus={`average rating trend for ${scope}`} table={{ cols: ["Month", "Avg rating", "Reviews", "1–3★ share"], rows: pts.map((p) => [monthLabel(p.month), p.avgRating ?? "n/a", p.reviews, p.lowPct != null ? `${p.lowPct}%` : "n/a"]) }}>
          <LineTrend data={rating} series={[{ key: "rating", name: "Avg rating", color: C.s1 }]} yFmt={(x) => x.toFixed(1)} valueFmt={(_, x) => x.toFixed(2)} domain={[(m: number) => Math.max(1, Math.floor((m - 0.2) * 5) / 5), (m: number) => Math.min(5, Math.ceil((m + 0.2) * 5) / 5)]} height={210} />
        </ChartCard>
        <ChartCard title="Good vs bad reviews each month" sub="4–5★ (blue) and 1–3★ (orange). Bar height is how many reviews came in" focus={`positive vs negative review volume for ${scope}`} table={{ cols: ["Month", "4–5★", "1–3★"], rows: volume.map((r) => [r.label, r.positive, r.negative]) }}>
          <StackedBars data={volume} height={210} />
        </ChartCard>
      </div>

      <Card title="Which products are pulling ratings down" right={<span className="text-xs text-muted">Early vs late half of the period · click a row to focus on it</span>}>
        {slipping.length === 0 ? <p className="text-sm text-muted">No product with enough reviews has slipped by 0.1 stars or more in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm tnum">
              <thead><tr className="border-b border-line text-xs text-muted"><th className="py-1.5">Product</th><th>Reviews</th><th>Rating</th><th>Change</th><th>1–3★ share now</th><th>Main complaint</th><th>Trend</th><th>Verdict</th></tr></thead>
              <tbody>
                {slipping.slice(0, 8).map((m) => {
                  const h = health.find((x) => x.sku === m.sku);
                  return (
                    <tr key={m.sku} onClick={() => ws.setFilter({ ...filter, sku: m.sku })} className={`cursor-pointer border-b border-line/60 hover:bg-[#f0efec] ${filter.sku === m.sku ? "bg-[#eaf2fc]" : ""}`}>
                      <td className="py-1.5 font-semibold">{m.sku}</td><td>{m.reviews}{m.reviews < SMALL_SAMPLE && <span className="ml-1 text-[10px] text-warnink" title="Few reviews, so the change may be noise">small sample</span>}</td><td>{m.early} → {m.late}</td>
                      <td className="font-bold text-crit">▼ {Math.abs(m.delta!).toFixed(2)}</td><td>{m.lowLate}%</td>
                      <td className="text-ink2">{m.topTheme ? `${topicLabel(m.topTheme.topic)} (${m.topTheme.pct}%)` : "n/a"}</td>
                      <td><Sparkline values={m.monthly} color={C.s2} w={70} h={22} /></td>
                      <td>{h && <Pill tone={VERDICT_TONE[h.verdict]}>{VERDICT_LABEL[h.verdict]}</Pill>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {improving.length > 0 && <p className="mt-3 text-xs text-ink2"><b>Improving:</b> {improving.map((m) => `${m.sku} (${m.early} → ${m.late})`).join(", ")}.</p>}
        {filter.sku && <p className="mt-2 text-xs text-muted">The charts and complaint groups above and below are filtered to {filter.sku}. <button type="button" className="underline" onClick={() => ws.setFilter({ ...filter, sku: null })}>Show all products</button></p>}
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Complaint groups: what to fix first" right={<span className="text-xs text-muted">{scope}</span>}>
          {themes.length === 0 ? <p className="text-sm text-muted">Complaint groups appear once low-rated reviews have been tagged (this happens automatically after upload).</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-sm tnum">
                <thead><tr className="border-b border-line text-xs text-muted"><th className="py-1.5">Group</th><th>Share</th><th>Change</th><th>Who can fix it</th><th>Priority</th></tr></thead>
                <tbody>
                  {[...themes].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]) || b.count - a.count).map((t) => (
                    <tr key={t.topic} onClick={() => setPicked(t.topic)} className={`cursor-pointer border-b border-line/60 hover:bg-[#f0efec] ${topic === t.topic ? "bg-[#eaf2fc]" : ""}`}>
                      <td className="py-1.5 font-semibold">{topicLabel(t.topic)}<span className="block text-[11px] font-normal text-muted">{t.count} mentions</span></td>
                      <td>{t.pct}%</td>
                      <td className={t.change > 1 ? "font-bold text-crit" : t.change < -1 ? "font-bold text-good" : "text-muted"}>{Math.abs(t.change) < 0.5 ? "steady" : `${t.change > 0 ? "▲" : "▼"} ${signed(t.change).replace(/^[+−]/, "")} pts`}</td>
                      <td><Pill tone={OWNER_TONE[t.owner]} icon={false}>{OWNER_LABEL[t.owner]}</Pill><span className="block text-[11px] text-muted">{t.area}</span></td>
                      <td><Pill tone={PRIORITY_TONE[t.priority]}>{t.priority}</Pill><span className="block text-[11px] text-muted">{t.why}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px] text-muted">Priority is High when a group is 15%+ of complaints and not falling, or 8%+ and rising 5+ points. Medium is 8%+. Who-can-fix is a rule of thumb per group, not a judgement on each review.</p>
        </Card>

        <div className="space-y-3">
          <Card title="Can we fix it, or is it the product?">
            {themes.length === 0 ? <p className="text-sm text-muted">No tagged complaints.</p> : (
              <>
                <div className="flex h-3 overflow-hidden rounded-full bg-[#ecebe6]" role="img" aria-label={`${split.ours}% we can fix, ${split.supplier}% supplier or product, ${split.mixed}% check first`}>
                  {(["ours", "supplier", "mixed"] as Owner[]).map((o) => split[o] > 0 && <span key={o} style={{ width: `${split[o]}%`, background: OWNER_COLOR[o], marginRight: 2 }} />)}
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {(["ours", "supplier", "mixed"] as Owner[]).map((o) => <li key={o} className="flex items-center justify-between"><span className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: OWNER_COLOR[o] }} />{OWNER_LABEL[o]}</span><b className="tnum">{split[o]}%</b></li>)}
                </ul>
                <p className="mt-2 text-[11px] text-muted">&ldquo;We can fix&rdquo; covers packing, delivery, service and pricing. &ldquo;Supplier / product&rdquo; is quality. &ldquo;Check first&rdquo; is mainly sizing: look at your size chart before blaming the product.</p>
              </>
            )}
          </Card>
          {topicRow && (
            <Card title={`${topicLabel(topicRow.topic)}: what to do`}>
              <p className="text-sm text-ink2">{topicRow.hint}</p>
              <ul className="mt-2 space-y-1.5">{(ins.quotes[topicRow.topic] ?? []).slice(0, 3).map((q, i) => (
                <li key={i} className="rounded-r-lg border-l-4 border-brand bg-page p-2 text-xs italic text-ink2">&ldquo;{q.text}&rdquo;<span className="block text-[10px] not-italic text-muted">{q.rating}★ · {q.date}{q.sku ? ` · ${q.sku}` : ""}</span></li>
              ))}</ul>
            </Card>
          )}
        </div>
      </div>

      <Card title="Product decisions" right={<span className="text-xs text-muted">All products · decision support, not a decision</span>}>
        {health.length === 0 ? <p className="text-sm text-muted">No product has reviews in this period.</p> : (
          <div className="space-y-4">
            {(["retire", "fix_supplier", "fix_ours", "investigate", "protect", "watch", "not_enough"] as Verdict[]).map((vd) => {
              const list = health.filter((h) => h.verdict === vd);
              if (list.length === 0) return null;
              if (vd === "not_enough" || vd === "watch") return <p key={vd} className="text-xs text-ink2"><Pill tone={VERDICT_TONE[vd]}>{VERDICT_LABEL[vd]}</Pill> <span className="ml-1">{list.length} product{list.length === 1 ? "" : "s"}: {list.slice(0, 12).map((h) => h.sku).join(", ")}{list.length > 12 ? "…" : ""}</span></p>;
              return (
                <div key={vd}>
                  <p className="mb-1.5 flex items-center gap-2 text-sm font-semibold"><Pill tone={VERDICT_TONE[vd]}>{VERDICT_LABEL[vd]}</Pill><span className="text-xs font-normal text-muted">{list.length} product{list.length === 1 ? "" : "s"}</span></p>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {list.slice(0, 6).map((h) => (
                      <div key={h.sku} className="rounded-lg border border-line p-3 text-xs">
                        <p className="flex items-center justify-between text-sm"><b>{h.sku}</b><span className="text-muted">{h.revenueShare}% of revenue</span></p>
                        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink2">{h.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                        {h.topThemes.length > 0 && <p className="mt-1 text-muted">Top complaints: {h.topThemes.map((t) => `${topicLabel(t.topic)} ${t.pct}%`).join(", ")}</p>}
                        <button type="button" className="mt-1.5 font-semibold text-brand-deep underline" onClick={() => ws.setFilter({ ...filter, sku: h.sku })}>Focus on {h.sku}</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer font-semibold text-ink2">How these verdicts are decided</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>Needs at least {MIN_REVIEWS_FOR_VERDICT} reviews in the period for a verdict, and at least {MIN_REVIEWS_PER_HALF} in each half of the period to call a trend; otherwise the screen says there are too few reviews.</li>
            <li><b>Protect:</b> rating {PROTECT_RATING}+ and not falling by more than 0.15.</li>
            <li><b>In trouble:</b> rating {WEAK_RATING} or lower, or {HIGH_LOW_SHARE}%+ of reviews at 1–3★, or a drop of {BIG_DROP}+ stars.</li>
            <li>If most complaints are about quality (supplier side): <b>Consider retiring or replacing</b> when the product is weak, not improving and brings under {BIG_REVENUE_SHARE}% of revenue; <b>Escalate to supplier</b> otherwise.</li>
            <li>If most complaints are about things we control (packing, delivery, service, pricing, sizing info): <b>Fix it ourselves</b>.</li>
            <li>Weigh the revenue at stake and the return rate before shutting anything down. Review text shows customer experience, not margin or stock position.</li>
          </ul>
        </details>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Reviews to protect: your best-rated products" right={<span className="text-xs text-muted">20+ reviews</span>}>
          {stars.length === 0 ? <p className="text-sm text-muted">No product has 20 or more reviews in this period yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm tnum">
                <thead><tr className="border-b border-line text-xs text-muted"><th className="py-1.5">Product</th><th>Rating</th><th>Reviews</th><th>Trend</th><th>Praised for</th></tr></thead>
                <tbody>
                  {stars.map((s) => (
                    <tr key={s.sku} onClick={() => ws.setFilter({ ...filter, sku: s.sku })} className="cursor-pointer border-b border-line/60 hover:bg-[#f0efec]">
                      <td className="py-1.5 font-semibold">{s.sku}</td><td className="font-bold">{s.avg.toFixed(2)}</td><td>{s.reviews}</td>
                      <td className="flex items-center gap-2"><Sparkline values={s.monthly} color={C.s1} w={64} h={20} /><Pill tone={s.trend === "up" ? "good" : s.trend === "down" ? "warn" : "neutral"}>{s.trend === "up" ? "Rising" : s.trend === "down" ? "Slipping" : s.trend === "steady" ? "Steady" : "Too few to tell"}</Pill></td>
                      <td className="text-xs text-ink2">{s.strengths.length ? s.strengths.map((x) => x.label).join(", ") : "n/a"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {ins.praise.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-muted">Recent 5★ reviews</p>
              <ul className="mt-1 grid gap-2 sm:grid-cols-2">{ins.praise.slice(0, 4).map((q, i) => <li key={i} className="rounded-r-lg border-l-4 border-[#1baf7a] bg-page p-2 text-xs italic text-ink2">&ldquo;{q.text}&rdquo;<span className="block text-[10px] not-italic text-muted">{q.date}{q.sku ? ` · ${q.sku}` : ""}</span></li>)}</ul>
            </div>
          )}
        </Card>
        <Card title="What customers love, and how to keep it" right={<span className="text-xs text-muted">4–5★ keyword match</span>}>
          {praise.length === 0 ? <p className="text-sm text-muted">No praise themes found.</p> : (
            <>
              <HBars items={praise.slice(0, 6).map((p) => ({ name: p.label, value: p.pct, color: C.s3, hint: `${p.count} mentions` }))} max={Math.max(40, praise[0].pct)} />
              <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-ink2">{praise.slice(0, 3).map((p) => <li key={p.key}><b>{p.label}:</b> {p.keep}</li>)}</ul>
            </>
          )}
        </Card>
      </div>
      <Note tone="info">Ratings, groups and verdicts are computed from your uploaded reviews and sales by code, with no AI guessing. Complaint groups come from the AI tagging done at upload; praise themes are simple keyword matches. Use the Ask the analyst button on any chart to dig deeper.</Note>
    </div>
  );
}
