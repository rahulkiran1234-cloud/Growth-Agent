import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sqlKpis } from "@/lib/agent/kpis";

// Structured KPI snapshot used for the day-30 re-check. Computed by code from the seller's data (never by the model),
// frozen when the seller adopts an action, and recomputed after they re-upload fresh files.
import type { Metric } from "./metrics-pure";
export type { Metric } from "./metrics-pure";
export type Snapshot = { metrics: Metric[]; dataThrough: { sales: string | null; reviews: string | null } };

type Row = Record<string, unknown>;
const num = (v: unknown) => (v == null ? null : Number(v));

export async function computeSnapshot(projectId: string): Promise<Snapshot> {
  const m: Metric[] = [];

  const trend = (await sqlKpis(projectId, "revenue_trend")) as Row[];
  const last = trend[trend.length - 1];
  if (last) {
    const period = String(last.month);
    m.push({ key: "revenue_latest_month", label: "Revenue, latest month", value: Number(last.revenue), unit: "money", better: "up", period });
    if (num(last.avg_realised_price) != null) m.push({ key: "avg_price_latest_month", label: "Avg realised price, latest month", value: Number(last.avg_realised_price), unit: "money", better: "up", period });
  }

  const [ret] = (await db.execute(sql`select round((avg(returned::int)*100)::numeric,1)::float as r from sales where project_id = ${projectId}`)).rows as Row[];
  if (num(ret?.r) != null) m.push({ key: "return_rate", label: "Return rate (all orders)", value: Number(ret.r), unit: "pct", better: "down" });

  const [rt] = (await db.execute(sql`
    select round(avg(rating)::numeric,2)::float as avg, round((avg((rating<=3)::int)*100)::numeric,1)::float as low from reviews where project_id = ${projectId}`)).rows as Row[];
  if (num(rt?.avg) != null) {
    m.push({ key: "avg_rating", label: "Average rating (all reviews)", value: Number(rt.avg), unit: "rating", better: "up" });
    m.push({ key: "low_rating_pct", label: "Reviews rated 1-3 stars", value: Number(rt.low), unit: "pct", better: "down" });
  }

  const conc = (await sqlKpis(projectId, "sku_concentration")) as Row[];
  if (conc[0]) m.push({ key: "top_sku_share", label: "Share of revenue from the top product", value: Number(conc[0].share_pct), unit: "pct", better: "down" });

  const themes = (await sqlKpis(projectId, "review_themes")) as { method?: string; topics?: { topic: string; pct_of_low_reviews: number }[] };
  if (themes?.method === "llm_topic_tags") {
    for (const t of (themes.topics ?? []).slice(0, 5)) {
      m.push({ key: `topic:${t.topic}`, label: `Low reviews mentioning "${t.topic}"`, value: Number(t.pct_of_low_reviews), unit: "pct", better: "down" });
    }
  }

  const [d] = (await db.execute(sql`
    select (select max(order_date)::text from sales where project_id = ${projectId}) as s,
           (select max(review_date)::text from reviews where project_id = ${projectId}) as r`)).rows as Row[];
  return { metrics: m, dataThrough: { sales: (d?.s as string) ?? null, reviews: (d?.r as string) ?? null } };
}
