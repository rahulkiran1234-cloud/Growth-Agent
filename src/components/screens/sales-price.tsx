"use client";
import { useMemo, useState } from "react";
import { ChartCard, HBars, PriceUnits, C } from "@/components/charts/charts";
import { Ev } from "@/components/workspace/evidence-drawer";
import { Card, Note, PageTitle, Pill } from "@/components/ui";
import { allProductEvents, compact, monthLabel, num, priceEvents, readEvent, salesVerdict, signed } from "@/lib/insights/aggregate";
import type { PriceEvent } from "@/lib/insights/types";
import { NoData, useView } from "./common";

const TABS = ["Price vs sales", "Price events", "Competitor price", "Product mix"] as const;
type Tab = (typeof TABS)[number];

const TONE = { good: "good", warn: "warn", neutral: "neutral" } as const;

function EventCard({ e, scope }: { e: PriceEvent; scope: string }) {
  const read = readEvent(e);
  const lowData = e.monthsAfter < 3;
  return (
    <Card title={`Impact of the price change in ${monthLabel(e.month)}`} right={<Pill tone={TONE[read.tone]}>{salesVerdict(e).label}</Pill>}>
      <dl className="space-y-2 text-sm">
        {[
          { k: "Price", a: num(e.priceBefore), b: num(e.priceAfter), d: e.pricePct },
          { k: "Units / month", a: num(e.unitsBefore), b: num(e.unitsAfter), d: e.unitsPct },
          { k: "Revenue / month", a: compact(e.revenueBefore), b: compact(e.revenueAfter), d: e.revenuePct },
        ].map((r) => (
          <div key={r.k} className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5 last:border-0">
            <dt className="w-28 text-xs text-muted">{r.k}</dt>
            <dd className="flex-1 font-semibold tnum">{r.a} → {r.b}</dd>
            <dd className={`w-16 text-right text-xs font-bold tnum ${r.d == null ? "text-muted" : r.d < 0 ? "text-crit" : "text-good"}`}>{r.d == null ? "n/a" : `${signed(r.d)}%`}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-ink2">{read.text}</p>
      <p className="mt-1 text-[11px] text-muted">Averages over {e.monthsBefore} month{e.monthsBefore === 1 ? "" : "s"} before and {e.monthsAfter} after, for {scope}. This shows what moved together, not what caused it.</p>
      {e.elasticity != null ? (
        <p className="mt-2 rounded-lg bg-page p-2 text-xs"><b>Elasticity {e.elasticity}</b>: {e.elasticity < 0 ? `units moved the opposite way to price, the usual pattern: about ${Math.abs(e.elasticity)}% for every 1% of price.` : "units moved in the same direction as price. A price cut normally lifts units, so price is unlikely to be the main driver here."} <Pill tone={e.confidence === "medium" ? "info" : "warn"}>{e.confidence === "medium" ? "Medium confidence" : "Low confidence"}</Pill>{lowData && " Only a few months follow the change."}</p>
      ) : (
        <p className="mt-2 text-[11px] text-muted">No elasticity reading: it needs at least 2 months on each side of a 3%+ price move.</p>
      )}
    </Card>
  );
}

export default function SalesPrice() {
  const v = useView();
  const [tab, setTab] = useState<Tab>(() => { const t = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab"); return (TABS as readonly string[]).includes(t ?? "") ? (t as Tab) : "Price vs sales"; });
  const events = useMemo(() => (v ? priceEvents(v.pts) : []), [v]);
  const perProduct = useMemo(() => (v ? allProductEvents(v.ins, { ...v.filter, sku: null }) : []), [v]);
  if (!v) return null;
  if (!v.hasSales) return <><PageTitle title="Sales & Price" /><NoData /></>;

  const { pts, filter, ws } = v;
  const scope = filter.sku ?? "all products (portfolio average)";
  const chart = pts.map((p) => ({ label: monthLabel(p.month), month: p.month, price: p.price == null ? null : Math.round(p.price), units: p.units }));
  const lastEvent = events[events.length - 1] ?? null;
  const top5 = v.prods.slice(0, 6);

  return (
    <div className="space-y-4">
      <PageTitle title="Sales & Price" sub="How price changes relate to units sold and revenue" />
      <div role="tablist" aria-label="Sales and price views" className="flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={`rounded-lg border px-3 py-1.5 text-sm ${tab === t ? "border-brand bg-brand font-semibold text-white" : "border-line bg-surface text-ink2 hover:bg-[#f0efec]"}`}>{t}</button>
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-1 text-xs text-muted">View:
          <button type="button" onClick={() => ws.setFilter({ ...filter, sku: null })} aria-pressed={!filter.sku} className={`rounded-full border px-2 py-0.5 ${!filter.sku ? "border-brand bg-[#eaf2fc] font-semibold text-brand-deep" : "border-line"}`}>All</button>
          {top5.map((p) => <button key={p.sku} type="button" onClick={() => ws.setFilter({ ...filter, sku: p.sku })} aria-pressed={filter.sku === p.sku} className={`rounded-full border px-2 py-0.5 ${filter.sku === p.sku ? "border-brand bg-[#eaf2fc] font-semibold text-brand-deep" : "border-line"}`}>{p.sku}</button>)}
        </span>
      </div>

      {tab === "Price vs sales" && lastEvent && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-[#c9dcf5] bg-gradient-to-r from-[#eaf2fc] to-surface p-3 text-sm" aria-label="Price change summary">
          <span className="text-[10px] font-bold uppercase tracking-wide text-brand-deep">{filter.sku ?? "Portfolio"} · {monthLabel(lastEvent.month)}</span>
          <span>Price <b className="tnum">{num(lastEvent.priceBefore)} → {num(lastEvent.priceAfter)}</b> <span className={lastEvent.pricePct < 0 ? "text-crit" : "text-good"}>({signed(lastEvent.pricePct)}%)</span></span>
          <span>Units/month <b className="tnum">{num(lastEvent.unitsBefore)} → {num(lastEvent.unitsAfter)}</b> {lastEvent.unitsPct != null && <span className={lastEvent.unitsPct < 0 ? "text-crit" : "text-good"}>({signed(lastEvent.unitsPct)}%)</span>}</span>
          <Pill tone={salesVerdict(lastEvent).kind === "up" ? "good" : salesVerdict(lastEvent).kind === "unknown" ? "neutral" : "warn"}>{salesVerdict(lastEvent).label}</Pill>
        </div>
      )}

      {tab === "Price vs sales" && (
        <div className="grid gap-3 lg:grid-cols-3">
          <ChartCard className="lg:col-span-2" title={`Price and units sold · ${filter.sku ?? "all products"}`} sub="Two aligned panels on one time axis" focus={`price versus units sold for ${scope}`}
            table={{ cols: ["Month", "Avg price", "Units", "Revenue"], rows: pts.map((p) => [monthLabel(p.month), p.price ? num(p.price) : "n/a", num(p.units), num(p.revenue)]) }} height={320}>
            <PriceUnits data={chart} eventMonth={lastEvent?.month ?? null} />
            {!filter.sku && <p className="mt-2 text-[11px] text-muted">The portfolio average price also moves when the product mix changes. Pick a single product for a cleaner reading.</p>}
          </ChartCard>
          <div className="space-y-3">
            {lastEvent ? <EventCard e={lastEvent} scope={scope} /> : <Card title="No price change detected"><p className="text-sm text-ink2">The average price stayed within 3% from month to month for {scope}, so there is no price change to evaluate.</p></Card>}
            {events.length > 1 && <p className="text-xs text-muted">{events.length} price changes found. See the Price events tab.</p>}
          </div>
        </div>
      )}

      {tab === "Price events" && (
        <div className="space-y-3">
          <Card title="Price changes found" right={<span className="text-xs text-muted">Moves of 3% or more between months</span>}>
            {perProduct.length === 0 ? <p className="text-sm text-muted">No product changed price by 3% or more in this period.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm tnum">
                  <thead><tr className="border-b border-line text-xs text-muted"><th className="py-1.5">Product</th><th>When</th><th>Price</th><th>Units / month</th><th>Revenue / month</th><th>Reading</th></tr></thead>
                  <tbody>
                    {perProduct.slice(0, 15).map(({ sku, e }) => {
                      const read = readEvent(e);
                      return (
                        <tr key={sku + e.month} className="cursor-pointer border-b border-line/60 hover:bg-[#f0efec]" onClick={() => { ws.setFilter({ ...filter, sku }); setTab("Price vs sales"); }}>
                          <td className="py-1.5 font-semibold">{sku}</td><td>{monthLabel(e.month)}</td>
                          <td>{num(e.priceBefore)} → {num(e.priceAfter)} <b className={e.pricePct < 0 ? "text-crit" : "text-good"}>({signed(e.pricePct)}%)</b></td>
                          <td>{e.unitsPct == null ? "n/a" : <b className={e.unitsPct < 0 ? "text-crit" : "text-good"}>{signed(e.unitsPct)}%</b>}</td>
                          <td>{e.revenuePct == null ? "n/a" : <b className={e.revenuePct < 0 ? "text-crit" : "text-good"}>{signed(e.revenuePct)}%</b>}</td>
                          <td><Pill tone={TONE[read.tone]}>{salesVerdict(e).label}</Pill>{e.elasticity != null && <span className="ml-2 text-xs text-muted">elasticity {e.elasticity}</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-[11px] text-muted">Click a row to open it. Elasticity appears only with 2+ months on each side of the change.</p>
          </Card>
        </div>
      )}

      {tab === "Competitor price" && <CompetitorPrice />}

      {tab === "Product mix" && (
        <div className="grid gap-3 lg:grid-cols-3">
          <ChartCard className="lg:col-span-2" title="Revenue share by product" sub="Top 10 products for the selected period" focus="product mix and revenue concentration">
            <HBars items={v.prods.slice(0, 10).map((p, i) => ({ name: p.sku, value: p.share, color: i < 3 ? C.s2 : C.s1, hint: `${num(p.revenue)} revenue` }))} onPick={(sku) => ws.setFilter({ ...filter, sku })} active={filter.sku} />
          </ChartCard>
          <Card title="Concentration">
            <p className="text-3xl font-bold tnum">{(v.prods.slice(0, 3).reduce((s, p) => s + p.share, 0)).toFixed(1)}%</p>
            <p className="text-sm text-ink2">of revenue comes from the top 3 products.</p>
            <p className="mt-2 text-xs text-muted">Heavy dependence on a few products means one stock-out, quality problem or price war can move the whole business.</p>
          </Card>
          <Card className="lg:col-span-3" title="All products">
            <div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs tnum">
              <thead className="sticky top-0 bg-surface"><tr className="border-b border-line text-muted"><th className="py-1.5">Product</th><th>Revenue</th><th>Share</th><th>Units</th><th>Avg price</th><th>Return rate</th><th>Rating</th></tr></thead>
              <tbody>{v.prods.map((p) => (
                <tr key={p.sku} className="cursor-pointer border-b border-line/60 hover:bg-[#f0efec]" onClick={() => { ws.setFilter({ ...filter, sku: p.sku }); setTab("Price vs sales"); }}>
                  <td className="py-1 font-semibold">{p.sku}</td><td>{num(p.revenue)}</td><td>{p.share}%</td><td>{num(p.units)}</td><td>{p.price ? num(p.price) : "n/a"}</td><td>{p.returnRate ?? "n/a"}{p.returnRate != null && "%"}</td><td>{p.avgRating ?? "n/a"}</td>
                </tr>))}</tbody>
            </table></div>
          </Card>
        </div>
      )}
    </div>
  );
}

const numIn = (s: string | null) => { const m = s?.replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

function CompetitorPrice() {
  const v = useView();
  if (!v) return null;
  const rows = (v.data.report?.s3?.comparison ?? []).filter((r) => /price|cost|mrp/i.test(r.attribute));
  if (!v.data.report) return <Card title="Price position vs competitors"><p className="text-sm text-muted">Competitor prices come from the competitor documents you uploaded, read by the AI analysis. Run the analysis from the Overview to see them here.</p></Card>;
  if (rows.length === 0) return <Card title="Price position vs competitors"><p className="text-sm text-muted">The analysis did not find comparable competitor prices. Upload catalogues or price lists on the Data page.</p></Card>;
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const pts = [{ name: "You", value: numIn(r.seller_value), you: true }, ...r.competitors.map((c) => ({ name: c.name, value: numIn(c.value), you: false, src: c.source_id }))].filter((p): p is { name: string; value: number; you: boolean; src?: string | null } => p.value != null);
        const lo = Math.min(...pts.map((p) => p.value)), hi = Math.max(...pts.map((p) => p.value)), span = hi - lo || hi * 0.1 || 1;
        const pos = (x: number) => 6 + ((x - lo + span * 0.1) / (span * 1.2)) * 88;
        return (
          <Card key={r.attribute} title={r.attribute} right={<Pill tone={r.verdict === "seller_ahead" ? "good" : r.verdict === "seller_behind" ? "bad" : "neutral"}>{r.verdict === "seller_ahead" ? "You are ahead" : r.verdict === "seller_behind" ? "You are behind" : r.verdict === "parity" ? "On par" : "Unknown"}</Pill>}>
            {pts.length < 2 ? <p className="text-sm text-muted">Not enough numeric values to plot.</p> : (
              <div className="relative my-4 h-14">
                <div className="absolute left-0 right-0 top-6 h-1 rounded-full bg-[#ecebe6]" />
                {pts.map((p, i) => (
                  <div key={p.name} className="absolute -translate-x-1/2 text-center" style={{ left: `${pos(p.value)}%`, top: i % 2 ? 30 : 0 }}>
                    {!(i % 2) && <p className="text-[11px] font-semibold tnum">{p.name} {num(p.value)}</p>}
                    <span className="mx-auto block h-3.5 w-3.5 rounded-full border-2 border-surface shadow" style={{ background: p.you ? C.s1 : C.s2, marginTop: i % 2 ? 0 : 2 }} />
                    {!!(i % 2) && <p className="text-[11px] font-semibold tnum">{p.name} {num(p.value)}</p>}
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-ink2">{r.note} {r.competitors.map((c) => c.source_id && <Ev key={c.source_id} refId={c.source_id} />)}</p>
          </Card>
        );
      })}
      <Note tone="info">Competitor figures are read from the documents you uploaded and each one is checked against its source passage.</Note>
    </div>
  );
}

