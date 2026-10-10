"use client";
import { useMemo, useState } from "react";
import { LineTrend, C } from "@/components/charts/charts";
import { Card, Headline, Note, Pill } from "@/components/ui";
import { num, signed } from "@/lib/insights/aggregate";
import { describeProduct, shortDate, longDate, isRealPromo } from "@/lib/insights/tracker";
import { useWorkspace } from "@/components/workspace/workspace";

const COLORS = [C.s1, C.s2, C.s3, C.s4, C.s5];
const MAX_LINES = 5;

/** Competitor tracking: price trends, discounts, promotions, stock and review activity from daily or weekly snapshots. */
export function TrackerSection() {
  const { id, data, refresh } = useWorkspace();
  const tracked = useMemo(() => (data?.tracker ?? []).map(describeProduct), [data?.tracker]);
  const [picked, setPicked] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  if (!data || tracked.length === 0) return null;

  const key = (p: { competitor: string; product: string }) => `${p.competitor}|${p.product}`;
  const selected = (picked ?? tracked.slice(0, MAX_LINES).map(key)).slice(0, MAX_LINES);
  const lines = tracked.filter((p) => selected.includes(key(p)));
  const dates = [...new Set(lines.flatMap((p) => p.series.map((s) => s.date)))].sort();
  const rows = dates.map((d) => {
    const row: Record<string, string | number | null> = { label: shortDate(d) };
    lines.forEach((p, i) => { row[`p${i}`] = p.series.find((s) => s.date === d)?.price ?? null; });
    return row;
  });

  const sums = tracked.filter((p) => p.summary);
  const cuts = sums.filter((p) => (p.summary!.changePct ?? 0) < 0).length;
  const onDiscountNow = tracked.filter((p) => p.series[p.series.length - 1]?.discount).length;
  const from = sums.map((p) => p.summary!.firstDate).sort()[0], to = sums.map((p) => p.summary!.lastDate).sort().pop()!;
  const synthetic = [...new Set(tracked.map((p) => p.dataType).filter((t): t is string => !!t && /synthetic|sample|dummy|test|demo/i.test(t)))];
  const moves = tracked.flatMap((p) => p.moves.map((m) => ({ ...m, competitor: p.competitor, product: p.product }))).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

  const ins = data.insights;
  const yourPrice = (sku: string | null) => {
    if (!sku) return null;
    const s = ins.skus.find((x) => x.sku === sku);
    if (!s) return null;
    for (let i = s.units.length - 1; i >= 0; i--) if (s.units[i] > 0) return s.revenue[i] / s.units[i];
    return null;
  };

  async function link(p: { competitor: string; product: string }, sku: string) {
    setBusy(key(p)); setMsg("");
    const r = await fetch(`/api/projects/${id}/tracker/map`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ competitor: p.competitor, product: p.product, sku: sku || null }) });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    setMsg(r.ok ? (j.warning ?? "Saved. The next AI analysis will compare these two products.") : (j.error ?? "Could not save"));
    await refresh();
  }

  const toggle = (k: string) => setPicked((cur) => { const base = cur ?? selected; return base.includes(k) ? base.filter((x) => x !== k) : [...base, k].slice(-MAX_LINES); });

  return (
    <div className="space-y-4" id="tracker">
      <Headline label="Competitor tracker"
        title={`${cuts} of ${sums.length} tracked competitor products ${cuts === 1 ? "is" : "are"} cheaper now than at the start; ${onDiscountNow} ${onDiscountNow === 1 ? "is" : "are"} on discount in the latest snapshot.`}
        sub={`${tracked.length} products from ${new Set(tracked.map((p) => p.competitor)).size} competitors · ${longDate(from)} to ${longDate(to)}`}
        right={synthetic.length ? <Pill tone="warn">Data labelled &ldquo;{synthetic[0]}&rdquo;</Pill> : <Pill tone="info">From your uploaded tracker</Pill>} />

      <Card title="Competitor prices over time" right={<span className="text-xs text-muted">Pick up to {MAX_LINES} products</span>}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tracked.map((p) => {
            const on = selected.includes(key(p)), i = lines.findIndex((l) => key(l) === key(p));
            return (
              <button key={key(p)} type="button" onClick={() => toggle(key(p))} aria-pressed={on} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? "border-brand bg-[#eaf2fc] font-semibold text-brand-deep" : "border-line text-ink2 hover:bg-[#f0efec]"}`}>
                {on && i >= 0 && <i className="inline-block h-2 w-2 rounded-full" style={{ background: COLORS[i] }} />}{p.competitor} · {p.product}
              </button>
            );
          })}
        </div>
        {lines.length === 0 ? <p className="py-8 text-center text-sm text-muted">Pick a product to see its price history.</p> : (
          <LineTrend data={rows} series={lines.map((p, i) => ({ key: `p${i}`, name: `${p.competitor} · ${p.product}`, color: COLORS[i] }))} yFmt={(v) => num(v)} valueFmt={(_, v) => num(v)} height={250} />
        )}
        <p className="mt-1 text-[11px] text-muted">Listed price on each snapshot date. Prices include any discount shown that day.</p>
      </Card>

      <Card title="Latest snapshot of every tracked product" right={<span className="text-xs text-muted">Change is from the first to the last snapshot</span>}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm tnum">
            <thead><tr className="border-b border-line text-xs text-muted"><th className="py-1.5">Product</th><th>Price now</th><th>Discount days</th><th>Promotion</th><th>Stock</th><th>Rating</th><th>New reviews</th><th>Compares with your product</th></tr></thead>
            <tbody>
              {tracked.map((p) => {
                const s = p.summary!, last = p.series[p.series.length - 1];
                const mine = yourPrice(p.comparableSku);
                const promo = isRealPromo(last.promo) ? last.promo : s.promos[0]?.name ?? null;
                return (
                  <tr key={key(p)} className="border-b border-line/60 align-top">
                    <td className="py-1.5 font-semibold">{p.product}<span className="block text-[11px] font-normal text-muted">{p.competitor}{p.category ? ` · ${p.category}` : ""}</span></td>
                    <td>{num(s.lastPrice)} {s.changePct != null && Math.abs(s.changePct) >= 0.05 && <b className={s.changePct < 0 ? "text-crit" : "text-good"}>({signed(s.changePct)}%)</b>}<span className="block text-[11px] text-muted">range {num(s.minPrice)}–{num(s.maxPrice)}</span></td>
                    <td>{s.hasDiscountData ? `${s.discountPct}%` : <span className="text-muted">n/a</span>}<span className="block text-[11px] text-muted">{s.hasDiscountData ? `${s.discountSnapshots} of ${p.series.length}` : ""}</span></td>
                    <td className="text-xs">{promo ?? <span className="text-muted">none</span>}</td>
                    <td className="text-xs">{s.latestStock ?? <span className="text-muted">n/a</span>}{s.stockLowPct != null && s.stockLowPct > 0 && <span className="block text-[11px] text-muted">low {s.stockLowPct}% of days</span>}</td>
                    <td>{s.lastRating != null ? s.lastRating.toFixed(1) : <span className="text-muted">n/a</span>}{s.firstRating != null && s.lastRating != null && s.firstRating !== s.lastRating && <span className={`ml-1 text-xs font-bold ${s.lastRating > s.firstRating ? "text-good" : "text-crit"}`}>{signed(Math.round((s.lastRating - s.firstRating) * 100) / 100, 2)}</span>}</td>
                    <td>{s.newReviews ?? <span className="text-muted">n/a</span>}{s.newReviews != null && s.snapshots > 1 && <span className="block text-[11px] text-muted">over {s.snapshots} snapshots</span>}</td>
                    <td>
                      <select aria-label={`Your product that competes with ${p.product}`} value={p.comparableSku ?? ""} disabled={busy === key(p)} onChange={(e) => void link(p, e.target.value)} className="max-w-[9rem] rounded-lg border border-line bg-surface px-2 py-1 text-xs">
                        <option value="">Not linked</option>
                        {ins.skus.map((x) => <option key={x.sku} value={x.sku}>{x.sku}</option>)}
                      </select>
                      {mine != null && <span className="block text-[11px] text-muted">your price {num(mine)}; they are {Math.abs(Math.round(((s.lastPrice - mine) / mine) * 1000) / 10)}% {s.lastPrice >= mine ? "above" : "below"} you</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {msg && <p className="mt-2 text-xs text-ink2" role="status">{msg}</p>}
        <p className="mt-2 text-[11px] text-muted">Link a competitor product to one of yours and the next AI analysis compares their price with yours.</p>
      </Card>

      <Card title="Recent competitor price moves">
        {moves.length === 0 ? <p className="text-sm text-muted">No competitor changed a listed price by 1% or more between snapshots.</p> : (
          <ul className="divide-y divide-line text-sm">
            {moves.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5 tnum">
                <span><b>{m.competitor}</b> · {m.product}</span>
                <span className="text-ink2">{longDate(m.date)}: {num(m.from)} → {num(m.to)} <b className={m.pct < 0 ? "text-crit" : "text-good"}>({signed(m.pct)}%)</b></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {synthetic.length > 0 && <Note>The file&apos;s data_type column says &ldquo;{synthetic[0]}&rdquo;. The analysis treats these numbers as real, so use synthetic data for demos only.</Note>}
    </div>
  );
}
