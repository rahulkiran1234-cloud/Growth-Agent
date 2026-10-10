"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { APP_NAME, LogoMark } from "@/components/brand";
import { monthLabel } from "@/lib/insights/aggregate";
import { Pill } from "@/components/ui";
import { AccountBlock, ProjectSwitcher } from "./account";
import { ChatDock } from "./chat-dock";
import { EvidenceDrawer } from "./evidence-drawer";
import { useWorkspace } from "./workspace";

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export const NAV = [
  { href: "", label: "Overview", icon: "M3 12l9-8 9 8M5 10v10h14V10" },
  { href: "/sales-price", label: "Sales & Price", icon: "M3 17l6-6 4 4 8-9M15 6h6v6" },
  { href: "/customers", label: "Customers", icon: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0" },
  { href: "/reviews", label: "Reviews", icon: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z" },
  { href: "/competitors", label: "Competitors", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
  { href: "/ads", label: "Ads", icon: "M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1zM15 9a4 4 0 010 6M18 6.5a8 8 0 010 11" },
  { href: "/plan", label: "Action Plan", icon: "M9 11l3 3 7-7M5 5h8M5 19h14" },
  { href: "/data", label: "Data", icon: "M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" },
] as const;

function FilterBar() {
  const { data, filter, setFilter } = useWorkspace();
  if (!data || data.insights.months.length === 0) return null;
  const { months, skus } = data.insights;
  const sel = "rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink2";
  return (
    <div className="flex flex-wrap items-center gap-2 no-print" role="group" aria-label="Filters">
      <label className="flex items-center gap-1 text-xs text-muted">From
        <select className={sel} value={filter.from} onChange={(e) => setFilter({ ...filter, from: Number(e.target.value), to: Math.max(filter.to, Number(e.target.value)) })}>
          {months.map((m, i) => <option key={m} value={i}>{monthLabel(m)}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-muted">To
        <select className={sel} value={filter.to} onChange={(e) => setFilter({ ...filter, to: Number(e.target.value), from: Math.min(filter.from, Number(e.target.value)) })}>
          {months.map((m, i) => <option key={m} value={i} disabled={i < filter.from}>{monthLabel(m)}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-muted">Product
        <select className={sel} value={filter.sku ?? ""} onChange={(e) => setFilter({ ...filter, sku: e.target.value || null })} aria-label="Product filter">
          <option value="">All products</option>
          {skus.map((s) => <option key={s.sku} value={s.sku}>{s.sku}</option>)}
        </select>
      </label>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { id, data, error, chat } = useWorkspace();
  const path = usePathname();
  const base = `/projects/${id}`;
  const active = (href: string) => (href === "" ? path === base : path.startsWith(base + href));
  const report = data?.report;

  return (
    <div className="flex min-h-screen bg-page">
      {/* Sidebar (desktop) */}
      <aside className="no-print sticky top-0 hidden h-screen w-56 shrink-0 flex-col bg-side p-3 text-side-ink md:flex" aria-label="Main navigation">
        <Link href="/" className="mb-4 flex items-center gap-2 px-1 text-sm font-bold text-white"><LogoMark /> {APP_NAME}</Link>
        <ProjectSwitcher />
        <nav className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <Link key={n.label} href={base + n.href} aria-current={active(n.href) ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm ${active(n.href) ? "bg-brand font-semibold text-white" : "hover:bg-side2 hover:text-white"}`}>
              <Icon d={n.icon} />{n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-1 px-1 text-[11px]">
          {data?.runningAnalysisId ? <Pill tone="info">Analysis running…</Pill> : report ? <Pill tone="good">Analysis done</Pill> : <Pill tone="neutral">No analysis yet</Pill>}
          {data?.insights.dataThrough.sales && <p>Data through {data.insights.dataThrough.sales}</p>}
          <div className="border-t border-side2 pt-2"><AccountBlock dark /></div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b border-line bg-page/95 px-4 py-2 backdrop-blur md:px-6">
          <div className="flex items-center gap-2 md:hidden"><LogoMark size={20} /><span className="truncate text-sm font-bold">{data?.project.name ?? APP_NAME}</span><Link href="/" className="shrink-0 text-xs font-semibold text-brand-deep underline">All projects</Link></div>
          <FilterBar />
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => chat.setOpen(!chat.open)} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-semibold hover:bg-[#f0efec]" aria-expanded={chat.open}>
              Ask the analyst
            </button>
            {report && <a href={`/api/analyses/${report.analysis.id}/report.pdf`} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-deep">Export PDF</a>}
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 pb-24 pt-4 md:px-6 md:pb-10">
          {error ? <p role="alert" className="rounded-lg border border-[#f0b9b9] bg-[#fdeaea] p-4 text-sm text-crit">{error}</p> : !data ? <p className="p-6 text-sm text-muted">Loading your workspace…</p> : children}
        </main>
      </div>

      {/* Bottom tabs (phone) */}
      <nav className="no-print fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line bg-surface py-1.5 md:hidden" aria-label="Main navigation">
        {NAV.map((n) => (
          <Link key={n.label} href={base + n.href} aria-current={active(n.href) ? "page" : undefined}
            className={`flex flex-col items-center gap-0.5 px-2 text-[10px] ${active(n.href) ? "font-semibold text-brand" : "text-muted"}`}>
            <Icon d={n.icon} />{n.label.split(" ")[0]}
          </Link>
        ))}
      </nav>

      <ChatDock />
      <EvidenceDrawer />
    </div>
  );
}
