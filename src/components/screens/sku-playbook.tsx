"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Card, Pill, type Tone } from "@/components/ui";
import { computeAds, recentRatings } from "@/lib/insights/ads";
import { compact } from "@/lib/insights/aggregate";
import { skuPlaybook, type Area, type Severity } from "@/lib/insights/playbook";
import { useWorkspace } from "@/components/workspace/workspace";

const AREA_LABEL: Record<Area, string> = { price: "Price", reviews: "Reviews", ads: "Ads", sales: "Sales" };
const AREA_TONE: Record<Area, Tone> = { price: "info", reviews: "warn", ads: "neutral", sales: "bad" };
const SEV_TONE: Record<Severity, Tone> = { high: "bad", medium: "warn", low: "neutral" };

/** What to do about each product, by cause: price, reviews, ads, sales. Written by code from the seller's own data, not by the AI. */
export function SkuPlaybook() {
  const { id, data } = useWorkspace();
  const [area, setArea] = useState<Area | "all">("all");
  const [all, setAll] = useState(false);
  const plays = useMemo(() => {
    if (!data || data.insights.counts.sales === 0) return [];
    const ads = data.ads ? computeAds({ days: data.ads.days, names: data.ads.names, unitProfit: data.ads.unitProfit, tracked: data.tracker, ratings: recentRatings(data.insights.reviewRows, data.insights.months.length) }) : null;
    return skuPlaybook({ ins: data.insights, tracked: data.tracker, ads, money: compact });
  }, [data]);
  if (plays.length === 0) return null;

  const shown = plays.filter((p) => area === "all" || p.steps.some((s) => s.area === area) || p.issues.some((i) => i.area === area));
  const list = all ? shown : shown.slice(0, 6);
  const areas = (["price", "reviews", "ads", "sales"] as Area[]).filter((a) => plays.some((p) => p.steps.some((s) => s.area === a)));

  return (
    <Card title="What to do for each product" right={<span className="text-xs text-muted">{plays.length} product{plays.length === 1 ? "" : "s"} with something to act on</span>}>
      <p className="mb-2 text-xs text-muted">
        Worked out by code from your sales, reviews, ads and competitor data, not by the AI. Biggest problems on the biggest products come first. Price ideas are small tests to run for two weeks, not certainties.
        {!data?.ads && <> Add an <Link className="underline" href={`/projects/${id}/data`}>ads report</Link> to get ad advice here too.</>}
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filter by cause">
        {(["all", ...areas] as (Area | "all")[]).map((a) => (
          <button key={a} type="button" onClick={() => setArea(a)} aria-pressed={area === a}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${area === a ? "border-brand bg-brand font-semibold text-white" : "border-line bg-surface text-ink2 hover:bg-[#f0efec]"}`}>
            {a === "all" ? "Everything" : AREA_LABEL[a]}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {list.map((p, i) => (
          <details key={p.sku} open={i === 0 && area === "all"} className="rounded-lg border border-line bg-surface p-3">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
              <b>{p.sku}</b><span className="text-xs text-muted">{p.revenueShare}% of revenue</span>
              <span className="text-xs text-ink2">{p.headline}</span>
              <span className="ml-auto flex flex-wrap gap-1">{[...new Set(p.issues.filter((x) => x.severity !== "low").map((x) => x.area))].map((a) => <Pill key={a} tone={AREA_TONE[a]} icon={false}>{AREA_LABEL[a]}</Pill>)}</span>
            </summary>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold text-muted">What we see</p>
                <ul className="mt-1 space-y-1.5 text-sm text-ink2">
                  {p.issues.length === 0 && <li className="text-muted">Nothing wrong; the steps keep it that way.</li>}
                  {p.issues.map((x, k) => <li key={k} className="flex gap-2"><Pill tone={SEV_TONE[x.severity]}>{AREA_LABEL[x.area]}</Pill><span>{x.text}</span></li>)}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted">What to do</p>
                <ul className="mt-1 space-y-1.5 text-sm">
                  {p.steps.filter((s) => area === "all" || s.area === area).map((s, k) => (
                    <li key={k} className="flex gap-2"><span className="shrink-0 rounded bg-[#f1f0ec] px-1.5 py-0.5 text-[11px] font-bold">Wk {s.week}</span><span><b className="text-[11px] uppercase text-muted">{AREA_LABEL[s.area]}</b> {s.text}</span></li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        ))}
      </div>
      {shown.length > 6 && <button type="button" onClick={() => setAll(!all)} className="mt-2 text-xs font-semibold text-brand-deep underline">{all ? "Show fewer" : `Show all ${shown.length}`}</button>}
    </Card>
  );
}
