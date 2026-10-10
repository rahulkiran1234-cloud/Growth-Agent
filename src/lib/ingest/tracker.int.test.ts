// Competitor tracker storage against a real database (npm run test:int). Embedding is not called here.
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, schema } from "@/lib/db/client";
import { autoMap } from "./columns";
import { readTable } from "./table";
import { processTracker } from "./tracker-parse";
import { loadTracked, storeTrackerSnapshots } from "./tracker";

let A = "", B = "";
let records: ReturnType<typeof processTracker>["records"] = [];

beforeAll(async () => {
  [A, B] = await Promise.all([db.insert(schema.projects).values({ name: "trk-test A" }).returning(), db.insert(schema.projects).values({ name: "trk-test B" }).returning()]).then((r) => r.map((x) => x[0].id));
  const { headers, rows } = await readTable(readFileSync("fixtures/competitor_tracker_sample.csv"), "t.csv");
  records = processTracker(rows, headers, autoMap("competitor_tracker", headers)).records;
});
afterAll(async () => {
  for (const id of [A, B]) await db.delete(schema.projects).where(eq(schema.projects.id, id));
  await pool.end();
});

describe("competitor tracker storage", () => {
  it("stores your snapshots per competitor and product, oldest first", async () => {
    expect(await storeTrackerSnapshots(A, null, records)).toBe(42);
    const t = await loadTracked(A);
    expect(t.map((p) => p.competitor)).toEqual(["COMP_A", "COMP_B", "COMP_C"]);
    expect(t[0].series).toHaveLength(14);
    expect(t[0].series[0]).toMatchObject({ date: "2025-10-10", price: 279, discount: false, rating: 4.2, stock: "Low Stock" });
    expect(t[0].series[13].date).toBe("2025-10-23");
    expect((await db.select().from(schema.competitors).where(eq(schema.competitors.projectId, A))).map((c) => c.name).sort()).toEqual(["COMP_A", "COMP_B", "COMP_C"]);
  });

  it("re-uploading updates rows instead of duplicating them, and keeps your SKU link", async () => {
    const comp = (await db.select().from(schema.competitors).where(and(eq(schema.competitors.projectId, A), eq(schema.competitors.name, "COMP_A"))))[0];
    await db.update(schema.competitorSnapshots).set({ comparableSku: "SKU-9" }).where(eq(schema.competitorSnapshots.competitorId, comp.id));
    const changed = records.map((r) => (r.competitor === "COMP_A" && r.date === "2025-10-10" ? { ...r, price: 250 } : r));
    await storeTrackerSnapshots(A, null, changed);
    const rows = await db.select().from(schema.competitorSnapshots).where(eq(schema.competitorSnapshots.projectId, A));
    expect(rows).toHaveLength(42);
    const t = await loadTracked(A);
    expect(t[0].series[0].price).toBe(250);
    expect(t[0].comparableSku).toBe("SKU-9");
  });

  it("never shows one project's competitors in another", async () => {
    expect(await loadTracked(B)).toEqual([]);
    await storeTrackerSnapshots(B, null, records.slice(0, 3));
    expect((await loadTracked(B)).length).toBe(3);
    expect((await loadTracked(A)).length).toBe(3);
  });
});
