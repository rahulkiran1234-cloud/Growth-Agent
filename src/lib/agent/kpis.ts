import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

// All numbers the agent reports come from here (code), never from the LLM's own arithmetic.
export const KPI_SECTIONS = ["revenue_trend", "sku_concentration", "sku_trend", "returns", "ratings", "review_themes"] as const;
export type KpiSection = (typeof KPI_SECTIONS)[number];

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Row[];

export async function sqlKpis(projectId: string, section: KpiSection, skuArg?: string): Promise<unknown> {
  switch (section) {
    case "revenue_trend":
      return rows(sql`
        select to_char(order_date,'YYYY-MM') as month, sum(revenue)::float as revenue, sum(units)::int as units,
               count(*)::int as orders, round((sum(revenue)/nullif(sum(units),0))::numeric,0)::float as avg_realised_price
        from sales where project_id = ${projectId} group by 1 order by 1`);
    case "sku_concentration":
      return rows(sql`
        with t as (select sku, sum(revenue) rev, sum(units) units from sales where project_id = ${projectId} group by sku),
        tot as (select sum(rev) s from t)
        select sku, rev::float as revenue, units::int as units, round((rev/tot.s*100)::numeric,1)::float as share_pct
        from t, tot order by rev desc limit 10`);
    case "sku_trend":
      if (!skuArg) return { error: "sku parameter required for sku_trend" };
      return rows(sql`
        select to_char(order_date,'YYYY-MM') as month, sum(revenue)::float as revenue, sum(units)::int as units,
               round((sum(revenue)/nullif(sum(units),0))::numeric,0)::float as avg_realised_price
        from sales where project_id = ${projectId} and sku = ${skuArg} group by 1 order by 1`);
    case "returns":
      return rows(sql`
        select sku, count(*)::int as orders, round((avg(returned::int)*100)::numeric,1)::float as return_rate_pct
        from sales where project_id = ${projectId} group by sku having count(*) >= 20
        order by avg(returned::int) desc limit 8`);
    case "ratings":
      return rows(sql`
        select to_char(review_date,'YYYY-MM') as month, count(*)::int as reviews,
               round(avg(rating)::numeric,2)::float as avg_rating,
               round((avg((rating<=3)::int)*100)::numeric,1)::float as low_rating_pct
        from reviews where project_id = ${projectId} group by 1 order by 1`);
    case "review_themes": {
      const [t] = await rows(sql`select count(*) filter (where topics is not null)::int as tagged, count(*)::int as total from reviews where project_id = ${projectId} and rating <= 3`);
      if (Number(t.tagged) > 0) {
        // LLM-tagged topics (set during ingestion); counts are over 1-3 star reviews.
        return {
          low_rating_reviews: t.total, tagged_reviews: t.tagged, method: "llm_topic_tags",
          topics: await rows(sql`
            select topic, count(*)::int as count, round((count(*)*100.0/${Number(t.tagged)})::numeric,1)::float as pct_of_low_reviews
            from reviews, unnest(topics) as topic
            where project_id = ${projectId} and rating <= 3 group by topic order by count desc`),
        };
      }
      return rows(sql`
        with low as (select body from reviews where project_id = ${projectId} and rating <= 3)
        select (select count(*) from low)::int as low_rating_reviews, 'keyword_match' as method,
          (select count(*) from low where body ~* 'size|small|fit')::int as sizing,
          (select count(*) from low where body ~* 'damag|packag|crush|dent|broken|scratch')::int as packaging,
          (select count(*) from low where body ~* 'deliver|slow|shipping')::int as delivery,
          (select count(*) from low where body ~* 'quality|average|okay')::int as quality,
          (select count(*) from low where body ~* 'support|reply')::int as support`);
    }
  }
}
