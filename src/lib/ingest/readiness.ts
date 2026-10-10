import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export type Readiness = {
  ready: boolean;
  problems: string[];
  counts: { sales: number; reviews: number; chunks: number; competitors: number; salesDays: number };
};

// The quality gate for running an analysis: refuse to analyse data too thin to be trustworthy.
export async function readiness(projectId: string): Promise<Readiness> {
  const r = (await db.execute(sql`
    select
      (select count(*)::int from sales where project_id = ${projectId}) as sales,
      (select count(*)::int from reviews where project_id = ${projectId}) as reviews,
      (select count(*)::int from chunks where project_id = ${projectId}) as chunks,
      (select count(*)::int from competitors where project_id = ${projectId}) as competitors,
      coalesce((select (max(order_date) - min(order_date) + 1)::int from sales where project_id = ${projectId}), 0) as sales_days`)).rows[0] as Record<string, number>;
  const counts = { sales: r.sales, reviews: r.reviews, chunks: r.chunks, competitors: r.competitors, salesDays: r.sales_days };
  const problems: string[] = [];
  if (counts.sales < 100) problems.push("Upload a sales CSV (at least 100 orders).");
  else if (counts.salesDays < 30) problems.push("Sales history must span at least 30 days.");
  return { ready: problems.length === 0, problems, counts };
}
