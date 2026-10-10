"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/components/workspace/workspace";
import { BarsTrend, HBars, C } from "@/components/charts/charts";
import ProgressCheck from "@/app/analysis/[id]/report/progress-check";
import { Card, Pill, PageTitle } from "@/components/ui";
import { compact, monthLabel, monthly, products, defaultFilter } from "@/lib/insights/aggregate";

type Upload = { id: string; kind: string; status: string; filename: string; stats: Record<string, unknown> | null; error: string | null };
type Data = {
  project: { id: string; name: string };
  analyses: { id: string; status: string; startedAt: string; costUsd: string | null }[];
  usage: { used: number; limit: number; spentUsd: number };
  uploads: Upload[];
  competitors: { name: string; documents: number; chunks: number }[];
  readiness: { ready: boolean; problems: string[]; counts: { sales: number; reviews: number; chunks: number; competitors: number; salesDays: number } };
};
type MapResp = {
  upload: { id: string; kind: string };
  headers: string[];
  preview: string[][];
  totalRows: number;
  suggestedMapping: Record<string, string | null>;
  fields: { field: string; label: string; required: boolean }[];
  aiFields: string[];
  notes: string[];
};

const badge: Record<string, string> = {
  ready: "bg-green-100 text-green-800",
  processing: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
  uploaded: "bg-neutral-100 text-neutral-700",
};

