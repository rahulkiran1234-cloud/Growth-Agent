import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { resolveCitations, type Citation } from "@/lib/rag/citations";
import type { ActionPlan, Comparison, CompetitorEvidence, CurrentState, Problems, StoredSolution } from "@/lib/agent/schemas";
import type { Gate } from "./format";
import { isUuid } from "@/lib/ids";

export type Finding = CompetitorEvidence["competitors"][number]["findings"][number] & { source?: { title: string; page: number | null; doc_date: string | null; stale: boolean } };
export type S2 = { competitors: { name: string; findings: Finding[] }[]; coverage_gaps: string[] };
export type Ranking = { id: string; title: string; priority: number; effort: string; gain_low_monthly: number | null; gain_high_monthly: number | null };
export type S6 = ActionPlan & { ranking: Ranking[] };
export type PlanItem = { solutionId: string; adopted: boolean; owner: string | null; dueDate: string | null; week: number | null; adoptedAt: string | null };

export type Report = {
  analysis: { id: string; status: string; model: string | null; inputTokens: number; outputTokens: number; costUsd: string; startedAt: string; finishedAt: string | null };
  project: { id: string; name: string; goal: string };
  s1: CurrentState | null;
  s2: S2 | null;
  s3: Comparison | null;
  s4: Problems | null;
  s5: { solutions: StoredSolution[] } | null;
  s6: S6 | null;
  citations: Record<string, Citation>;
  gates: Gate[];
  plan: PlanItem[];
};

/** Assembles everything the report page and PDF show from the stored step outputs. */
export async function buildReport(analysisId: string): Promise<Report | null> {
  if (!isUuid(analysisId)) return null;
  const [a] = await db.select().from(schema.analyses).where(eq(schema.analyses.id, analysisId));
  if (!a) return null;
  const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, a.projectId));
  if (!p) return null;

  const steps = await db.select().from(schema.analysisSteps).where(eq(schema.analysisSteps.analysisId, analysisId)).orderBy(asc(schema.analysisSteps.stepNo));
  const out = (n: number) => (steps.find((s) => s.stepNo === n)?.output ?? null) as unknown;

  const gateEvents = await db.select().from(schema.analysisEvents).where(and(eq(schema.analysisEvents.analysisId, analysisId), eq(schema.analysisEvents.type, "gate"))).orderBy(asc(schema.analysisEvents.seq));
  const byStep = new Map<number, Gate>(); // a resumed step can emit twice: keep the latest
  for (const e of gateEvents) {
    const g = e.payload as unknown as Gate;
    byStep.set(g.step, g);
  }

  const s2 = out(2) as S2 | null;
  const s3 = out(3) as Comparison | null;
  const s4 = out(4) as Problems | null;
  const ids = new Set<string>();
  s2?.competitors.forEach((c) => c.findings.forEach((f) => ids.add(f.source_id)));
  s3?.comparison.forEach((r) => r.competitors.forEach((c) => c.source_id && ids.add(c.source_id)));
  s4?.problems.forEach((pr) => pr.competitor_evidence.forEach((e) => ids.add(e.source_id)));
  const { found } = await resolveCitations(p.id, [...ids]);

  const items = await db.select().from(schema.actionPlanItems).where(eq(schema.actionPlanItems.analysisId, analysisId));

  return {
    analysis: {
      id: a.id, status: a.status, model: a.model, inputTokens: a.inputTokens ?? 0, outputTokens: a.outputTokens ?? 0,
      costUsd: a.costUsd ?? "0", startedAt: a.startedAt.toISOString(), finishedAt: a.finishedAt?.toISOString() ?? null,
    },
    project: { id: p.id, name: p.name, goal: p.goal },
    s1: out(1) as CurrentState | null,
    s2, s3, s4,
    s5: out(5) as { solutions: StoredSolution[] } | null,
    s6: out(6) as S6 | null,
    citations: Object.fromEntries(found.map((c) => [c.sourceId, c])),
    gates: [...byStep.values()].sort((x, y) => x.step - y.step),
    plan: items.map((i) => ({
      solutionId: i.recommendationId, adopted: !!i.adopted, owner: i.owner ?? null, dueDate: i.dueDate ?? null, week: i.week ?? null,
      adoptedAt: (i.baseline as { adoptedAt?: string } | null)?.adoptedAt ?? null,
    })),
  };
}
