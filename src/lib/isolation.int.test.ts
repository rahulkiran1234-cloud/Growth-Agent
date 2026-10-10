// Database-backed isolation tests (npm run test:int). There are no user accounts in this demo, so the
// isolation boundary is the PROJECT: nothing queried for one project may ever surface another's data.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool, schema } from "@/lib/db/client";
import { hybridSearch } from "@/lib/rag/search";
import { resolveCitations } from "@/lib/rag/citations";
import { sqlKpis } from "@/lib/agent/kpis";
import { readiness } from "@/lib/ingest/readiness";
import { deleteProject } from "@/lib/projects";
import { loadFile, saveFile } from "@/lib/ingest/store";

const unit = (i: number) => Array.from({ length: 1024 }, (_, k) => (k === i ? 1 : 0));
const created: string[] = [];

let A: string, B: string, chunkA: number, fileKey: string;

async function makeProject(name: string) {
  const [p] = await db.insert(schema.projects).values({ name }).returning();
  created.push(p.id);
  return p.id;
}

beforeAll(async () => {
  A = await makeProject("iso-test A");
  B = await makeProject("iso-test B");

  // A has sales, a competitor document with a distinctive chunk, and an uploaded file.
  const rows = Array.from({ length: 120 }, (_, i) => ({ projectId: A, orderDate: `2026-0${1 + (i % 3)}-${String(1 + (i % 28)).padStart(2, "0")}`, sku: "SKU-A", units: 1, revenue: "100.00", price: "100.00" }));
  await db.insert(schema.sales).values(rows);
  const [comp] = await db.insert(schema.competitors).values({ projectId: A, name: "AlphaCo" }).returning();
  const [doc] = await db.insert(schema.documents).values({ projectId: A, competitorId: comp.id, title: "alpha.txt", docType: "text", docDate: "2026-09-01" }).returning();
  const [chunk] = await db.insert(schema.chunks).values({ projectId: A, documentId: doc.id, content: "UNIQUEALPHATOKEN offers free shipping above 999 rupees", page: 1, embedding: unit(0) }).returning();
  chunkA = chunk.id;

  // B has a little data of its own, so we can prove deleting A leaves it alone.
  await db.insert(schema.sales).values({ projectId: B, orderDate: "2026-02-01", sku: "SKU-B", units: 1, revenue: "5.00", price: "5.00" });

  fileKey = await saveFile("iso-test", "a.csv", Buffer.from("a,b\n1,2"));
  await db.insert(schema.uploads).values({ projectId: A, kind: "sales", filename: "a.csv", storageKey: fileKey, status: "ready" });
});

afterAll(async () => {
  for (const id of created) await db.delete(schema.projects).where(eq(schema.projects.id, id));
  await pool.end();
});

describe("project isolation", () => {
  it("search returns a project's own passages but never another project's", async () => {
    const own = await hybridSearch({ projectId: A, query: "UNIQUEALPHATOKEN free shipping", queryEmbedding: unit(0), k: 5 });
    expect(own.map((h) => h.chunkId)).toContain(chunkA);

    // Same query, identical embedding, other project: nothing. Also with a competitor filter that exists only in A.
    expect(await hybridSearch({ projectId: B, query: "UNIQUEALPHATOKEN free shipping", queryEmbedding: unit(0), k: 5 })).toEqual([]);
    expect(await hybridSearch({ projectId: B, query: "UNIQUEALPHATOKEN", competitor: "AlphaCo", queryEmbedding: unit(0), k: 5 })).toEqual([]);
    expect(await hybridSearch({ projectId: B, query: "UNIQUEALPHATOKEN", mode: "keyword", k: 5 })).toEqual([]);
  });

  it("a citation id from one project does not resolve in another", async () => {
    const id = `chunk:${chunkA}`;
    expect((await resolveCitations(A, [id])).found).toHaveLength(1);
    const other = await resolveCitations(B, [id]);
    expect(other.found).toEqual([]);
    expect(other.missing).toEqual([id]);
  });

  it("seller KPIs only count that project's data", async () => {
    expect(((await sqlKpis(A, "revenue_trend")) as unknown[]).length).toBeGreaterThan(0);
    const b = (await sqlKpis(B, "sku_concentration")) as { sku: string }[];
    expect(b.map((r) => r.sku)).toEqual(["SKU-B"]);
  });

  it("readiness reflects each project separately", async () => {
    expect((await readiness(A)).counts.sales).toBe(120);
    expect((await readiness(B)).ready).toBe(false);
  });
});

describe("delete my data", () => {
  it("refuses while an analysis is running", async () => {
    const [a] = await db.insert(schema.analyses).values({ projectId: A, status: "running" }).returning();
    const r = await deleteProject(A);
    expect(r.ok).toBe(false);
    await db.update(schema.analyses).set({ status: "failed" }).where(eq(schema.analyses.id, a.id));
  });

  it("removes every row and file for the project and leaves other projects untouched", async () => {
    const r = await deleteProject(A);
    expect(r).toEqual({ ok: true, files: 1 });

    for (const [table, col] of [
      [schema.sales, schema.sales.projectId], [schema.reviews, schema.reviews.projectId], [schema.competitors, schema.competitors.projectId],
      [schema.documents, schema.documents.projectId], [schema.competitorSnapshots, schema.competitorSnapshots.projectId], [schema.chunks, schema.chunks.projectId], [schema.uploads, schema.uploads.projectId], [schema.analyses, schema.analyses.projectId],
    ] as const) {
      expect(await db.select().from(table).where(eq(col, A)), `table not empty for project A`).toEqual([]);
    }
    expect(await db.select().from(schema.projects).where(eq(schema.projects.id, A))).toEqual([]);
    await expect(loadFile(fileKey)).rejects.toThrow();

    // B is untouched
    expect((await readiness(B)).counts.sales).toBe(1);
  });
});
