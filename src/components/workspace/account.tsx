"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "./workspace";

type P = { id: string; name: string };

/** The project card in the sidebar: switch projects, see all, or start a new one. */
export function ProjectSwitcher() {
  const { id, data } = useWorkspace();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<P[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/projects").then((r) => (r.ok ? r.json() : [])).then((d: P[]) => live && setList(d)).catch(() => live && setList([]));
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { live = false; document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Could not create the project");
    setOpen(false); setName("");
    router.push(`/projects/${j.id}/data`); // a new project starts on the Data page: upload first
  }

  return (
    <div className="relative mb-3" ref={box}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="true" className="flex w-full items-center justify-between gap-2 rounded-lg bg-side2 px-3 py-2 text-left hover:bg-[#262d39]">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-white">{data?.project.name ?? "Loading…"}</span>
          <span className="block text-[11px] text-side-ink">{data ? `${data.insights.counts.skus} products · ${data.insights.counts.reviews.toLocaleString("en-US")} reviews` : " "}</span>
        </span>
        <span aria-hidden="true" className="text-side-ink">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-line bg-surface p-2 text-sm text-ink shadow-lg" role="menu">
          <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-muted">Your projects</p>
          <ul className="max-h-56 overflow-y-auto">
            {list === null && <li className="px-2 py-1 text-muted">Loading…</li>}
            {list?.map((p) => (
              <li key={p.id}><Link href={`/projects/${p.id}`} onClick={() => setOpen(false)} className={`block truncate rounded px-2 py-1.5 hover:bg-[#f0efec] ${p.id === id ? "bg-[#eaf2fc] font-semibold text-brand-deep" : ""}`}>{p.name}</Link></li>
            ))}
          </ul>
          <Link href="/" onClick={() => setOpen(false)} className="mt-1 block rounded px-2 py-1.5 text-xs font-semibold text-brand-deep hover:bg-[#f0efec]">All projects</Link>
          <form onSubmit={create} className="mt-2 border-t border-line pt-2">
            <label htmlFor="new-project" className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted">New project</label>
            <div className="mt-1 flex gap-1.5 px-1">
              <input id="new-project" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Kitchen range" className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1.5 text-sm" />
              <button disabled={busy || !name.trim()} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-50">{busy ? "…" : "Add"}</button>
            </div>
            {err && <p role="alert" className="mt-1 px-2 text-xs text-crit">{err}</p>}
          </form>
        </div>
      )}
    </div>
  );
}


/** Who is signed in, with a sign-out button. */
export function AccountBlock({ dark = false }: { dark?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }
  useEffect(() => {
    let live = true;
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((j) => live && setEmail(j?.email ?? null)).catch(() => undefined);
    return () => { live = false; };
  }, []);
  if (!email) return null;
  return (
    <div className={`flex items-center justify-between gap-2 text-[11px] ${dark ? "text-side-ink" : "text-ink2"}`}>
      <span className="min-w-0 truncate" title={email}>{email}</span>
      <span className="flex shrink-0 items-center gap-1">
        <Link href="/account" className={`rounded px-2 py-0.5 font-semibold ${dark ? "text-side-ink hover:bg-side2 hover:text-white" : "text-brand-deep hover:bg-[#eaf2fc]"}`}>Password</Link>
        <button type="button" onClick={() => void signOut()} className={`rounded px-2 py-0.5 font-semibold ${dark ? "text-white hover:bg-side2" : "text-brand-deep hover:bg-[#eaf2fc]"}`}>Sign out</button>
      </span>
    </div>
  );
}
