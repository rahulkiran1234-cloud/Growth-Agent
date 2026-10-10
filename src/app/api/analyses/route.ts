import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/config/env";
import { dispatch } from "@/lib/jobs";
import { eq } from "drizzle-orm";
import { readiness } from "@/lib/ingest/readiness";
import { FREE_LIMIT_MESSAGE, activeAnalyses, freeUsage } from "@/lib/limits";
import { limited } from "@/lib/rate-limit";
import { guardProject } from "@/lib/auth/access";

const Body = z.object({ projectId: z.string().uuid() });

export async function POST(req: Request) {
  const blocked = limited(req, "analyses", 5);
  if (blocked) return blocked;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "projectId is required" }, { status: 400 });
  const { projectId } = parsed.data;

  const g = await guardProject(projectId);
  if (g instanceof Response) return g;

  const gate = await readiness(projectId);
  if (!gate.ready) return Response.json({ error: gate.problems.join(" ") }, { status: 400 });

  // Free tier: failed runs don't count, so a technical failure never costs a seller a free analysis.
  const usage = await freeUsage(projectId);
  if (usage.limit > 0 && usage.used >= usage.limit) {
    return Response.json({ error: FREE_LIMIT_MESSAGE(usage.limit), code: "free_limit" }, { status: 402 });
  }
  // Protects the AI budget: only a few analyses run at once on this server.
  if ((await activeAnalyses()) >= env().MAX_CONCURRENT_ANALYSES) {
    return Response.json({ error: "The server is busy with other analyses. Please try again in a minute.", code: "busy" }, { status: 503, headers: { "Retry-After": "60" } });
  }

  const [analysis] = await db.insert(schema.analyses).values({ projectId }).returning();
  try {
    await dispatch({ kind: "analysis", analysisId: analysis.id, projectId }); // returns at once; the run continues in the background
  } catch (e) {
    await db.update(schema.analyses).set({ status: "failed", error: (e as Error).message, finishedAt: new Date() }).where(eq(schema.analyses.id, analysis.id));
    return Response.json({ error: `Could not start the analysis (${(e as Error).message.slice(0, 160)}).` }, { status: 502 });
  }
  return Response.json({ id: analysis.id });
}