export default function ProjectView({ id }: { id: string }) {
  const router = useRouter();
  const ws = useWorkspace();
  const [data, setData] = useState<Data | null>(null);
  const [running, setRunning] = useState(false);
  const [runErr, setRunErr] = useState("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/projects/${id}`);
    if (r.ok) setData(await r.json());
  }, [id]);

  const reload = useCallback(async () => {
    await load();
    await ws.refresh();
  }, [load, ws]);

  const [loadErr, setLoadErr] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${id}`)
      .then(async (r) => {
        const d = await r.json();
        if (!live) return;
        if (!r.ok) setLoadErr(r.status === 404 ? "This project doesn't exist (it may have been deleted)." : d.error ?? "Could not load the project.");
        else setData(d);
      })
      .catch(() => live && setLoadErr("We couldn't reach the server. Check that it is running, then refresh."));
    return () => {
      live = false;
    };
  }, [id]);

  async function deleteAll() {
    if (!window.confirm("Permanently delete this project and ALL its data (uploads, analyses, reports)? This cannot be undone.")) return;
    setDeleting(true);
    setDelErr("");
    const r = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!r.ok) {
      setDeleting(false);
      return setDelErr((await r.json()).error ?? "Could not delete");
    }
    router.push("/");
  }
  const processing = data?.uploads.some((u) => u.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [processing, reload]);

  async function run() {
    setRunning(true);
    setRunErr("");
    const r = await fetch("/api/analyses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: id }) });
    const j = await r.json();
    if (!r.ok) {
      setRunErr(j.error ?? "Could not start the analysis");
      setRunning(false);
      return;
    }
    router.push(`/analysis/${j.id}`);
  }

  if (loadErr) return (
    <div className="mx-auto max-w-xl py-8">
      <p className="text-red-700">{loadErr}</p>
      <Link href="/" className="mt-3 inline-block text-blue-700 underline">Back to projects</Link>
    </div>
  );
  if (!data) return <p className="p-8 text-neutral-500">Loading…</p>;
  const { readiness: rd, usage } = data;
  const outOfFree = usage.limit > 0 && usage.used >= usage.limit;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageTitle title="Data" sub="Upload your files and we map the columns for you. Charts appear as soon as the import finishes." />
      <Steps counts={rd.counts} analyses={data.analyses.length} />

      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-neutral-700">
            <b>{rd.counts.sales}</b> sales ({rd.counts.salesDays} days) · <b>{rd.counts.reviews}</b> reviews · <b>{rd.counts.competitors}</b> competitors · <b>{rd.counts.chunks}</b> doc chunks
          </div>
          <button onClick={run} disabled={!rd.ready || running || !!processing || outOfFree} className="rounded-lg bg-brand px-4 py-2 font-semibold text-white hover:bg-brand-deep disabled:opacity-40">
            {running ? "Starting…" : "Run analysis"}
          </button>
        </div>
        <p className="mt-2 text-xs text-neutral-500" data-testid="usage">
          {usage.limit > 0 ? `${usage.used} of ${usage.limit} free analyses used` : "Unlimited analyses"}
          {usage.spentUsd > 0 && ` · about $${usage.spentUsd} of AI cost so far`}
        </p>
        {outOfFree && <p className="mt-1 text-sm text-amber-700">You&apos;ve used all {usage.limit} free analyses for this project. Unlimited analyses are part of the paid plan ($99/month), which isn&apos;t available in this demo.</p>}
        {!rd.ready && <p className="mt-2 text-sm text-amber-700">{rd.problems.join(" ")}</p>}
        {processing && <p className="mt-2 text-sm text-amber-700">Processing uploads… the analysis unlocks when they finish.</p>}
        {runErr && <p className="mt-2 text-sm text-red-600">{runErr}</p>}
      </section>

      <InstantPreview />

      <CsvUpload kind="sales" title="1. Sales data (CSV or Excel)" projectId={id} onDone={reload} />
      <CsvUpload kind="reviews" title="2. Customer reviews (CSV or Excel)" projectId={id} onDone={reload} />
      <DocUpload projectId={id} competitors={data.competitors.map((c) => c.name)} onDone={reload} />

      <CsvUpload kind="ads" title="Ads report (CSV or Excel, one row per day, SKU and campaign)" projectId={id} onDone={reload} />
      <CsvUpload kind="competitor_tracker" title="Competitor tracking data (CSV or Excel, snapshots over time)" projectId={id} onDone={reload} />

      <SearchBox projectId={id} competitors={data.competitors.map((c) => c.name)} />

      {data.analyses.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Analyses</h2>
          <ul className="divide-y rounded border text-sm">
            {data.analyses.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 p-3">
                <span>{new Date(a.startedAt).toLocaleString()} <span className={`ml-2 rounded px-2 py-0.5 text-xs ${badge[a.status === "done" ? "ready" : a.status === "failed" ? "failed" : "processing"]}`}>{a.status}</span></span>
                <span className="flex gap-3">
                  {a.status === "done" && <Link className="text-blue-700 underline" href={`/analysis/${a.id}/report`}>Report</Link>}
                  <Link className="text-neutral-600 underline" href={`/analysis/${a.id}`}>Details</Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Upload history</h2>
        <ul className="divide-y rounded border text-sm">
          {data.uploads.length === 0 && <li className="p-3 text-neutral-500">Nothing uploaded yet.</li>}
          {data.uploads.map((u) => (
            <li key={u.id} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <span>
                  <span className="text-neutral-500">{u.kind.replace("_", " ")}</span> · {u.filename}
                </span>
                <span className={`rounded px-2 py-0.5 text-xs ${badge[u.status] ?? ""}`}>{u.status}</span>
              </div>
              {u.error && <p className="mt-1 text-red-600">{u.error}</p>}
              {u.status === "processing" && u.stats?.tagging === "running" && <p className="mt-1 text-amber-700">Tagging review topics with AI…</p>}
            </li>
          ))}
        </ul>
      </section>

      <ThirtyDay />

      <section className="rounded border border-red-200 p-4">
        <h2 className="font-semibold text-red-800">Delete my data</h2>
        <p className="text-sm text-neutral-600">Removes this project, every upload and the uploaded files, all analyses and reports. This can&apos;t be undone.</p>
        <button onClick={deleteAll} disabled={deleting} className="mt-2 rounded border border-red-700 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50">
          {deleting ? "Deleting…" : "Delete project and all data"}
        </button>
        {delErr && <p className="mt-2 text-sm text-red-600">{delErr}</p>}
      </section>
    </div>
  );
}

function Steps({ counts, analyses }: { counts: { sales: number; reviews: number; chunks: number }; analyses: number }) {
  const steps = [
    { n: 1, label: "Sales", done: counts.sales > 0 },
    { n: 2, label: "Reviews", done: counts.reviews > 0 },
    { n: 3, label: "Competitors", done: counts.chunks > 0 },
    { n: 4, label: "Run analysis", done: analyses > 0 },
  ];
  const current = steps.find((x) => !x.done)?.n ?? 4;
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Setup progress">
      {steps.map((x) => (
        <li key={x.n} aria-current={x.n === current && !x.done ? "step" : undefined} className={`flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-sm ${x.done ? "bg-[#dcf5dc] text-good" : x.n === current ? "bg-[#dbe9fa] font-semibold text-brand-deep" : "bg-[#ecebe6] text-muted"}`}>
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white ${x.done ? "bg-[#0ca30c]" : x.n === current ? "bg-[#2a78d6]" : "bg-[#c3c2b7]"}`}>{x.done ? "✓" : x.n}</span>
          {x.label}
        </li>
      ))}
    </ol>
  );
}

