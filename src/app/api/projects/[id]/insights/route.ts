import { desc, eq, max } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { limited } from "@/lib/rate-limit";
import { guardProject } from "@/lib/auth/access";
import { computeInsights } from "@/lib/insights/compute";
import { buildReport } from "@/lib/report/build";
import { readiness } from "@/lib/ingest/readiness";
import { loadTracked } from "@/lib/ingest/tracker";
import { loadAdDays, loadUnitProfit } from "@/lib/ingest/ads";

// Everything the workspace screens draw: chart-ready series straight from the seller's data (available as
// soon as files are uploaded) plus the latest finished analysis, if there is one.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardProject(id);
  if (g instanceof Response) return g;
  const { project } = g;
  const blocked = limited(req, "insights", 60);
  if (blocked) return blocked;

  const analyses = await db.select({ id: schema.analyses.id, status: schema.analyses.status, startedAt: schema.analyses.startedAt })
    .from(schema.analyses).where(eq(schema.analyses.projectId, id)).orderBy(desc(schema.analyses.startedAt)).limit(10);
  const latestDone = analyses.find((a) => a.status === "done");
  const running = analyses.find((a) => a.status === "running" || a.status === "queued");

  const [{ last }] = await db.select({ last: max(schema.uploads.createdAt) }).from(schema.uploads).where(eq(schema.uploads.projectId, id));
  const [insights, report, ready, tracked, adData, unitProfit] = await Promise.all([
    computeInsights(id),
    latestDone ? buildReport(latestDone.id) : Promise.resolve(null),
    readiness(id),
    loadTracked(id),
    loadAdDays(id),
    loadUnitProfit(id),
  ]);
  // Newest 120 days only, so a long ads history cannot make the page heavy.
  const lastAd = adData.days.reduce((m, d) => (d.sales > 0 || d.spend > 0 ? (d.d > m ? d.d : m) : m), "");
  const cut = lastAd ? new Date(Date.parse(lastAd) - 119 * 864e5).toISOString().slice(0, 10) : "";
  return Response.json({
    project: { id: project.id, name: project.name, goal: project.goal },
    insights, report, readiness: ready,
    // Capped so a long-running tracker file cannot make the page heavy: newest 400 snapshots of up to 80 products.
    tracker: tracked.slice(0, 80).map((p) => ({ ...p, series: p.series.slice(-400) })),
    ads: adData.days.length ? { days: adData.days.filter((d) => d.d >= cut), names: adData.names, campaigns: adData.campaigns, unitProfit } : null,
    runningAnalysisId: running?.id ?? null,
    analysisCount: analyses.length,
    lastUploadAt: last ? last.toISOString() : null,
  });
}
