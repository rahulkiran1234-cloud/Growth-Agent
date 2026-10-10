import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { AdRecord } from "./ads-parse";
import { computeAds, type AdDay, type AdsModel } from "@/lib/insights/ads";
import { loadTracked } from "./tracker";

/** Saves ad rows. Re-uploading the same day, SKU and campaign replaces that row, so fresh exports can overlap old ones. */
export async function storeAdRows(projectId: string, uploadId: string | null, records: AdRecord[]): Promise<number> {
  const t = schema.adDaily;
  for (let i = 0; i < records.length; i += 500) {
    await db.insert(t).values(records.slice(i, i + 500).map((r) => ({
      projectId, uploadId, day: r.date, sku: r.sku, campaign: r.campaign, productName: r.productName, impressions: r.impressions,
      clicks: r.clicks, spend: r.spend.toFixed(2), orders: r.orders, units: r.units, adSales: r.adSales.toFixed(2),
    }))).onConflictDoUpdate({
      target: [t.projectId, t.day, t.sku, t.campaign],
      set: {
        uploadId: sql`excluded.upload_id`, productName: sql`excluded.product_name`, impressions: sql`excluded.impressions`, clicks: sql`excluded.clicks`,
        spend: sql`excluded.spend`, orders: sql`excluded.orders`, units: sql`excluded.units`, adSales: sql`excluded.ad_sales`,
      },
    });
  }
  return records.length;
}

export type { AdDay };

export async function loadAdDays(projectId: string): Promise<{ days: AdDay[]; names: Record<string, string>; campaigns: number }> {
  // Ads and sales are joined by day and SKU (full join, so days a SKU sold without ads still count toward its total sales).
  const r = await db.execute(sql`
    with a as (
      select day, sku, sum(impressions)::int as imp, sum(clicks)::int as clk, sum(spend)::float8 as spend, sum(orders)::int as ord,
             sum(units)::int as units, sum(ad_sales)::float8 as sales, max(product_name) as name, count(distinct campaign)::int as campaigns
      from ad_daily where project_id = ${projectId} group by day, sku),
    r as (
      select order_date as day, sku, sum(revenue)::float8 as rev, sum(units)::int as su from sales
      where project_id = ${projectId} and sku in (select sku from a)
        and order_date between (select min(day) from a) and (select max(day) from a)
      group by order_date, sku)
    select coalesce(a.day, r.day)::text as d, coalesce(a.sku, r.sku) as sku, coalesce(a.imp, 0) as imp, coalesce(a.clk, 0) as clk,
           coalesce(a.spend, 0) as spend, coalesce(a.ord, 0) as ord, coalesce(a.units, 0) as units, coalesce(a.sales, 0) as sales,
           coalesce(r.rev, 0) as rev, coalesce(r.su, 0) as su, a.name, coalesce(a.campaigns, 0) as campaigns
    from a full join r on a.day = r.day and a.sku = r.sku order by 1, 2`);
  const names: Record<string, string> = {};
  let campaigns = 0;
  const days = (r.rows as (AdDay & { name: string | null; campaigns: number })[]).map((x) => {
    if (x.name) names[x.sku] = x.name;
    campaigns = Math.max(campaigns, x.campaigns);
    return { d: x.d, sku: x.sku, imp: x.imp, clk: x.clk, spend: x.spend, ord: x.ord, units: x.units, sales: x.sales, rev: x.rev, su: x.su };
  });
  return { days, names, campaigns };
}

export async function loadUnitProfit(projectId: string): Promise<Record<string, number>> {
  const rows = await db.select().from(schema.skuProfit).where(eq(schema.skuProfit.projectId, projectId)).orderBy(asc(schema.skuProfit.sku));
  return Object.fromEntries(rows.map((r) => [r.sku, Number(r.unitProfit)]));
}

/** The full ad advice for a project (same maths the Ads screen runs in the browser), or null when no ads are uploaded. */
export async function adAdvice(projectId: string): Promise<AdsModel | null> {
  const [{ days, names }, unitProfit, tracked, rated] = await Promise.all([
    loadAdDays(projectId), loadUnitProfit(projectId), loadTracked(projectId),
    db.execute(sql`
      select sku, sum(rating)::float8 as rs, count(*)::int as n from reviews
      where project_id = ${projectId} and sku is not null
        and review_date >= (select max(review_date) - 90 from reviews where project_id = ${projectId})
      group by sku`),
  ]);
  const ratings = Object.fromEntries((rated.rows as { sku: string; rs: number; n: number }[]).map((r) => [r.sku, { rs: r.rs, n: r.n }]));
  return computeAds({ days, names, unitProfit, ratings, tracked });
}
