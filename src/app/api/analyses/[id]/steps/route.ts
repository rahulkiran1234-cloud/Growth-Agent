import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { guardAnalysis } from "@/lib/auth/access";

// Finished step outputs for an analysis (used to render results after the stream has ended).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardAnalysis(id);
  if (g instanceof Response) return g;
  const analysis = g.analysis;
  const steps = await db
    .select({ stepNo: schema.analysisSteps.stepNo, output: schema.analysisSteps.output, inputTokens: schema.analysisSteps.inputTokens, outputTokens: schema.analysisSteps.outputTokens, durationMs: schema.analysisSteps.durationMs })
    .from(schema.analysisSteps).where(eq(schema.analysisSteps.analysisId, id)).orderBy(asc(schema.analysisSteps.stepNo));
  return Response.json({ analysis, steps });
}
