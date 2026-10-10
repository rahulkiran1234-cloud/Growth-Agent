"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Ev } from "./evidence-drawer";
import { useWorkspace } from "./workspace";

type Msg = { role: "user" | "assistant"; content: string; sources?: string[]; unverified?: string[]; error?: boolean };

const SUGGEST: Record<string, string[]> = {
  "": ["Why did revenue fall?", "What should I fix first?", "Which products are most at risk?"],
  "sales-price": ["Did my price cut help sales?", "Which product's price changed the most?", "How do my prices compare to competitors?"],
  reviews: ["Which product is dragging my rating down?", "Should I stop selling my worst-rated product?", "Which complaints can I fix myself?"],
  customers: ["What do unhappy customers mention most?", "Which products have the most returns?", "Is my rating getting better or worse?"],
  competitors: ["Where am I behind competitors?", "What do competitors offer that I don't?"],
  plan: ["Why is this action first?", "What could go wrong with the top action?"],
  data: ["Is my data good enough for a reliable analysis?"],
};
const SCREEN: Record<string, string> = { "": "Overview", "sales-price": "Sales & Price", customers: "Customers", reviews: "Reviews", competitors: "Competitors", ads: "Ads", plan: "Action Plan", data: "Data" };

export function ChatDock() {
  const { id, chat } = useWorkspace();
  const path = usePathname();
  const seg = path.split("/")[3] ?? "";
  const screen = SCREEN[seg] ?? "Overview";
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const msgsRef = useRef<Msg[]>([]);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  const send = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history: Msg[] = [...msgsRef.current, { role: "user", content: q }];
    setMsgs(history);
    setInput("");
    setBusy(true);
    try {
      const r = await fetch(`/api/projects/${id}/chat`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history.filter((m) => !m.error).map(({ role, content }) => ({ role, content })), screen, focus: chat.focus }),
      });
      const j = await r.json();
      setMsgs([...history, r.ok ? { role: "assistant", content: j.answer, sources: j.sources, unverified: j.unverified } : { role: "assistant", content: j.error ?? "Something went wrong.", error: true }]);
    } catch {
      setMsgs([...history, { role: "assistant", content: "I couldn't reach the server. Please try again.", error: true }]);
    }
    setBusy(false);
  }, [busy, id, screen, chat.focus]);

  // A chart's "Ask about this" button pre-fills and sends a question.
  const { pending, clearPending } = chat;
  useEffect(() => {
    if (pending) { clearPending(); void send(pending); }
  }, [pending, clearPending, send]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs, busy]);

  if (!chat.open) return null;
  return (
    <aside role="complementary" aria-label="Ask the analyst" className="no-print fixed bottom-14 right-0 top-0 z-40 flex w-full max-w-sm flex-col border-l border-line bg-surface shadow-xl md:bottom-0">
      <div className="flex items-center justify-between border-b border-line p-3">
        <div><p className="text-sm font-bold">Ask the analyst</p><p className="text-[11px] text-muted">{screen}{chat.focus ? ` · ${chat.focus}` : ""}</p></div>
        <button type="button" onClick={() => chat.setOpen(false)} className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-[#f0efec]">Close</button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {msgs.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted">I answer from your sales, reviews and competitor files, and check every figure I quote. I can&apos;t change anything.</p>
            {(SUGGEST[seg] ?? SUGGEST[""]).map((s) => <button key={s} type="button" onClick={() => void send(s)} className="block w-full rounded-lg border border-line px-3 py-2 text-left text-xs hover:bg-[#f0efec]">{s}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "ml-8 rounded-xl bg-brand px-3 py-2 text-white" : `mr-4 rounded-xl border px-3 py-2 ${m.error ? "border-[#f0b9b9] bg-[#fdeaea] text-crit" : "border-line bg-page"}`}>
            <p className="whitespace-pre-wrap">{m.content}</p>
            {m.sources && m.sources.length > 0 && <p className="mt-2 flex flex-wrap gap-1">{m.sources.slice(0, 6).map((s) => <Ev key={s} refId={s} />)}</p>}
            {m.unverified && m.unverified.length > 0 && <p className="mt-2 rounded bg-[#fff8e4] p-2 text-[11px] text-warnink">! Could not verify these figures against your data: {m.unverified.join(", ")}.</p>}
          </div>
        ))}
        {busy && <p className="text-xs text-muted" role="status">Checking your data…</p>}
        <div ref={endRef} />
      </div>
      <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} maxLength={500} placeholder="Ask about your numbers…" aria-label="Your question" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        <button type="submit" disabled={busy || !input.trim()} className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Send</button>
      </form>
    </aside>
  );
}
