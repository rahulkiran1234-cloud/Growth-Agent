"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { BarsTrend, ChartCard, LineTrend, C } from "@/components/charts/charts";
import { Button, Card, Delta, Empty, Headline, Note, PageTitle, Pill, type Tone } from "@/components/ui";
import { compact, num } from "@/lib/insights/aggregate";
import {
  ASSUMED_MARGIN, MIN_CLICKS, SCALE_BELOW, STATUS_LABEL, VERDICT_LABEL, WINDOW_DAYS, computeAds, recentRatings,
  type AdsModel, type SkuAds, type Status, type Verdict, type WeekPoint,
} from "@/lib/insights/ads";
import { useWorkspace } from "@/components/workspace/workspace";
import { useView } from "./common";

const VERDICT_TONE: Record<Verdict, Tone> = { scale: "good", hold: "neutral", cut: "warn", fix_first: "warn", dont_advertise: "bad", too_little: "neutral" };
const STATUS_TONE: Record<Status, Tone> = { under: "info", on_track: "good", over: "warn", unknown: "neutral" };

const pct = (v: number | null, digits = 0) => (v == null ? "–" : `${(v * 100).toFixed(digits)}%`);
const wkLabel = (w: string) => `${Number(w.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(w.slice(5, 7)) - 1]}`;

/** Drop the partial weeks at either end of the data, so the first and last points are not artificially low. */
function fullWeeks(weeks: WeekPoint[], from: string, asOf: string): WeekPoint[] {
  const full = weeks.filter((w) => w.week >= from && Date.parse(`${w.week}T00:00:00Z`) + 6 * 864e5 <= Date.parse(`${asOf}T00:00:00Z`));
  return full.length >= 2 ? full : weeks;
}

