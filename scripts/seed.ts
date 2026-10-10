// Loads the Acme Home fixtures into Supabase under a demo project. Idempotent.
import { config } from "dotenv";
config({ path: ".env.local" });
import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { Client } from "pg";

const DEMO = "Acme Home (demo)";

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("delete from projects where name = $1", [DEMO]);
  const { rows } = await c.query("insert into projects (name, goal) values ($1, 'revenue') returning id", [DEMO]);
  const pid: string = rows[0].id;

  const sales = parse(readFileSync("fixtures/acme_sales.csv"), { columns: true }) as Record<string, string>[];
  const reviews = parse(readFileSync("fixtures/acme_reviews.csv"), { columns: true }) as Record<string, string>[];

  const batch = async (table: string, cols: string[], data: unknown[][]) => {
    for (let i = 0; i < data.length; i += 500) {
      const slice = data.slice(i, i + 500);
      const ph = slice.map((_, r) => `(${cols.map((_, k) => `$${r * cols.length + k + 1}`).join(",")})`).join(",");
      await c.query(`insert into ${table} (${cols.join(",")}) values ${ph}`, slice.flat());
    }
  };

  await batch(
    "sales",
    ["project_id", "order_date", "sku", "units", "revenue", "price", "returned", "customer_hash"],
    sales.map((r) => [pid, r.order_date, r.sku, +r.units, +r.revenue, +r.price, r.returned === "1", r.customer_id]),
  );
  await batch(
    "reviews",
    ["project_id", "review_date", "sku", "rating", "body"],
    reviews.map((r) => [pid, r.review_date, r.sku, +r.rating, r.text]),
  );
  console.log(`Seeded project ${pid}: ${sales.length} sales, ${reviews.length} reviews`);
  await c.end();

  // Make the demo complete: AI topic tags for reviews + the two competitor documents.
  const { tagReviews } = await import("../src/lib/ingest/tag-reviews");
  const { parseDocument } = await import("../src/lib/ingest/docs");
  const { storeParsedDoc } = await import("../src/lib/ingest/store-doc");
  const { pool } = await import("../src/lib/db/client");
  const t = await tagReviews(pid);
  console.log(`tagged ${t.tagged} reviews`);
  const docs = [
    { competitor: "UrbanHaus", file: "fixtures/competitor_urbanhaus_catalogue.pdf", date: null },
    { competitor: "BrightNest", file: "fixtures/competitor_brightnest_prices.csv", date: "2026-09-20" }, // the price sheet has no date column
  ];
  for (const d of docs) {
    const name = d.file.split("/").pop()!;
    const parsed = await parseDocument(readFileSync(d.file), name);
    const r = await storeParsedDoc({ projectId: pid, uploadId: null, competitorName: d.competitor, title: name, parsed, docDate: d.date ?? parsed.docDate });
    console.log(`ingested ${name}: ${r.chunks} chunks`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
