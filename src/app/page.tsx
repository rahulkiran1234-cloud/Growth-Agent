"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { APP_NAME, APP_TAGLINE, LogoMark } from "@/components/brand";
import { AccountBlock } from "@/components/workspace/account";

type P = { id: string; name: string; sales: number; reviews: number; chunks: number };

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<P[] | null>(null);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    let live = true;
    fetch("/api/projects")
      .then((r) => {
        if (r.status === 401) { router.replace("/login"); return new Promise<never>(() => undefined); }
        return r.ok ? r.json() : Promise.reject(new Error("load failed"));
      })
      .then((d) => live && setProjects(d))
      .catch(() => live && setLoadErr("We couldn't load your projects. Check that the server is running, then refresh."));
    return () => {
      live = false;
    };
  }, [router]);

  const [sampling, setSampling] = useState(false);
  async function trySample() {
    setSampling(true);
    setErr("");
    const r = await fetch("/api/projects/sample", { method: "POST" });
    const j = await r.json();
    if (!r.ok) {
      setSampling(false);
      return setErr(j.error ?? "Could not create the sample");
    }
    router.push(`/projects/${j.id}`);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const r = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const j = await r.json();
    if (!r.ok) return setErr(j.error ?? "Could not create the project");
    router.push(`/projects/${j.id}`);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-4 flex justify-end"><div className="w-full max-w-xs"><AccountBlock /></div></div>
      <div className="flex items-center gap-3"><LogoMark size={34} /><div><h1 className="text-2xl font-bold">{APP_NAME}</h1><p className="text-sm text-ink2">{APP_TAGLINE}: upload your sales, reviews and competitor files and see what is holding your business back.</p></div></div>

      <div className="mt-6 rounded-xl border border-[#c9dcf5] bg-gradient-to-r from-[#eaf2fc] to-surface p-5">
        <p className="font-semibold">New here? Explore a sample seller.</p>
        <p className="mt-0.5 text-sm text-ink2">Loads six months of orders, 2,500 reviews and two competitor documents. Charts appear instantly; the AI analysis takes about 4 minutes.</p>
        <button onClick={trySample} disabled={sampling} className="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-50">
          {sampling ? "Setting up…" : "Use sample data"}
        </button>
      </div>

      <form onSubmit={create} className="mt-5 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name (e.g. My shop)" aria-label="New project name" className="flex-1 rounded-lg border border-line bg-surface px-3 py-2" />
        <button className="rounded-lg border border-line bg-surface px-4 py-2 font-semibold hover:bg-[#f0efec]">Create</button>
      </form>
      {err && <p className="mt-2 text-crit" role="alert">{err}</p>}

      <h2 className="mt-8 font-semibold">Projects</h2>
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {loadErr && <li className="p-3 text-crit">{loadErr}</li>}
        {projects === null && !loadErr && <li className="p-3 text-muted">Loading…</li>}
        {projects?.length === 0 && <li className="p-3 text-muted">No projects yet.</li>}
        {projects?.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-[#f0efec]">
              <span className="font-semibold">{p.name}</span>
              <span className="text-sm text-muted">
                {p.sales} sales · {p.reviews} reviews · {p.chunks} doc chunks
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
