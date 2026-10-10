import { adsActions, type AdsModel, STATUS_LABEL, VERDICT_LABEL, ASSUMED_MARGIN } from "@/lib/insights/ads";
import { fmtNum } from "@/lib/report/format";

const pct = (v: number | null) => (v == null ? "–" : `${Math.round(v * 100)}%`);

/** Ad spend advice for the printable report. Written by code from the seller's ads report (no AI, so no AI checks apply). */
export default function AdsSection({ m, n }: { m: AdsModel; n: number }) {
  const actions = adsActions(m, fmtNum);
  const weeks = [1, 2, 3, 4].map((w) => ({ w, items: actions.filter((a) => a.week === w) })).filter((x) => x.items.length > 0);
  const losing = m.skus.filter((s) => s.wasted > 0 && s.verdict !== "too_little").length;
  return (
    <section className="mt-8" id="ads">
      <h2 className="border-b pb-1 text-lg font-semibold">{n}. Ad spend: where to spend more and less</h2>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-xs text-neutral-600">Worked out by code from your ads report (last {m.windowDays} days, to {m.asOf}), using today&apos;s data rather than the data at the time of the analysis. It is not written by the AI.</p>
        <p>
          Ads spent <b>{fmtNum(m.totals.spend)}</b> and brought back <b>{fmtNum(m.totals.adSales)}</b> in sales (ACOS <b>{pct(m.totals.acos)}</b>{m.totals.tacos != null ? <>, TACoS <b>{pct(m.totals.tacos)}</b></> : null}).{" "}
          {losing > 0 ? <>{fmtNum(m.totals.wasted)} went to {losing} SKU{losing === 1 ? "" : "s"} where ads cost more than the product earns. </> : "Every SKU with enough data is paying for itself. "}
          Suggested monthly ad budget: <b>{fmtNum(m.plan.monthlyNow)}</b> → <b>{fmtNum(m.plan.monthlyNext)}</b>.
          {m.plan.extraSalesHigh > 0 && <> The SKUs getting more could add roughly {fmtNum(m.plan.extraSalesLow)} to {fmtNum(m.plan.extraSalesHigh)} of ad sales a month (an estimate that assumes extra spend returns only 30–60% of today&apos;s return).</>}
        </p>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs">
          <thead><tr className="border-b text-neutral-500"><th className="py-1">SKU</th><th>Spend</th><th>Ad sales</th><th>ACOS</th><th>Break-even</th><th>Spending</th><th>Advice</th><th className="text-right">Budget / month</th></tr></thead>
          <tbody>
            {m.skus.map((s) => (
              <tr key={s.sku} className="break-inside-avoid border-b align-top">
                <td className="py-1 pr-2 font-medium">{s.sku}</td><td>{fmtNum(s.recent.spend)}</td><td>{fmtNum(s.recent.adSales)}</td><td>{pct(s.acos)}</td>
                <td>{pct(s.breakEvenAcos)}{s.profitSource === "assumed" ? " (assumed)" : ""}</td><td>{STATUS_LABEL[s.status]}</td><td>{VERDICT_LABEL[s.verdict]}</td>
                <td className="text-right">{fmtNum(s.dailyNow * 30)} → {fmtNum(s.dailyNext * 30)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <div className="space-y-2">
          <h3 className="font-semibold">Why, SKU by SKU</h3>
          <ul className="space-y-1.5 text-xs">
            {m.skus.filter((s) => s.verdict !== "hold" || s.reasons.length).map((s) => (
              <li key={s.sku} className="break-inside-avoid rounded border-l-4 border-neutral-300 pl-2"><b>{s.sku}: {VERDICT_LABEL[s.verdict]}.</b> {s.reasons.join(" ")}</li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold">Ad actions in the 30-day plan</h3>
          {weeks.map(({ w, items }) => (
            <div key={w} className="break-inside-avoid">
              <p className="text-xs font-semibold">Week {w}</p>
              <ul className="list-disc pl-5 text-xs">{items.map((a, i) => <li key={i}>{a.text}</li>)}</ul>
            </div>
          ))}
        </div>
        {m.missingProfit.length > 0 && <p className="text-xs text-amber-800">Break-even for {m.missingProfit.length} SKU{m.missingProfit.length === 1 ? "" : "s"} assumes a {Math.round(ASSUMED_MARGIN * 100)}% margin because no profit per unit was entered. Enter it on the Ads screen for firmer advice.</p>}
        {m.warnings.map((w, i) => <p key={i} className="text-xs text-amber-800">{w}</p>)}
      </div>
    </section>
  );
}
