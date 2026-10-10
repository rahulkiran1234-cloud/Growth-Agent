import { config } from "dotenv";
config({ path: ".env.local" });
import { Client } from "pg";

async function main() {
  const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const v = await db.query("select count(*)::int n from pg_extension where extname='vector'");
  console.log("Supabase:", "connected, pgvector:", v.rows[0].n > 0);
  await db.end();

  const a = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL_FAST ?? "claude-haiku-4-5-20251001",
      max_tokens: 8,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
  console.log("Anthropic:", a.status);

  const e = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ input: ["hello"], model: "voyage-3.5" }),
  });
  const j = (await e.json()) as { data?: { embedding: number[] }[] };
  console.log("Voyage:", e.status, "dim", j.data?.[0]?.embedding.length);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
