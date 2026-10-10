"use client";
import { useState } from "react";

type Sol = { id: string; title: string; gain: string; effort: string; top: boolean };
type Item = { adopted: boolean; owner: string; dueDate: string };

export default function PlanEditor({
  analysisId, solutions, initial, recheckOn,
}: {
  analysisId: string;
  solutions: Sol[];
  initial: Record<string, { adopted: boolean; owner: string | null; dueDate: string | null }>;
  recheckOn: string;
}) {
  const [items, setItems] = useState<Record<string, Item>>(
    Object.fromEntries(solutions.map((s) => [s.id, { adopted: initial[s.id]?.adopted ?? false, owner: initial[s.id]?.owner ?? "", dueDate: initial[s.id]?.dueDate ?? "" }])),
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [msg, setMsg] = useState("");
  const set = (id: string, patch: Partial<Item>) => {
    setItems((p) => ({ ...p, [id]: { ...p[id], ...patch } }));
    setStatus("idle");
  };

  async function save() {
    setStatus("saving");
    const r = await fetch(`/api/analyses/${analysisId}/plan`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: solutions.map((s) => ({ solutionId: s.id, adopted: items[s.id].adopted, owner: items[s.id].owner.trim() || null, dueDate: items[s.id].dueDate || null })) }),
    });
    const j = await r.json();
    if (!r.ok) { setStatus("error"); return setMsg(j.error ?? "Could not save"); }
    setStatus("saved");
    setMsg(`Saved. We froze today's KPI baseline for the actions you chose; re-measure on ${recheckOn}.`);
  }

  const adoptedCount = Object.values(items).filter((i) => i.adopted).length;

  return (
    <div className="mt-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">Which of these will you do?</h3>
        <button type="button" className="rounded border px-2 py-0.5 text-xs hover:bg-neutral-50" onClick={() => solutions.forEach((s) => s.top && set(s.id, { adopted: true }))}>
          Select the top actions
        </button>
      </div>
      <ul className="mt-2 divide-y rounded border">
        {solutions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 p-2 text-sm">
            <label className="flex min-w-0 flex-1 items-start gap-2">
              <input type="checkbox" className="mt-1" checked={items[s.id].adopted} onChange={(e) => set(s.id, { adopted: e.target.checked })} />
              <span>
                <b>{s.id}</b> {s.title}
                <span className="block text-xs text-neutral-500">Effort {s.effort} · est. gain/month {s.gain}{s.top ? " · top action" : ""}</span>
              </span>
            </label>
            <input aria-label={`Owner for ${s.id}`} placeholder="Owner" value={items[s.id].owner} disabled={!items[s.id].adopted} onChange={(e) => set(s.id, { owner: e.target.value })} className="w-32 rounded border px-2 py-1 text-xs disabled:opacity-40" />
            <input aria-label={`Due date for ${s.id}`} type="date" value={items[s.id].dueDate} disabled={!items[s.id].adopted} onChange={(e) => set(s.id, { dueDate: e.target.value })} className="rounded border px-2 py-1 text-xs disabled:opacity-40" />
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-3">
        <button onClick={save} disabled={status === "saving"} className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50">
          {status === "saving" ? "Saving…" : `Save plan (${adoptedCount} selected)`}
        </button>
        {status === "saved" && <span className="text-sm text-green-700">{msg}</span>}
        {status === "error" && <span className="text-sm text-red-600">{msg}</span>}
      </div>
    </div>
  );
}
