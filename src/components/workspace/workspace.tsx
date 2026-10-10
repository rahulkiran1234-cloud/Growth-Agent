"use client";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Insights } from "@/lib/insights/types";
import { defaultFilter, type Filter } from "@/lib/insights/aggregate";
import type { Report } from "@/lib/report/build";
import type { TrackedProduct } from "@/lib/insights/tracker";
import type { AdDay } from "@/lib/insights/ads";

export type Payload = {
  project: { id: string; name: string; goal: string };
  insights: Insights;
  report: Report | null;
  tracker: TrackedProduct[];
  ads: { days: AdDay[]; names: Record<string, string>; campaigns: number; unitProfit: Record<string, number> } | null;
  readiness: { ready: boolean; problems: string[]; counts: { sales: number; reviews: number; chunks: number; competitors: number; salesDays: number } };
  runningAnalysisId: string | null;
  analysisCount: number;
  lastUploadAt: string | null;
};

type Ctx = {
  id: string;
  data: Payload | null;
  error: string;
  refresh: () => Promise<void>;
  filter: Filter;
  setFilter: (f: Filter) => void;
  /** Chat dock + evidence drawer controls shared by every screen. */
  chat: { open: boolean; setOpen: (v: boolean) => void; focus: string | null; pending: string | null; ask: (question: string, focus: string) => void; clearPending: () => void };
  evidence: { ref: string | null; show: (ref: string) => void; close: () => void };
};

const WorkspaceCtx = createContext<Ctx | null>(null);

export function useWorkspace(): Ctx {
  const c = useContext(WorkspaceCtx);
  if (!c) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return c;
}

async function fetchInsights(id: string) {
  try {
    const r = await fetch(`/api/projects/${id}/insights`);
    return { status: r.status, ok: r.ok, j: await r.json() };
  } catch {
    return null;
  }
}

export function WorkspaceProvider({ id, children }: { id: string; children: ReactNode }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [filterState, setFilterState] = useState<Filter | null>(null);
  // Deep link: ?sku=SKU-01 opens the workspace on one product.
  const [urlSku] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("sku")));
  const [chatOpen, setChatOpen] = useState(false);
  const [chatFocus, setChatFocus] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [evRef, setEvRef] = useState<string | null>(null);
  const live = useRef(true);

  const apply = useCallback((res: { status: number; ok: boolean; j: Payload & { error?: string } } | null) => {
    if (!live.current) return;
    if (res?.status === 401) { router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`); return; }
    if (!res) return setError("We couldn't reach the server. Check that it is running, then refresh.");
    if (!res.ok) return setError(res.status === 404 ? "This project doesn't exist (it may have been deleted)." : res.j.error ?? "Could not load the project.");
    setError("");
    setData(res.j);
  }, [router]);

  const refresh = useCallback(async () => apply(await fetchInsights(id)), [id, apply]);

  useEffect(() => {
    live.current = true;
    void fetchInsights(id).then(apply);
    return () => { live.current = false; };
  }, [id, apply]);

  // While an analysis runs, keep the workspace fresh so results appear as soon as it finishes.
  const running = data?.runningAnalysisId ?? null;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void refresh(), 6000);
    return () => clearInterval(t);
  }, [running, refresh]);

  // A new upload can change the number of months: reset the filter if it no longer fits.
  const months = data?.insights.months.length ?? 0;
  const filter = useMemo<Filter>(() => {
    if (!data) return { from: 0, to: 0, sku: null };
    const base = filterState ?? { ...defaultFilter(data.insights), sku: urlSku };
    const last = Math.max(0, months - 1);
    return { from: Math.min(base.from, last), to: Math.min(base.to, last), sku: base.sku && data.insights.skus.some((s) => s.sku === base.sku) ? base.sku : null };
  }, [data, filterState, months, urlSku]);

  const value = useMemo<Ctx>(() => ({
    id, data, error, refresh, filter, setFilter: setFilterState,
    chat: {
      open: chatOpen, setOpen: setChatOpen, focus: chatFocus, pending,
      ask: (q, focus) => { setChatFocus(focus); setPending(q); setChatOpen(true); },
      clearPending: () => setPending(null),
    },
    evidence: { ref: evRef, show: setEvRef, close: () => setEvRef(null) },
  }), [id, data, error, refresh, filter, chatOpen, chatFocus, pending, evRef]);

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}