/** Charts that need only your data: shown the moment a sales file is imported, before any AI runs. */
function InstantPreview() {
  const { data } = useWorkspace();
  if (!data || data.insights.counts.sales === 0) return null;
  const ins = data.insights;
  const f = defaultFilter(ins);
  const pts = monthly(ins, f);
  const top = products(ins, f).slice(0, 3);
  return (
    <Card title="Instant preview from your data" right={<Pill tone="good">No AI needed</Pill>}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-muted">Revenue by month ({monthLabel(pts[0].month)} – {monthLabel(pts[pts.length - 1].month)})</p>
          <BarsTrend data={pts.map((p) => ({ label: monthLabel(p.month), revenue: Math.round(p.revenue) }))} dataKey="revenue" name="Revenue" yFmt={compact} height={150} />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted">Top products by revenue share</p>
          <HBars items={top.map((p) => ({ name: p.sku, value: p.share, color: C.s1 }))} />
          <p className="mt-2 text-xs text-muted">{ins.counts.sales.toLocaleString("en-US")} orders · {ins.counts.skus} products · data through {ins.dataThrough.sales}</p>
        </div>
      </div>
    </Card>
  );
}

function ThirtyDay() {
  const { id, data } = useWorkspace();
  const report = data?.report;
  if (!report) return null;
  return (
    <Card title="30-day check">
      <p className="mb-1 text-xs text-ink2">Re-upload your latest sales and reviews above (a re-upload replaces the old file), then compare with the numbers frozen when you chose your actions.</p>
      <ProgressCheck analysisId={report.analysis.id} projectId={id} />
    </Card>
  );
}

function Report({ stats, error }: { stats: Record<string, unknown>; error?: string | null }) {
  const s = stats as {
    totalRows?: number; validRows?: number; distinctSkus?: number; duplicateRows?: number;
    dateRange?: { from: string; to: string; days: number } | null;
    rejected?: { count: number; reasons: Record<string, number>; samples: { line: number; reason: string }[] };
    warnings?: string[]; blockers?: string[];
  };
  return (
    <div className="mt-3 space-y-1 rounded bg-neutral-50 p-3 text-sm">
      {error && <p className="font-medium text-red-600">Not imported: {error}</p>}
      <p>
        {s.validRows} of {s.totalRows} rows valid
        {s.dateRange && <> · {s.dateRange.from} → {s.dateRange.to} ({s.dateRange.days} days)</>}
        {(s as { products?: number }).products ? <> · {(s as { products?: number }).products} competitor products from {(s as { competitors?: number }).competitors} competitors</> : s.distinctSkus ? <> · {s.distinctSkus} SKUs</> : null}
      </p>
      {s.rejected && s.rejected.count > 0 && (
        <p className="text-red-700">
          {s.rejected.count} rows rejected: {Object.entries(s.rejected.reasons).map(([k, v]) => `${k} (${v})`).join("; ")}.
          {" "}First at line {s.rejected.samples.map((x) => x.line).join(", ")}.
        </p>
      )}
      {s.warnings?.map((w, i) => <p key={i} className="text-amber-700">⚠ {w}</p>)}
    </div>
  );
}

