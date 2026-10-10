import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { startAnalysis } from "@/lib/agent/run";
import { guardAnalysis } from "@/lib/auth/access";
import { limited } from "@/lib/rate-limit";

// Retry a failed analysis from its first unfinished step (finished steps are kept).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardAnalysis(id);
  if (g instanceof Response) return g;
  const a = g.analysis;
  const blocked = limited(req, "resume", 5);
  if (blocked) return blocked;
  if (a.status !== "failed") return Response.json({ error: `Only failed analyses can be resumed (this one is ${a.status}).` }, { status: 409 });
  await db.update(schema.analyses).set({ status: "running", error: null, finishedAt: null }).where(eq(schema.analyses.id, id));
  startAnalysis(id, a.projectId);
  return Response.json({ ok: true });
}
