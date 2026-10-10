import { eq, max } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

export type EventType =
  | "step_started"
  | "note"
  | "tool_call"
  | "tool_result"
  | "step_output"
  | "gate"
  | "step_failed"
  | "done"
  | "error";

// Persisted events are the source of truth for streaming: the SSE route replays from the DB,
// so a page refresh mid-run loses nothing. Writes are serialised so seq order is guaranteed.
// The sequence continues from the last stored event, so a resumed run extends the same stream.
export async function makeEmitter(analysisId: string) {
  const [row] = await db.select({ m: max(schema.analysisEvents.seq) }).from(schema.analysisEvents).where(eq(schema.analysisEvents.analysisId, analysisId));
  let seq = row?.m ?? 0;
  let chain: Promise<unknown> = Promise.resolve();
  const emit = (type: EventType, payload: Record<string, unknown>) => {
    const n = ++seq;
    chain = chain.then(() => db.insert(schema.analysisEvents).values({ analysisId, seq: n, type, payload }));
    return chain;
  };
  const flush = () => chain;
  return { emit, flush };
}
export type Emitter = Awaited<ReturnType<typeof makeEmitter>>;