function CsvUpload({ kind, title, projectId, onDone }: { kind: "sales" | "reviews" | "competitor_tracker" | "ads"; title: string; projectId: string; onDone: () => void }) {
  const [map, setMap] = useState<MapResp | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<Upload | null>(null);

  async function pick(file: File) {
    setErr(""); setResult(null); setMap(null); setBusy(true);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    const r = await fetch(`/api/projects/${projectId}/uploads`, { method: "POST", body: fd });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Upload failed");
    setMap(j);
    setMapping(j.suggestedMapping);
  }

  async function confirm() {
    if (!map) return;
    setBusy(true); setErr("");
    const r = await fetch(`/api/uploads/${map.upload.id}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mapping }) });
    const j = await r.json().catch(() => ({ error: "The server did not answer properly. Try again." }));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Import failed");
    setResult(j.upload);
    if (j.upload.status !== "failed") setMap(null);
    onDone();
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-2 rounded-xl border-2 border-dashed border-[#c9dcf5] bg-[#f6faff] p-4 text-center">
        <input type="file" accept=".csv,.xlsx,.txt" disabled={busy} aria-label={`Choose a ${kind} file`} onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#dbe9fa] file:px-3 file:py-1.5 file:font-semibold file:text-brand-deep" />
        <p className="mt-1 text-xs text-muted">Drop a file here or browse. Any column names are fine: we match them for you and you confirm.</p>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}

      {map && (
        <div className="mt-3">
          <p className="text-sm text-neutral-600">{map.totalRows} rows found. Check which column holds what (we guessed for you):</p>
          {map.notes.map((n, i) => <p key={i} className="text-xs text-neutral-500">ℹ {n}</p>)}
          <table className="mt-2 w-full text-sm">
            <tbody>
              {map.fields.map((f) => (
                <tr key={f.field} className="border-t">
                  <td className="py-1 pr-2">{f.label}{f.required && <span className="text-red-600"> *</span>}{map.aiFields.includes(f.field) && mapping[f.field] === map.suggestedMapping[f.field] && <span className="ml-1 rounded bg-purple-100 px-1 text-xs text-purple-800">AI suggested, please check</span>}</td>
                  <td>
                    <select value={mapping[f.field] ?? ""} onChange={(e) => setMapping({ ...mapping, [f.field]: e.target.value || null })} className="w-full rounded border px-2 py-1">
                      <option value="">— not in my file —</option>
                      {map.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <details className="mt-2 text-xs text-neutral-500">
            <summary>Preview first rows</summary>
            <div className="mt-1 overflow-auto">
              <table className="min-w-full">
                <thead><tr>{map.headers.map((h) => <th key={h} className="px-2 text-left">{h}</th>)}</tr></thead>
                <tbody>{map.preview.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="px-2">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </details>
          <button onClick={confirm} disabled={busy} className="mt-3 rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-50">
            {busy ? "Importing…" : "Confirm and import"}
          </button>
          <p className="mt-1 text-xs text-neutral-500">{kind === "competitor_tracker" ? "Re-uploading adds new dates and updates matching ones, so you can keep adding fresh snapshots." : kind === "ads" ? "Re-uploading adds new days and updates matching ones (same day, SKU and campaign), so you can keep adding fresh exports." : `Importing replaces any ${kind} data already in this project.`}</p>
        </div>
      )}
      {result?.stats && <Report stats={result.stats} error={result.status === "failed" ? result.error : null} />}
      {result && !result.stats && result.error && <p className="mt-2 text-sm text-red-600">{result.error}</p>}
    </section>
  );
}

function DocUpload({ projectId, competitors, onDone }: { projectId: string; competitors: string[]; onDone: () => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setMsg({ ok: false, text: "Choose a file." });
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.set("kind", "competitor_doc"); fd.set("competitor", name); fd.set("docDate", date); fd.set("file", file);
    const r = await fetch(`/api/projects/${projectId}/uploads`, { method: "POST", body: fd });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: j.error ?? "Upload failed" });
    const u = j.upload as Upload;
    if (u.status === "failed") return setMsg({ ok: false, text: u.error ?? "Processing failed" });
    const st = u.stats as { chunks: number; warnings: string[] };
    setMsg({ ok: true, text: `Added ${st.chunks} passages. ${st.warnings.join(" ")}` });
    setFile(null);
    onDone();
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="font-semibold">3. Competitor documents (PDF, CSV, Excel, TXT)</h2>
      <p className="text-sm text-neutral-600">Catalogues, price lists or policy pages. Text-based PDFs only. For competitor data that changes day to day (price, discounts, stock), use the tracking box below instead.</p>
      <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-2">
        <input list="comps" value={name} onChange={(e) => setName(e.target.value)} placeholder="Competitor name" className="rounded border px-3 py-2 text-sm" />
        <datalist id="comps">{competitors.map((c) => <option key={c} value={c} />)}</datalist>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border px-3 py-2 text-sm" title="Document date (optional; we try to detect it)" />
        <input key={String(file?.name)} type="file" accept=".pdf,.csv,.xlsx,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm sm:col-span-2" />
        <button disabled={busy} className="rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-50 sm:col-span-2 sm:w-fit">
          {busy ? "Reading and indexing…" : "Upload"}
        </button>
      </form>
      {busy && <p className="mt-2 text-xs text-neutral-500">This can take up to a minute on the free embedding tier.</p>}
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-green-700" : "text-red-600"}`}>{msg.text}</p>}
    </section>
  );
}

