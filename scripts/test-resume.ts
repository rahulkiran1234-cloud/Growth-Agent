// Resume test (uses the real model, costs a few cents): npm run test:resume
// 1) start an analysis with a tiny token budget so it fails part-way, 2) resume with a normal budget,
// 3) verify finished steps were not re-run, nothing is duplicated, and the event stream is gap-free.
import { config } from "dotenv";
config({ path: ".env.local" });
import { asc, eq } from "drizzle-orm";

async function main() {
  const { db, schema, pool } = await import("../src/lib/db/client");
  const { startAnalysis } = await import("../src/lib/agent/run");

  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.name, "Acme Home (demo)"));
  if (!project) throw new Error("Run npm run seed first");
  const [a] = await db.insert(schema.analyses).values({ projectId: project.id }).returning();

  const wait = async () => {
    for (;;) {
      const [row] = await db.select().from(schema.analyses).where(eq(schema.analyses.id, a.id));
      if (row.status === "done" || row.status === "failed") return row;
      await new Promise((r) => setTimeout(r, 1500));
    }
  };
  const doneSteps = async () => (await db.select().from(schema.analysisSteps).where(eq(schema.analysisSteps.analysisId, a.id)).orderBy(asc(schema.analysisSteps.stepNo))).map((s) => s.stepNo);

  const original = process.env.MAX_TOKENS_PER_ANALYSIS;
  process.env.MAX_TOKENS_PER_ANALYSIS = "60000";
  console.log("attempt 1 with a 60,000-token budget (expected to fail)…");
  startAnalysis(a.id, project.id);
  const first = await wait();
  const afterFirst = await doneSteps();
  console.log(`  -> ${first.status}: ${first.error}\n  finished steps: [${afterFirst.join(", ")}]`);

  process.env.MAX_TOKENS_PER_ANALYSIS = original ?? "250000";
  await db.update(schema.analyses).set({ status: "running", error: null, finishedAt: null }).where(eq(schema.analyses.id, a.id)); // what POST /resume does
  console.log("attempt 2 with a normal budget (resume)…");
  startAnalysis(a.id, project.id);
  const second = await wait();
  const afterSecond = await doneSteps();
  console.log(`  -> ${second.status}${second.error ? ": " + second.error : ""}\n  finished steps: [${afterSecond.join(", ")}]`);

  const events = await db.select().from(schema.analysisEvents).where(eq(schema.analysisEvents.analysisId, a.id)).orderBy(asc(schema.analysisEvents.seq));
  const started = new Map<number, number>();
  for (const e of events) if (e.type === "step_started") started.set((e.payload as { step: number }).step, (started.get((e.payload as { step: number }).step) ?? 0) + 1);

  const checks: [string, boolean][] = [
    ["attempt 1 failed (budget)", first.status === "failed"],
    ["at least one step finished before the failure", afterFirst.length >= 1],
    ["attempt 2 completed", second.status === "done"],
    ["all 6 steps stored exactly once", afterSecond.length === 6 && new Set(afterSecond).size === 6],
    ["steps finished in attempt 1 were NOT re-run", afterFirst.every((n) => started.get(n) === 1)],
    ["event sequence is contiguous (no gaps or duplicates)", events.every((e, i) => e.seq === i + 1)],
    ["token totals kept accumulating across attempts", (second.inputTokens ?? 0) > (first.inputTokens ?? 0)],
  ];
  console.log("\nchecks:");
  for (const [n, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${n}`);
  const pass = checks.every(([, ok]) => ok);
  console.log(`\nResume test -> ${pass ? "PASS" : "FAIL"} (analysis ${a.id}, est. $${second.costUsd})`);
  await pool.end();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
