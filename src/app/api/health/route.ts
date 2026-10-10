import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export async function GET() {
  const r = await db.execute(sql`select count(*)::int as n from pg_extension where extname = 'vector'`);
  return Response.json({ ok: true, pgvector: (r.rows[0] as { n: number }).n > 0 });
}
