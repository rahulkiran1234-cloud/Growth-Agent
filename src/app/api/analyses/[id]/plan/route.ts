import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { checkDate } from "@/lib/report/format";
import { limited } from "@/lib/rate-limit";
import { guardAnalysis } from "@/lib/auth/access";
import { computeSnapshot } from "@/lib/report/metrics";

const Item = z.object({
  solutionId: z.string().max(20),
  adopted: z.boolean(),
  owner: z.string().trim().max(80).nullable(),
  week: z.number().int().min(1).max(4).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().refine((d) => d === null || !Number.isNaN(Date.parse(d)), "Invalid date"),
});
const Body = z.object({ items: z.array(Item).max(20) });

async function loadPlanContext(analysisId: string) {
  const [a] = await db.select().from(schema.analyses).where(eq(schema.analyses.id, analysisId));
  if (!a) return null;
  const steps = await db.select().from(schema.analysisSteps).where(eq(schema.analysisSteps.analysisId, analysisId));
  const solutions = ((steps.find((s) => s.stepNo === 5)?.output ?? { solutions: [] }) as { solutions: { id: string }[] }).solutions;
  const baseline = ((steps.find((s) => s.stepNo === 6)?.output ?? {}) as { baseline_snapshot?: unknown[] }).baseline_snapshot ?? [];
  return { analysis: a, solutionIds: new Set(solutions.map((s) => s.id)), baseline };
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardAnalysis(id);
  if (g instanceof Response) return g;
  const rows = await db.select().from(schema.actionPlanItems).where(eq(schema.actionPlanItems.analysisId, id));
  return Response.json({
    items: rows.map((r) => ({ solutionId: r.recommendationId, adopted: !!r.adopted, owner: r.owner, dueDate: r.dueDate, week: r.week, baseline: r.baseline })),
  });
}

// Save which actions the seller will do. The first time an action is adopted we freeze the baseline
// KPI snapshot from step 6, so the 30-day re-check compares against what the numbers were at the start.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardAnalysis(id);
  if (g instanceof Response) return g;
  const blocked = limited(req, "plan", 30);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid plan" }, { status: 400 });
  const planCtx = await loadPlanContext(id);
  if (!planCtx) return Response.json({ error: "Not found" }, { status: 404 });
  if (planCtx.analysis.status !== "done") return Response.json({ error: "The analysis must finish before you build a plan." }, { status: 409 });

  for (const it of parsed.data.items) {
    if (!planCtx.solutionIds.has(it.solutionId)) return Response.json({ error: `Unknown action ${it.solutionId}` }, { status: 400 });
  }

  const now = new Date().toISOString();
  // Structured numbers computed by code, frozen once per save, for the day-30 comparison.
  const snap = await computeSnapshot(planCtx.analysis.projectId);
  for (const it of parsed.data.items) {
    const [existing] = await db.select().from(schema.actionPlanItems).where(and(eq(schema.actionPlanItems.analysisId, id), eq(schema.actionPlanItems.recommendationId, it.solutionId)));
    const prev = existing?.baseline as { adoptedAt?: string; metrics?: unknown[] } | null;
    // Plans adopted before structured metrics existed get them frozen on their next save.
    if (it.adopted && prev?.adoptedAt && !prev.metrics) {
      const upgraded = { ...prev, metrics: snap.metrics, dataThrough: snap.dataThrough };
      await db.update(schema.actionPlanItems).set({ adopted: it.adopted, owner: it.owner, dueDate: it.dueDate, ...(it.week !== undefined && { week: it.week }), baseline: upgraded }).where(eq(schema.actionPlanItems.id, existing!.id));
      continue;
    }
    const hasBaseline = !!prev?.adoptedAt;
    const baseline = it.adopted && !hasBaseline ? { snapshot: planCtx.baseline, metrics: snap.metrics, dataThrough: snap.dataThrough, adoptedAt: now, checkOn: checkDate(now) } : existing?.baseline ?? null;
    if (existing) {
      await db.update(schema.actionPlanItems).set({ adopted: it.adopted, owner: it.owner, dueDate: it.dueDate, ...(it.week !== undefined && { week: it.week }), baseline }).where(eq(schema.actionPlanItems.id, existing.id));
    } else {
      await db.insert(schema.actionPlanItems).values({ analysisId: id, recommendationId: it.solutionId, adopted: it.adopted, owner: it.owner, dueDate: it.dueDate, week: it.week ?? null, baseline });
    }
  }
  return Response.json({ ok: true, savedAt: now });
}