export default function Ads() {
  const v = useView();
  const ws = useWorkspace();
  const { id } = ws;
  const ads = v?.data.ads ?? null;
  const [profit, setProfit] = useState<Record<string, number> | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const router = useRouter();
  const profits = useMemo(() => profit ?? ads?.unitProfit ?? {}, [profit, ads]);
  const model = useMemo<AdsModel | null>(() => {
    if (!v || !ads) return null;
    return computeAds({
      days: ads.days, names: ads.names, unitProfit: profits, tracked: v.data.tracker,
      ratings: recentRatings(v.ins.reviewRows, v.ins.months.length),
    });
  }, [v, ads, profits]);
  if (!v) return null;

  if (!ads || !model) {
    return (
      <>
        <PageTitle title="Ads" sub="Where to spend more, where to spend less, and what to fix before spending at all" />
        <Empty title="Add your ads report to see this screen" action={<Button href={`/projects/${id}/data`}>Upload data</Button>}>
          Upload the advertising report from your marketplace (one row per day, SKU and campaign, with spend and sales from ads). We work out each SKU&rsquo;s ACOS, tell you which ones to spend more or less on, and propose a budget.
        </Empty>
      </>
    );
  }

  async function saveProfit(sku: string, raw: string) {
    const value = raw.trim() === "" ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) return setErr("Enter a profit per unit of 0 or more.");
    if ((value ?? undefined) === profits[sku]) return;
    setErr(""); setSaving(sku);
    const r = await fetch(`/api/projects/${id}/profit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku, unitProfit: value }) });
    setSaving(null);
    if (r.status === 401) return router.replace("/login?next=" + encodeURIComponent(window.location.pathname));
    if (!r.ok) return setErr(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "Could not save that.");
    const next = { ...profits };
    if (value === null) delete next[sku]; else next[sku] = value;
    setProfit(next);
  }

  const { totals: t, plan, skus } = model;
  const sel = skus.find((s) => s.sku === picked) ?? null;
  const losing = skus.filter((s) => s.wasted > 0 && s.verdict !== "too_little");
  const wk = fullWeeks(model.weeks, model.from, model.asOf);
  const weekly = wk.map((w) => ({ label: wkLabel(w.week), spend: w.spend, adSales: w.adSales, acos: w.acos == null ? null : Math.round(w.acos * 1000) / 10, tacos: w.tacos == null ? null : Math.round(w.tacos * 1000) / 10 }));
  const hasTacos = weekly.some((w) => w.tacos != null);

  const headline = t.acos == null
    ? `Ads spent ${compact(t.spend)} in the last ${model.windowDays} days and no sales came from them.`
    : `Ads spent ${compact(t.spend)} in the last ${model.windowDays} days and brought back ${compact(t.adSales)} (ACOS ${pct(t.acos)}). ${losing.length ? `${compact(t.wasted)} of that went to ${losing.length} SKU${losing.length === 1 ? "" : "s"} where ads cost more than the product earns.` : "Every SKU with enough data is paying for itself."}`;
  const sub = plan.freed > 0 || plan.added > 0
    ? `Suggested: move about ${compact(plan.freed * 30)} a month away from the weakest SKUs${plan.added > 0 ? `, ${plan.unspent > 0.5 ? `put ${compact(plan.added * 30)} behind the SKUs that earn it back, and keep ${compact(plan.unspent * 30)} unspent` : "and put it behind the SKUs that earn it back"}` : ""}.`
    : "No change to the overall budget is suggested right now.";

  const kpis: { label: string; value: string; delta?: number | null; good?: "up" | "down"; suffix?: string; hint?: string }[] = [
    { label: "Ad spend", value: compact(t.spend), delta: t.priorSpend ? ((t.spend / t.priorSpend) - 1) * 100 : null, good: "down", suffix: "%", hint: `last ${model.windowDays} days` },
    { label: "Sales from ads", value: compact(t.adSales), hint: t.adShare != null ? `${pct(t.adShare)} of all sales` : undefined },
    { label: "ACOS", value: pct(t.acos), delta: t.acos != null && t.priorAcos != null ? (t.acos - t.priorAcos) * 100 : null, good: "down", suffix: " pts", hint: "ad spend ÷ ad sales" },
    { label: "TACoS", value: pct(t.tacos), delta: t.tacos != null && t.priorTacos != null ? (t.tacos - t.priorTacos) * 100 : null, good: "down", suffix: " pts", hint: "ad spend ÷ all sales" },
    { label: "Wasted spend", value: compact(t.wasted), hint: "above break-even" },
  ];

  return (
    <div className="space-y-4">
      <PageTitle title="Ads" sub={`Last ${model.windowDays} days of ads, to ${model.asOf}. Where to spend more, where to spend less, and what to fix first`} />
      <Headline label="Ad spend" title={headline} sub={sub} />

      {model.warnings.map((w, i) => <Note key={i}>{w}</Note>)}
      {model.missingProfit.length > 0 && (
        <Note tone="info">
          {model.missingProfit.length === skus.filter((s) => s.recent.spend > 0).length ? "No profit per unit entered yet" : `${model.missingProfit.length} SKU${model.missingProfit.length === 1 ? " has" : "s have"} no profit per unit entered`}:
          break-even is worked out from an assumed {Math.round(ASSUMED_MARGIN * 100)}% margin, so treat those rows as a guide. Type your real profit per unit (what you keep on one sale before ad costs) in the table below and the advice updates straight away.
        </Note>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-line bg-surface p-3">
            <p className="text-[11px] font-medium text-muted">{k.label}</p>
            <p className="mt-0.5 text-xl font-bold tnum">{k.value}</p>
            <p className="text-[11px] text-muted">{k.delta != null && k.good ? <><Delta value={k.delta} goodWhen={k.good} suffix={k.suffix} digits={k.suffix === "%" ? 0 : 1} /> <span>vs the 4 weeks before</span></> : k.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Ad spend and sales from ads, by week" sub="Same money scale, all SKUs. The gap between the lines is what the ads earn back" focus="weekly ad spend versus sales from ads"
          table={{ cols: ["Week of", "Ad spend", "Sales from ads", "ACOS"], rows: weekly.map((w) => [w.label, num(w.spend), num(w.adSales), w.acos != null ? `${w.acos}%` : "n/a"]) }}>
          <LineTrend data={weekly} series={[{ key: "spend", name: "Ad spend", color: C.s2 }, { key: "adSales", name: "Sales from ads", color: C.s1 }]} yFmt={compact} valueFmt={(_, x) => num(x)} height={220} />
        </ChartCard>
        <ChartCard title={hasTacos ? "ACOS and TACoS, by week" : "ACOS, by week"} sub={hasTacos ? "ACOS = spend ÷ ad sales. TACoS = spend ÷ all sales. TACoS falling while ACOS holds means ads are lifting overall sales" : "Ad spend ÷ ad sales. Lower is better"} focus="weekly ACOS and TACoS"
          table={{ cols: ["Week of", "ACOS", "TACoS"], rows: weekly.map((w) => [w.label, w.acos != null ? `${w.acos}%` : "n/a", w.tacos != null ? `${w.tacos}%` : "n/a"]) }}>
          <LineTrend data={weekly} series={[{ key: "acos", name: "ACOS", color: C.s2 }, ...(hasTacos ? [{ key: "tacos", name: "TACoS", color: C.s3 }] : [])]} yFmt={(x) => `${x}%`} valueFmt={(_, x) => `${x}%`} height={220} />
        </ChartCard>
      </div>

      <Card title="Budget plan, SKU by SKU" right={<span className="text-xs text-muted">Click a row for the reasons · amounts are per month (30 days)</span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm tnum">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="py-1.5">SKU</th><th>Spend now</th><th>ACOS</th><th>Break-even</th><th>Profit / unit</th><th>Spending</th><th>Advice</th><th className="text-right">Suggested budget</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => (
                <tr key={s.sku} onClick={() => setPicked(picked === s.sku ? null : s.sku)} className={`cursor-pointer border-b border-line/60 align-top hover:bg-[#f0efec] ${picked === s.sku ? "bg-[#eaf2fc]" : ""}`}>
                  <td className="py-1.5 font-semibold">{s.sku}{s.name && <span className="block text-[11px] font-normal text-muted">{s.name}</span>}</td>
                  <td>{compact(s.dailyNow * 30)}</td>
                  <td className={s.breakEvenAcos != null && s.acos != null && s.acos > s.breakEvenAcos ? "font-bold text-crit" : ""}>{pct(s.acos)}</td>
                  <td>{pct(s.breakEvenAcos)}{s.profitSource === "assumed" && <span className="block text-[10px] text-warnink">assumed</span>}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="number" min={0} step="0.01" inputMode="decimal" aria-label={`Profit per unit for ${s.sku}`} defaultValue={profits[s.sku] ?? ""} key={`${s.sku}-${profits[s.sku] ?? ""}`}
                      placeholder={s.price ? `≈ ${Math.round(s.price * ASSUMED_MARGIN)}` : "enter"} onBlur={(e) => void saveProfit(s.sku, e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      className="w-24 rounded-md border border-line bg-surface px-2 py-1 text-sm" />
                    {saving === s.sku && <span className="ml-1 text-[10px] text-muted">saving…</span>}
                  </td>
                  <td><Pill tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Pill></td>
                  <td><Pill tone={VERDICT_TONE[s.verdict]}>{VERDICT_LABEL[s.verdict]}</Pill></td>
                  <td className="text-right">
                    <b>{compact(s.dailyNext * 30)}</b>
                    <span className={`block text-[11px] ${s.changePct > 0.005 ? "text-good" : s.changePct < -0.005 ? "text-crit" : "text-muted"}`}>{Math.abs(s.changePct) < 0.005 ? "no change" : `${s.changePct > 0 ? "▲ +" : "▼ −"}${Math.abs(Math.round(s.changePct * 100))}%`}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line text-sm font-semibold">
                <td className="py-2" colSpan={7}>Total monthly ad budget</td>
                <td className="text-right">{compact(plan.monthlyNow)} → {compact(plan.monthlyNext)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {err && <p role="alert" className="mt-2 text-sm text-crit">{err}</p>}
        {(plan.extraSalesHigh > 0) && (
          <p className="mt-3 rounded-lg bg-[#eef5fd] px-3 py-2 text-sm text-ink2">
            <b>What to expect (an estimate, not a promise):</b> the SKUs getting more budget could add roughly {compact(plan.extraSalesLow)} to {compact(plan.extraSalesHigh)} of ad sales a month. Returns usually shrink as spend rises, so we assume only 30–60% of today&rsquo;s return on the extra money.
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted">
          How advice is decided: a SKU can afford to spend up to its profit per unit ÷ its selling price on ads (its break-even ACOS). Well under that (below {Math.round(SCALE_BELOW * 100)}% of it) means spend more; over it means spend less. If shoppers click but few buy, the listing is fixed first. SKUs with under {MIN_CLICKS} clicks in {WINDOW_DAYS} days are not judged. A SKU rated under 3.5 stars is not advertised. Cuts and raises are capped per step, and money freed from cuts funds the raises.
        </p>
      </Card>

      {sel && <SkuDetail s={sel} model={model} />}
    </div>
  );
}

function SkuDetail({ s, model }: { s: SkuAds; model: AdsModel }) {
  const wk = fullWeeks(s.weeks, model.from, model.asOf);
  const rows = wk.map((w) => ({
    label: wkLabel(w.week), spend: w.spend, adSales: w.adSales, organic: w.organic,
    acos: w.acos == null ? null : Math.round(w.acos * 1000) / 10, breakEven: s.breakEvenAcos == null ? null : Math.round(s.breakEvenAcos * 1000) / 10,
  }));
  const facts: [string, string][] = [
    ["Clicks", num(s.recent.clicks)], ["Cost per click", s.cpc != null ? s.cpc.toFixed(2) : "–"], ["Click rate", s.ctr != null ? `${(s.ctr * 100).toFixed(2)}%` : "–"],
    ["Clicks that buy", s.cvr != null ? `${(s.cvr * 100).toFixed(1)}%` : "–"], ["Orders from ads", num(s.recent.orders)], ["TACoS", pct(s.tacos, 1)],
    ["Ads' share of this SKU's sales", pct(s.adShare)], ["Profit left after ads", s.netProfit != null ? `${s.netProfit < 0 ? "−" : ""}${compact(Math.abs(s.netProfit))}` : "–"],
  ];
  return (
    <div className="space-y-3">
      <Card title={`${s.sku}: why`} right={<Pill tone={VERDICT_TONE[s.verdict]}>{VERDICT_LABEL[s.verdict]}</Pill>}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink2">{s.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {s.rating && <Pill tone={s.rating.avg < 3.5 ? "bad" : s.rating.avg < 4 ? "warn" : "good"}>Rating {s.rating.avg.toFixed(1)} ({s.rating.n} recent reviews)</Pill>}
          {s.priceGap && <Pill tone={s.priceGap.pct >= 0.15 ? "warn" : "neutral"}>{s.priceGap.pct >= 0 ? `${Math.round(s.priceGap.pct * 100)}% above` : `${Math.round(-s.priceGap.pct * 100)}% below`} {s.priceGap.competitor}</Pill>}
          {s.profitSource === "assumed" && <Pill tone="warn">Margin assumed ({Math.round(ASSUMED_MARGIN * 100)}%)</Pill>}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          {facts.map(([k, val]) => <div key={k}><dt className="text-[11px] text-muted">{k}</dt><dd className="font-semibold tnum">{val}</dd></div>)}
        </dl>
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        <ChartCard title={`${s.sku}: weekly ad spend`} sub="Money spent on ads each week" focus={`weekly ad spend for ${s.sku}`}
          table={{ cols: ["Week of", "Ad spend", "Sales from ads", "Other sales"], rows: rows.map((r) => [r.label, num(r.spend), num(r.adSales), r.organic != null ? num(r.organic) : "n/a"]) }}>
          <BarsTrend data={rows} dataKey="spend" name="Ad spend" color={C.s2} yFmt={compact} valueFmt={num} height={200} />
        </ChartCard>
        <ChartCard title={`${s.sku}: ACOS against break-even`} sub={s.breakEvenAcos != null ? "Above the break-even line, each ad sale costs more than the product earns" : "Break-even needs a price"} focus={`ACOS versus break-even for ${s.sku}`}
          table={{ cols: ["Week of", "ACOS", "Break-even"], rows: rows.map((r) => [r.label, r.acos != null ? `${r.acos}%` : "n/a", r.breakEven != null ? `${r.breakEven}%` : "n/a"]) }}>
          <LineTrend data={rows} series={[{ key: "acos", name: "ACOS", color: C.s2 }, ...(s.breakEvenAcos != null ? [{ key: "breakEven", name: "Break-even", color: C.s3 }] : [])]} yFmt={(x) => `${x}%`} valueFmt={(_, x) => `${x}%`} height={200} />
        </ChartCard>
      </div>
    </div>
  );
}
