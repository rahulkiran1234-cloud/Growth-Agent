"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useWorkspace } from "./workspace";

type Quote = { kind: "quote"; ref: string; competitor: string; title: string; page: number | null; docDate: string | null; snippet: string };
type Data = { kind: "data"; ref: string; section: string; sku: string | null; data: unknown };

/** A clickable reference chip ("chunk:12", "sql_kpis:returns") that opens the evidence drawer. */
export function Ev({ refId, children }: { refId: string; children?: ReactNode }) {
  const { evidence } = useWorkspace();
  return (
    <button type="button" onClick={() => evidence.show(refId)} className="rounded bg-[#dbe9fa] px-1.5 py-0.5 text-[10px] font-semibold text-brand-deep hover:bg-[#c9dcf5]" title="Show the evidence behind this">
      {children ?? refId.replace("sql_kpis:", "data: ").replace("chunk:", "source ")}
    </button>
  );
}

function Table({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Object.keys(rows[0] ?? {});
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs tnum">
        <thead><tr className="border-b border-line text-muted">{cols.map((c) => <th key={c} className="py-1 pr-3 font-medium">{c.replace(/_/g, " ")}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-b border-line/60">{cols.map((c) => <td key={c} className="py-1 pr-3">{String(r[c] ?? "")}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function EvidenceDrawer() {
  const { id, evidence } = useWorkspace();
  const [state, setState] = useState<{ ref: string; res?: Quote | Data; err?: string } | null>(null);

  useEffect(() => {
    const ref = evidence.ref;
    if (!ref) return;
    let live = true;
    fetch(`/api/projects/${id}/evidence?ref=${encodeURIComponent(ref)}`)
      .then(async (r) => ({ ok: r.ok, j: await r.json() }))
      .then(({ ok, j }) => live && setState(ok ? { ref, res: j } : { ref, err: j.error ?? "Could not load this evidence." }))
      .catch(() => live && setState({ ref, err: "Could not load this evidence." }));
    return () => { live = false; };
  }, [id, evidence.ref]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && evidence.close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [evidence]);

  if (!evidence.ref) return null;
  const cur = state && state.ref === evidence.ref ? state : null;
  const res = cur?.res;
  return (
    <div className="no-print fixed inset-0 z-50 flex justify-end bg-black/30" onClick={evidence.close} role="presentation">
      <aside role="dialog" aria-label="Evidence" aria-modal="true" className="h-full w-full max-w-md overflow-y-auto bg-surface p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div><p className="text-[10px] font-bold uppercase tracking-wide text-brand-deep">Evidence</p><p className="font-mono text-xs text-ink2">{evidence.ref}</p></div>
          <button type="button" onClick={evidence.close} className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-[#f0efec]" autoFocus>Close</button>
        </div>
        {!cur && <p className="mt-4 text-sm text-muted">Loading…</p>}
        {cur?.err && <p className="mt-4 text-sm text-crit">{cur.err}</p>}
        {res?.kind === "quote" && (
          <div className="mt-4 space-y-2 text-sm">
            <p className="font-semibold">{res.competitor} · {res.title}</p>
            <p className="text-xs text-muted">{res.page ? `Page ${res.page} · ` : ""}{res.docDate ? `dated ${res.docDate}` : "date unknown"}</p>
            <blockquote className="rounded-lg border-l-4 border-brand bg-page p-3 italic text-ink2">{res.snippet}</blockquote>
            <p className="text-xs text-muted">This is the passage from your uploaded competitor file that the claim was checked against.</p>
          </div>
        )}
        {res?.kind === "data" && (
          <div className="mt-4 space-y-2 text-sm">
            <p className="font-semibold">Your data: {res.section.replace(/_/g, " ")}{res.sku ? ` · ${res.sku}` : ""}</p>
            {Array.isArray(res.data) ? <Table rows={res.data as Record<string, unknown>[]} /> : <pre className="overflow-x-auto rounded-lg bg-page p-3 text-xs">{JSON.stringify(res.data, null, 2)}</pre>}
            <p className="text-xs text-muted">This is the exact query result the finding was computed from.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
