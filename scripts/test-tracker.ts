// Competitor tracker through the whole analysis (real model, ~$0.30): npm run test:tracker
// Adds tracker data in the supported format to a copy of the demo seller, runs the 6-step agent, and checks that
// tracker facts were found, quoted from their passage, and used in the comparison. Cleans up after itself.
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { asc, eq, inArray } from "drizzle-orm";

async function main() {
  const { db, schema, pool } = await import("../src/lib/db/client");
  const { cloneProject, deleteProject, SOURCE_PROJECT } = await import("../src/lib/projects");
  const { readTable } = await import("../src/lib/ingest/table");
  const { autoMap } = await import("../src/lib/ingest/columns");
  const { processTracker } = await import("../src/lib/ingest/tracker-parse");
  const { storeTrackerSnapshots, rebuildTrackerDocs } = await import("../src/lib/ingest/tracker");
  const { startAnalysis } = await import("../src/lib/agent/run");

  const [src] = await db.select().from(schema.projects).where(eq(schema.projects.name, SOURCE_PROJECT));
  if (!src) throw new Error("Run npm run seed first");
  const pid = await cloneProject(src.id, `Tracker test ${Date.now()}`);

  let pass = false;
  try {
    const { headers, rows } = await readTable(readFileSync("fixtures/competitor_tracker_sample.csv"), "competitor_tracker_sample.csv");
    const t = processTracker(rows, headers, autoMap("competitor_tracker", headers));
    if (t.report.blockers.length) throw new Error(t.report.blockers.join(" "));
    // The demo seller sells lamps and rugs, so make COMP_A's product a comparable lamp (priced near the seller's SKU-01)
    // and link it, as a seller would on the Competitors screen. The other two stay unlinked, tracked on their own.
    const linked = t.records.map((r) => (r.competitor === "COMP_A" ? { ...r, product: "HomePro Lamp 1", category: "Lamps", price: Math.round(r.price * 4.7), comparableSku: "SKU-01" } : r));
    await storeTrackerSnapshots(pid, null, linked);
    const idx = await rebuildTrackerDocs(pid);
    console.log(`tracker stored: ${linked.length} snapshots, ${idx.chunks} summary passages; running the analysis…`);

    const [a] = await db.insert(schema.analyses).values({ projectId: pid }).returning();
    startAnalysis(a.id, pid);
    for (;;) {
      const [row] = await db.select().from(schema.analyses).where(eq(schema.analyses.id, a.id));
      if (row.status === "done" || row.status === "failed") break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const [row] = await db.select().from(schema.analyses).where(eq(schema.analyses.id, a.id));
    const steps = await db.select().from(schema.analysisSteps).where(eq(schema.analysisSteps.analysisId, a.id)).orderBy(asc(schema.analysisSteps.stepNo));
    const out = (n: number) => steps.find((s) => s.stepNo === n)?.output as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any

    // Which cited passages are tracker summaries?
    const ids = new Set<string>();
    for (const c of out(2)?.competitors ?? []) for (const f of c.findings) ids.add(f.source_id);
    for (const r of out(3)?.comparison ?? []) for (const c of r.competitors) if (c.source_id) ids.add(c.source_id);
    const nums = [...ids].map((s) => Number(s.split(":")[1])).filter(Number.isFinite);
    const chunks = nums.length ? await db.select().from(schema.chunks).where(inArray(schema.chunks.id, nums)) : [];
    const isTracker = new Set(chunks.filter((c) => c.content.startsWith("Competitor tracker:")).map((c) => `chunk:${c.id}`));

    const trackerFindings = (out(2)?.competitors ?? []).flatMap((c: any) => c.findings.filter((f: any) => isTracker.has(f.source_id)).map((f: any) => ({ comp: c.name, ...f }))); // eslint-disable-line @typescript-eslint/no-explicit-any
    const trackerRows = (out(3)?.comparison ?? []).filter((r: any) => r.competitors.some((c: any) => c.source_id && isTracker.has(c.source_id))); // eslint-disable-line @typescript-eslint/no-explicit-any

    const checks: [string, boolean][] = [
      ["analysis completed", row.status === "done"],
      ["step 2 kept at least 2 findings quoted from tracker passages", trackerFindings.length >= 2],
      ["tracker findings are filed under the right competitors", trackerFindings.every((f: any) => /^COMP_[ABC]$/.test(f.comp))], // eslint-disable-line @typescript-eslint/no-explicit-any
      ["step 3 comparison uses tracker data", trackerRows.length >= 1],
      ["the linked product is compared against SKU-01 using its tracker price", trackerRows.some((r: any) => /price/i.test(r.attribute) && r.competitors.some((c: any) => c.name === "COMP_A" && c.source_id && isTracker.has(c.source_id)))], // eslint-disable-line @typescript-eslint/no-explicit-any
      ["problems were still found (at least 3)", (out(4)?.problems ?? []).length >= 3],
    ];
    console.log("\nStep 2 competitors:", (out(2)?.competitors ?? []).map((c: any) => `${c.name}=${c.findings.length}`).join(", ") || "none"); // eslint-disable-line @typescript-eslint/no-explicit-any
    const gates = await db.select().from(schema.analysisEvents).where(eq(schema.analysisEvents.analysisId, a.id));
    for (const g of gates.filter((e) => e.type === "gate" && (e.payload as { step: number }).step === 2)) {
      const gp = g.payload as { repairs: number; dropped: string[]; repair_log?: string[] };
      console.log(`Step 2 gate: repairs=${gp.repairs} dropped=${gp.dropped.length}`, gp.dropped.slice(0, 4), gp.repair_log?.slice(0, 3));
    }
    console.log(`\nTracker findings kept: ${trackerFindings.map((f: any) => `${f.comp}/${f.topic}`).join(", ") || "none"}`); // eslint-disable-line @typescript-eslint/no-explicit-any
    console.log(`Comparison rows citing tracker passages: ${trackerRows.map((r: any) => r.attribute).join(" | ") || "none"}`); // eslint-disable-line @typescript-eslint/no-explicit-any
    console.log("\nchecks:");
    for (const [n, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${n}`);
    pass = checks.every(([, ok]) => ok);
    console.log(`\nTracker analysis test -> ${pass ? "PASS" : "FAIL"} (est. $${row.costUsd})`);
  } finally {
    await deleteProject(pid);
    await pool.end();
  }
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
