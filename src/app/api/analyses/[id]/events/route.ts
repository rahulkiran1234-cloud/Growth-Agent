import { and, asc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { markRestarted, needsRestart } from "@/lib/agent/run";
import { dispatch } from "@/lib/jobs";
import { guardAnalysis } from "@/lib/auth/access";

// SSE: replays persisted events after Last-Event-ID, then tails until the analysis finishes.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardAnalysis(id);
  if (g instanceof Response) return g;
  const url = new URL(req.url);
  let last = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => controller.enqueue(enc.encode(s));
      try {
        while (!req.signal.aborted) {
          const evs = await db
            .select()
            .from(schema.analysisEvents)
            .where(and(eq(schema.analysisEvents.analysisId, id), gt(schema.analysisEvents.seq, last)))
            .orderBy(asc(schema.analysisEvents.seq));
          for (const e of evs) {
            send(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e.payload)}\n\n`);
            last = e.seq;
          }
          const [a] = await db.select({ status: schema.analyses.status, projectId: schema.analyses.projectId }).from(schema.analyses).where(eq(schema.analyses.id, id));
          if (!a) break;
          // The run died (server restart, or the background function stopped): pick it up again from the last finished step.
          if (a.status === "running" && evs.length === 0 && (await needsRestart(id))) {
            await markRestarted(id);
            await dispatch({ kind: "analysis", analysisId: id, projectId: a.projectId }).catch(() => undefined);
          }
          if (evs.length === 0 && (a.status === "done" || a.status === "failed")) break;
          if (evs.length === 0) send(`: keepalive\n\n`);
          await new Promise((r) => setTimeout(r, 500));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
