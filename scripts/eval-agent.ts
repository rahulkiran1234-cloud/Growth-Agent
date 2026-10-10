// Acceptance test for the full agent: npm run eval:agent [-- "<project name>"]
// Runs all six steps on the demo project and checks the output against fixtures/expected.md.
import { config } from "dotenv";
config({ path: ".env.local" });
import { asc, eq } from "drizzle-orm";

type Planted = { id: number; what: string; test: (t: string) => boolean };
const has = (t: string, ...res: RegExp[]) => res.every((r) => r.test(t));

const PLANTED: Planted[] = [
  { id: 1, what: "Top-SKU revenue fell from Aug with self-discounting (~12% lower realised price)", test: (t) => has(t, /sku-0[123]/, /(discount|price (cut|reduc|drop|decline|fell)|lower(ed)? (realised )?price|realised price|price reduction)/) },
  { id: 2, what: "Top-SKU return rate far above the rest (~18% vs ~5%)", test: (t) => has(t, /return/, /sku-0[123]/, /(19|18|20|21)(\.\d)?%/) },
  { id: 3, what: "~30% of low-rated reviews cite sizing; ~15% packaging damage", test: (t) => has(t, /siz(e|ing)/) && has(t, /packag/) },
  { id: 4, what: "BrightNest undercuts Acme by ~12% on top SKUs", test: (t) => has(t, /brightnest/, /(undercut|cheaper|lower price|below|less than|12%|price gap|priced)/) },
  { id: 5, what: "UrbanHaus offers a size guide / true-to-size promise", test: (t) => has(t, /urbanhaus/, /(size guide|true-to-size)/) },
  { id: 6, what: "UrbanHaus free shipping above 999 and double-wall packaging (<1% damage)", test: (t) => has(t, /urbanhaus/, /(free shipping|double-wall)/) },
];

async function main() {
  const { db, schema, pool } = await import("../src/lib/db/client");
  const { startAnalysis } = await import("../src/lib/agent/run");
  const { STEP_NAMES } = await import("../src/lib/agent/step-names");

  const name = process.argv[2] ?? "Acme Home (demo)";
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.name, name));
  if (!project) throw new Error(`Project "${name}" not found. Run: npm run seed`);

  const [a] = await db.insert(schema.analyses).values({ projectId: project.id }).returning();
  console.log(`analysis ${a.id} on "${name}"\n`);
  const t0 = Date.now();
  startAnalysis(a.id, project.id);

  let seen = 0;
  for (;;) {
    const evs = await db.select().from(schema.analysisEvents).where(eq(schema.analysisEvents.analysisId, a.id)).orderBy(asc(schema.analysisEvents.seq));
    for (const e of evs.slice(seen)) {
      const p = e.payload as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (e.type === "step_started") console.log(`\n▶ Step ${p.step}: ${p.name}`);
      else if (e.type === "tool_call") process.stdout.write(`  · ${p.tool}${p.input?.section ? " " + p.input.section : p.input?.query ? ` "${p.input.query}"` : ""}\n`);
      else if (e.type === "gate") console.log(`  ✓ gate: ${p.repairs} repairs, ${p.dropped.length} dropped, ${p.warnings.length} unverified${(p.repair_log ?? []).map((r: string, i: number) => `
      repair ${i + 1}: ${r}`).join("")}${p.dropped.length ? "\n      dropped: " + p.dropped.join("; ") : ""}${p.warnings.length ? "\n      warnings: " + p.warnings.join("; ") : ""}`);
      else if (e.type === "error") console.log(`  ✗ ERROR: ${p.message}`);
    }
    seen = evs.length;
    const [row] = await db.select().from(schema.analyses).where(eq(schema.analyses.id, a.id));
    if (row.status === "done" || row.status === "failed") break;
    await new Promise((r) => setTimeout(r, 1500));
  }

  const [row] = await db.select().from(schema.analyses).where(eq(schema.analyses.id, a.id));
  const steps = await db.select().from(schema.analysisSteps).where(eq(schema.analysisSteps.analysisId, a.id)).orderBy(asc(schema.analysisSteps.stepNo));
  const secs = Math.round((Date.now() - t0) / 1000);

  console.log("\n──────── result ────────");
  console.log(`status: ${row.status}${row.error ? " (" + row.error + ")" : ""} · ${secs}s · ${(row.inputTokens ?? 0) + (row.outputTokens ?? 0)} tokens · est. $${row.costUsd}`);
  for (const s of steps) console.log(`  step ${s.stepNo} ${STEP_NAMES[s.stepNo - 1]}: ${Math.round((s.durationMs ?? 0) / 1000)}s · ${s.inputTokens}+${s.outputTokens} tokens`);

  if (row.status !== "done") {
    await pool.end();
    process.exit(1);
  }

  const get = (n: number) => steps.find((s) => s.stepNo === n)?.output as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const text = JSON.stringify([get(3), get(4), get(5)]).toLowerCase();
  console.log("\nplanted problems found (steps 3-5):");
  let found = 0;
  for (const p of PLANTED) {
    const ok = p.test(text);
    if (ok) found++;
    console.log(`  ${ok ? "✓" : "✗"} #${p.id} ${p.what}`);
  }
  const problems = (get(4)?.problems ?? []) as { id: string; title: string; severity: string; confidence: string }[];
  console.log(`\nproblems (${problems.length}):`);
  problems.forEach((p) => console.log(`  ${p.id} [${p.severity}/${p.confidence}] ${p.title}`));
  const sols = (get(5)?.solutions ?? []) as { id: string; title: string; roi: { gain_low_monthly: number; gain_high_monthly: number } | null; priority: number }[];
  console.log(`\nsolutions (${sols.length}, ranked):`);
  sols.forEach((s) => console.log(`  ${s.id} ${s.title}  ROI ${s.roi ? s.roi.gain_low_monthly + "–" + s.roi.gain_high_monthly + "/mo" : "n/a"}`));

  const pass = found / PLANTED.length >= 0.8 && secs <= 300;
  console.log(`\nAcceptance: ${found}/${PLANTED.length} planted problems (need >= 5), time ${secs}s (target <= 180s, hard limit 300s) -> ${pass ? "PASS" : "FAIL"}`);
  await pool.end();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
