import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { Insights, Quote, ReviewRow, SkuSeries } from "./types";
import { POSITIVE_THEMES } from "./reviews";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>) => (await db.execute(s)).rows as Row[];

/** All chart data for a project in a handful of queries (a few hundred rows). */
export async function computeInsights(projectId: string): Promise<Insights> {
  const salesRows = await q(sql`
    select to_char(order_date,'YYYY-MM') as m, sku, sum(revenue)::float as revenue, sum(units)::int as units,
           count(*)::int as orders, sum(returned::int)::int as returned
    from sales where project_id = ${projectId} group by 1, 2 order by 1, 2`);
  const revMonths = await q(sql`select distinct to_char(review_date,'YYYY-MM') as m from reviews where project_id = ${projectId}`);

  const monthSet = new Set<string>([...salesRows.map((r) => String(r.m)), ...revMonths.map((r) => String(r.m))]);
  const months = [...monthSet].sort();
  const mi = new Map(months.map((m, i) => [m, i]));

  const bySku = new Map<string, SkuSeries>();
  for (const r of salesRows) {
    const sku = String(r.sku);
    let s = bySku.get(sku);
    if (!s) bySku.set(sku, (s = { sku, revenue: Array(months.length).fill(0), units: Array(months.length).fill(0), orders: Array(months.length).fill(0), returned: Array(months.length).fill(0) }));
    const i = mi.get(String(r.m))!;
    s.revenue[i] = Number(r.revenue); s.units[i] = Number(r.units); s.orders[i] = Number(r.orders); s.returned[i] = Number(r.returned);
  }
  const skus = [...bySku.values()].sort((a, b) => sum(b.revenue) - sum(a.revenue));

  // One FILTER per praise keyword bucket (regexes are constants from code, never user input).
  const posCols = sql.join(Object.entries(POSITIVE_THEMES).map(([k, t]) => sql`count(*) filter (where rating >= 4 and body ~* ${t.re})::int as ${sql.raw(`pos_${k}`)}`), sql`, `);
  const revBase = await q(sql`
    select to_char(review_date,'YYYY-MM') as m, sku, count(*)::int as n, sum(rating)::int as rs,
           count(*) filter (where rating <= 3)::int as low, count(*) filter (where rating <= 3 and topics is not null)::int as tagged,
           count(*) filter (where rating >= 4)::int as pos_n, ${posCols}
    from reviews where project_id = ${projectId} group by 1, 2`);
  const revTopics = await q(sql`
    select to_char(review_date,'YYYY-MM') as m, sku, topic, count(*)::int as c
    from reviews, unnest(topics) as topic where project_id = ${projectId} and rating <= 3 group by 1, 2, 3`);
  const rows = new Map<string, ReviewRow>();
  const key = (m: string, sku: unknown) => `${m}|${sku ?? ""}`;
  for (const r of revBase) {
    const pos: Record<string, number> = {};
    for (const k of Object.keys(POSITIVE_THEMES)) { const c = Number(r[`pos_${k}`] ?? 0); if (c > 0) pos[k] = c; }
    rows.set(key(String(r.m), r.sku), { m: mi.get(String(r.m))!, sku: (r.sku as string) ?? null, n: Number(r.n), rs: Number(r.rs), low: Number(r.low), tagged: Number(r.tagged), t: {}, posN: Number(r.pos_n), pos });
  }
  for (const r of revTopics) rows.get(key(String(r.m), r.sku))!.t[String(r.topic)] = Number(r.c);

  // A few real, recent low-rated reviews per topic: the "voice of the customer" wall.
  const qs = await q(sql`
    select topic, rating, review_date::text as d, sku, left(body, 240) as body from (
      select topic, rating, review_date, sku, body,
             row_number() over (partition by topic order by review_date desc, id desc) as rn
      from reviews, unnest(topics) as topic where project_id = ${projectId} and rating <= 3 and length(body) > 20) t
    where rn <= 3`);
  const quotes: Record<string, Quote[]> = {};
  for (const r of qs) (quotes[String(r.topic)] ??= []).push({ rating: Number(r.rating), date: String(r.d), sku: (r.sku as string) ?? null, text: String(r.body) });

  const pq = await q(sql`
    select distinct on (body) rating, review_date::text as d, sku, left(body, 240) as body
    from reviews where project_id = ${projectId} and rating = 5 and length(body) > 25
    order by body, review_date desc`);
  const praise: Quote[] = pq.map((r) => ({ rating: Number(r.rating), date: String(r.d), sku: (r.sku as string) ?? null, text: String(r.body) }))
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

  const [d] = await q(sql`select (select max(order_date)::text from sales where project_id = ${projectId}) as s,
                                 (select max(review_date)::text from reviews where project_id = ${projectId}) as r,
                                 (select count(*)::int from sales where project_id = ${projectId}) as ns,
                                 (select count(*)::int from reviews where project_id = ${projectId}) as nr`);
  return {
    months, skus, reviewRows: [...rows.values()], quotes, praise,
    dataThrough: { sales: (d?.s as string) ?? null, reviews: (d?.r as string) ?? null },
    counts: { sales: Number(d?.ns ?? 0), reviews: Number(d?.nr ?? 0), skus: skus.length },
  };
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
