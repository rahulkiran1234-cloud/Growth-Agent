import Anthropic from "@anthropic-ai/sdk";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { env } from "@/lib/config/env";
import { makeEmitter } from "@/lib/events";
import { emptyLedger, Ledger, mergeLedgers } from "./ledger";
import { runStep, Ctx } from "./framework";
import { GROUPS } from "./steps";

// In-process runner (no queue for the MVP). The HTTP request returns immediately; the SSE route
// streams progress from persisted events. A server restart kills the run, but every finished
// step is stored, so resuming skips straight to the first unfinished step.
const running = ((globalThis as unknown as { __runs?: Set<string> }).__runs ??= new Set<string>());

export const isRunning = (analysisId: string) => running.has(analysisId);
export const runningCount = () => running.size;

export function startAnalysis(analysisId: string, projectId: string) {
  if (running.has(analysisId)) return;
  running.add(analysisId);
  void runAnalysis(analysisId, projectId).finally(() => running.delete(analysisId));
}

async function runAnalysis(analysisId: string, projectId: string) {
  const cfg = env();
  const em = await makeEmitter(analysisId);
  let failedStep = 0;
  try {
    await db.update(schema.analyses).set({ status: "running", error: null, finishedAt: null }).where(eq(schema.analyses.id, analysisId));

    // Rebuild state from finished steps (empty on a fresh run).
    const done = await db.select().from(schema.analysisSteps).where(eq(schema.analysisSteps.analysisId, analysisId)).orderBy(asc(schema.analysisSteps.stepNo));
    const [row] = await db.select().from(schema.analyses).where(eq(schema.analyses.id, analysisId));
    const prior: Record<number, unknown> = {};
    const snapshots: Ledger[] = [];
    for (const s of done) {
      if (s.status !== "done") continue;
      prior[s.stepNo] = s.output;
      if (s.citations) snapshots.push(s.citations as Ledger);
    }
    const ledger: Ledger = snapshots.length ? mergeLedgers(snapshots) : emptyLedger();

    const ctx: Ctx = {
      analysisId, projectId, emit: em, prior, ledger, embedCache: new Map(),
      client: new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY }),
      model: cfg.LLM_MODEL_STEPS,
      budget: { maxTokens: cfg.MAX_TOKENS_PER_ANALYSIS, inTok: row?.inputTokens ?? 0, outTok: row?.outputTokens ?? 0 },
    };

    for (const group of GROUPS) {
      const todo = group.filter((s) => prior[s.no] === undefined); // finished steps are skipped on resume
      if (todo.length === 0) continue;
      // Run the group in parallel; if one fails the other still finishes and is saved for the retry.
      const settled = await Promise.allSettled(todo.map((s) => runStep(s, ctx)));
      const bad = settled.findIndex((r) => r.status === "rejected");
      if (bad >= 0) {
        failedStep = todo[bad].no;
        throw (settled[bad] as PromiseRejectedResult).reason;
      }
    }
    await em.emit("done", {});
    await em.flush();
    await db.update(schema.analyses).set({ status: "done", finishedAt: new Date() }).where(eq(schema.analyses.id, analysisId));
  } catch (e) {
    const message = (e as Error).message;
    await em.emit("step_failed", { step: failedStep, message });
    await em.emit("error", { message, step: failedStep });
    await em.flush();
    await db.update(schema.analyses).set({ status: "failed", error: message, finishedAt: new Date() }).where(eq(schema.analyses.id, analysisId));
  }
}
