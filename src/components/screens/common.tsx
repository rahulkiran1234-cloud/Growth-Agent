"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Empty, Note } from "@/components/ui";
import { monthly, products, topics } from "@/lib/insights/aggregate";
import { useWorkspace } from "@/components/workspace/workspace";

/** Derived views for the current filter, computed once per render. */
export function useView() {
  const ws = useWorkspace();
  const { data, filter } = ws;
  return useMemo(() => {
    if (!data) return null;
    const ins = data.insights;
    return {
      ws, data, ins, filter,
      pts: monthly(ins, filter),
      prods: products(ins, { ...filter, sku: null }),
      tops: topics(ins, filter),
      hasSales: ins.counts.sales > 0,
      hasReviews: ins.counts.reviews > 0,
    };
  }, [ws, data, filter]);
}

export const TOPIC_LABEL: Record<string, string> = {
  sizing_fit: "Sizing / fit", quality: "Quality", packaging_damage: "Packaging damage", delivery: "Delivery",
  price_value: "Price / value", customer_support: "Customer support", other: "Other",
};
export const topicLabel = (t: string) => TOPIC_LABEL[t] ?? t.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

export function RunAnalysis({ label = "Run AI analysis", variant = "primary" }: { label?: string; variant?: "primary" | "ghost" }) {
  const { id, data } = useWorkspace();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function run() {
    setBusy(true); setErr("");
    const r = await fetch("/api/analyses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: id }) });
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? "Could not start the analysis"); setBusy(false); return; }
    router.push(`/analysis/${j.id}`);
  }
  const blocked = !data?.readiness.ready;
  return (
    <div>
      <Button onClick={run} disabled={busy || blocked || !!data?.runningAnalysisId} variant={variant}>{busy ? "Starting…" : label}</Button>
      {blocked && data && <p className="mt-1 text-xs text-warnink">{data.readiness.problems.join(" ")}</p>}
      {err && <p className="mt-1 text-xs text-crit" role="alert">{err}</p>}
    </div>
  );
}

/** Shown on analysis-dependent panels until an analysis has finished. */
export function NeedsAnalysis({ what }: { what: string }) {
  const { data } = useWorkspace();
  if (data?.runningAnalysisId) {
    return <Empty title="Analysis in progress">The AI is working on {what}. This page updates by itself. <Link className="underline" href={`/analysis/${data.runningAnalysisId}`}>Watch progress</Link></Empty>;
  }
  return <Empty title="Run the AI analysis to unlock this" action={<RunAnalysis />}>The charts on this page come straight from your data. {what} needs the AI analysis (about 4 minutes).</Empty>;
}

export function NoData({ children }: { children?: ReactNode }) {
  const { id } = useWorkspace();
  return (
    <Empty title="Add your data to see this screen" action={<Button href={`/projects/${id}/data`}>Upload data</Button>}>
      {children ?? "Upload a sales file (CSV or Excel, any column names) and the charts appear within seconds."}
    </Empty>
  );
}

/** The AI findings are older than your latest upload. */
export function Stale() {
  const { data } = useWorkspace();
  const done = data?.report?.analysis.finishedAt;
  if (!done || !data?.lastUploadAt || data.lastUploadAt <= done) return null;
  return <Note>You uploaded new data after the last AI analysis. The charts are current; the AI findings may be out of date. Run the analysis again to refresh them.</Note>;
}
