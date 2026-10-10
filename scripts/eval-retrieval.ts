// Retrieval evaluation: npm run eval:rag [-- --reingest]
// Builds (once) a dedicated "RAG eval corpus" project from the fixture documents, then measures
// recall@3, recall@8 and MRR for keyword-only, vector-only and hybrid search.
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";

const NAME = "RAG eval corpus";
const DOCS: { competitor: string; file: string }[] = [
  { competitor: "UrbanHaus", file: "fixtures/competitor_urbanhaus_catalogue.txt" },
  { competitor: "NestCo", file: "fixtures/competitor_nestco_catalogue.txt" },
  { competitor: "BrightNest", file: "fixtures/competitor_brightnest_policies.txt" },
  { competitor: "BrightNest", file: "fixtures/competitor_brightnest_prices.csv" },
];
const K_TARGET = 0.85;

async function main() {
  const { db, schema, pool } = await import("../src/lib/db/client");
  const { parseDocument } = await import("../src/lib/ingest/docs");
  const { storeParsedDoc } = await import("../src/lib/ingest/store-doc");
  const { hybridSearch } = await import("../src/lib/rag/search");
  const { embed } = await import("../src/lib/rag/voyage");

  const reingest = process.argv.includes("--reingest");
  let [project] = await db.select().from(schema.projects).where(eq(schema.projects.name, NAME));
  if (project && reingest) {
    await db.delete(schema.projects).where(eq(schema.projects.id, project.id));
    project = undefined as never;
  }
  if (!project) {
    [project] = await db.insert(schema.projects).values({ name: NAME }).returning();
    for (const d of DOCS) {
      const name = d.file.split("/").pop()!;
      const parsed = await parseDocument(readFileSync(d.file), name);
      const r = await storeParsedDoc({ projectId: project.id, uploadId: null, competitorName: d.competitor, title: name, parsed, docDate: parsed.docDate });
      console.log(`ingested ${name}: ${r.chunks} chunks`);
    }
  } else console.log("using existing corpus (pass --reingest to rebuild)");

  const questions = JSON.parse(readFileSync("fixtures/rag-eval.json", "utf8")) as { question: string; regex: string; competitor?: string }[];
  // One embedding request for all queries (the free Voyage tier allows only 3 requests/minute).
  const qvecs = await embed(questions.map((x) => x.question), "query");

  const modes = ["keyword", "vector", "hybrid"] as const;
  const summary: Record<string, { r3: number; r8: number; mrr: number }> = {};
  const misses: Record<string, string[]> = {};

  for (const mode of modes) {
    let r3 = 0, r8 = 0, mrr = 0;
    misses[mode] = [];
    for (let i = 0; i < questions.length; i++) {
      const x = questions[i];
      const hits = await hybridSearch({ projectId: project.id, query: x.question, k: 8, mode, queryEmbedding: qvecs[i] });
      const re = new RegExp(x.regex, "i");
      const rank = hits.findIndex((h) => re.test(h.content) && (!x.competitor || h.competitor.toLowerCase() === x.competitor.toLowerCase()));
      if (rank >= 0) {
        r8++;
        if (rank < 3) r3++;
        mrr += 1 / (rank + 1);
      } else misses[mode].push(x.question);
    }
    const n = questions.length;
    summary[mode] = { r3: r3 / n, r8: r8 / n, mrr: mrr / n };
  }

  console.log("\nmode      recall@3  recall@8  MRR");
  for (const m of modes) {
    const s = summary[m];
    console.log(`${m.padEnd(9)} ${s.r3.toFixed(2).padStart(8)}  ${s.r8.toFixed(2).padStart(8)}  ${s.mrr.toFixed(2)}`);
  }
  for (const m of modes) if (misses[m].length) console.log(`\n${m} missed:\n - ${misses[m].join("\n - ")}`);

  const pass = summary.hybrid.r8 >= K_TARGET;
  console.log(`\nTarget: hybrid recall@8 >= ${K_TARGET} -> ${pass ? "PASS" : "FAIL"}`);
  await pool.end();
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
