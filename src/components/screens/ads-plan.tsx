"use client";
import Link from "next/link";
import { useMemo } from "react";
import { Card, Pill } from "@/components/ui";
import { adsActions, computeAds, recentRatings } from "@/lib/insights/ads";
import { compact } from "@/lib/insights/aggregate";
import { useWorkspace } from "@/components/workspace/workspace";

const KIND_LABEL = { pause: "Pause", cut: "Spend less", fix: "Fix first", raise: "Spend more", check: "Check", setup: "Set up" } as const;
const KIND_TONE = { pause: "bad", cut: "warn", fix: "warn", raise: "good", check: "neutral", setup: "info" } as const;

/** Ad budget moves for the 30-day plan. Worked out by code from the ads report, so they are not part of the AI analysis. */
export function AdsPlanCard() {
  const { id, data } = useWorkspace();
  const model = useMemo(() => {
    if (!data?.ads) return null;
    return computeAds({ days: data.ads.days, names: data.ads.names, unitProfit: data.ads.unitProfit, tracked: data.tracker, ratings: recentRatings(data.insights.reviewRows, data.insights.months.length) });
  }, [data]);
  if (!model) return null;
  const actions = adsActions(model, compact);
  return (
    <Card title="Ad budget moves" right={<Link className="text-xs font-semibold text-brand-deep underline" href={`/projects/${id}/ads`}>Open Ads</Link>}>
      <p className="mb-2 text-xs text-muted">Worked out by code from your ads report, not by the AI: cuts first, then raises once the cuts have freed the money. Budget {compact(model.plan.monthlyNow)} → {compact(model.plan.monthlyNext)} a month.</p>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[1, 2, 3, 4].map((w) => (
          <div key={w} className="rounded-lg bg-[#f1f0ec] p-2" aria-label={`Ads, week ${w}`}>
            <p className="text-xs font-bold">Week {w}</p>
            {actions.filter((a) => a.week === w).map((a, i) => (
              <div key={i} className="mt-1.5 rounded-lg border border-line bg-surface p-2 text-xs">
                <Pill tone={KIND_TONE[a.kind]}>{KIND_LABEL[a.kind]}</Pill>
                <p className="mt-1 leading-snug">{a.text}</p>
              </div>
            ))}
            {actions.every((a) => a.week !== w) && <p className="mt-1 text-[11px] text-muted">Nothing scheduled.</p>}
          </div>
        ))}
      </div>
    </Card>
  );
}
