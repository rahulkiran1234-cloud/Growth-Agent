import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { limited } from "@/lib/rate-limit";
import { guardAnalysis } from "@/lib/auth/access";
import { computeSnapshot, type Snapshot } from "@/lib/report/metrics";
import { compareMetrics, type Metric } from "@/lib/report/metrics-pure";

type Frozen = { metrics?: Metric[]; dataThrough?: Snapshot["dataThrough"]; adoptedAt?: string; checkOn?: string };

// Day-30 re-check: recompute the KPIs from whatever data the project holds now (after a re-upload)
// and compare them with the numbers frozen when the seller adopted their first action. No model call.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardAnalysis(id);
  if (g instanceof Response) return g;
  const a = g.analysis;
  const blocked = limited(req, "progress", 30);
  if (blocked) return blocked;

  const items = await db.select().from(schema.actionPlanItems).where(eq(schema.actionPlanItems.analysisId, id));
  const adopted = items
    .filter((i) => i.adopted && (i.baseline as Frozen | null)?.metrics?.length)
    .map((i) => ({ item: i, frozen: i.baseline as Frozen }))
    .sort((x, y) => String(x.frozen.adoptedAt).localeCompare(String(y.frozen.adoptedAt)));
  if (!adopted.length) return Response.json({ ready: false, reason: "Choose and save at least one action in the plan first. That freezes the starting numbers." });

  const first = adopted[0].frozen; // compare against the earliest baseline: that is when the work began
  const now = await computeSnapshot(a.projectId);
  const unchanged = now.dataThrough.sales === (first.dataThrough?.sales ?? null) && now.dataThrough.reviews === (first.dataThrough?.reviews ?? null);
  return Response.json({
    ready: true,
    adoptedAt: first.adoptedAt,
    checkOn: first.checkOn,
    dataThroughBefore: first.dataThrough,
    dataThroughNow: now.dataThrough,
    dataUnchanged: unchanged,
    actions: adopted.map((x) => ({ solutionId: x.item.recommendationId, owner: x.item.owner, dueDate: x.item.dueDate })),
    comparison: compareMetrics(first.metrics!, now.metrics),
  });
}
