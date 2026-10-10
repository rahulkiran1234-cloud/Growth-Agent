import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { dispatch } from "@/lib/jobs";
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
  try {
    await dispatch({ kind: "analysis", analysisId: id, projectId: a.projectId });
  } catch (e) {
    await db.update(schema.analyses).set({ status: "failed", error: (e as Error).message, finishedAt: new Date() }).where(eq(schema.analyses.id, id));
    return Response.json({ error: `Could not restart the analysis (${(e as Error).message.slice(0, 160)}).` }, { status: 502 });
  }
  return Response.json({ ok: true });
}