type SearchHit = { sourceId: string; content: string; page: number | null; competitor: string; title: string; docDate: string | null; score: number; vectorRank: number | null; keywordRank: number | null; stale: boolean };

function SearchBox({ projectId, competitors }: { projectId: string; competitors: string[] }) {
  const [q, setQ] = useState("");
  const [comp, setComp] = useState("");
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [err, setErr] = useState("");

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(""); setHits(null);
    const params = new URLSearchParams({ q, k: "6" });
    if (comp) params.set("competitor", comp);
    const r = await fetch(`/api/projects/${projectId}/search?${params}`);
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? "Search failed");
    setHits(j.hits);
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="font-semibold">4. Try the competitor search</h2>
      <p className="text-sm text-neutral-600">This is what the agent sees when it looks up competitor facts. Every passage has a citation id.</p>
      <form onSubmit={search} className="mt-3 flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Who offers free shipping?" className="min-w-0 flex-1 rounded border px-3 py-2 text-sm" />
        <select value={comp} onChange={(e) => setComp(e.target.value)} className="rounded border px-2 py-2 text-sm">
          <option value="">All competitors</option>
          {competitors.map((c) => <option key={c}>{c}</option>)}
        </select>
        <button disabled={busy || q.trim().length < 2} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand-deep disabled:opacity-50">{busy ? "Searching…" : "Search"}</button>
      </form>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      {hits && hits.length === 0 && <p className="mt-2 text-sm text-neutral-500">No passages found. Upload competitor documents first.</p>}
      <ul className="mt-3 space-y-2">
        {hits?.map((h) => (
          <li key={h.sourceId} className="rounded bg-neutral-50 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-600">
              <code className="rounded bg-neutral-200 px-1">{h.sourceId}</code>
              <b>{h.competitor}</b>
              <span>{h.title}{h.page ? ` · p.${h.page}` : ""}</span>
              <span>{h.docDate ? `dated ${h.docDate}` : "no date"}</span>
              {h.stale && <span className="rounded bg-amber-100 px-1 text-amber-800">stale</span>}
              <span className="ml-auto">score {h.score.toFixed(3)}</span>
            </div>
            <p className="mt-1 whitespace-pre-wrap">{h.content.length > 320 ? h.content.slice(0, 320) + "…" : h.content}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
