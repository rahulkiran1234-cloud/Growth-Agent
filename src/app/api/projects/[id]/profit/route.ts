import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { guardProject } from "@/lib/auth/access";
import { limited } from "@/lib/rate-limit";

// Profit per unit the seller earns on a SKU before paying for ads. Sets the break-even ad cost for that SKU.
const Body = z.object({ sku: z.string().trim().min(1).max(120), unitProfit: z.number().min(0).max(10_000_000).nullable() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardProject(id);
  if (g instanceof Response) return g;
  const blocked = limited(req, "profit", 120);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a profit per unit of 0 or more." }, { status: 400 });
  const { sku, unitProfit } = parsed.data;

  if (unitProfit === null) { // clearing the value goes back to the assumed margin
    await db.delete(schema.skuProfit).where(and(eq(schema.skuProfit.projectId, id), eq(schema.skuProfit.sku, sku)));
    return Response.json({ ok: true });
  }
  // Only SKUs that exist in this project's ads or sales can be given a profit, so nobody can fill the table with junk.
  const known = await db.execute(sql`select 1 from ad_daily where project_id = ${id} and sku = ${sku} limit 1`);
  if (known.rows.length === 0) {
    const inSales = await db.execute(sql`select 1 from sales where project_id = ${id} and sku = ${sku} limit 1`);
    if (inSales.rows.length === 0) return Response.json({ error: "That SKU is not in this project's data." }, { status: 400 });
  }
  await db.insert(schema.skuProfit).values({ projectId: id, sku, unitProfit: unitProfit.toFixed(2) })
    .onConflictDoUpdate({ target: [schema.skuProfit.projectId, schema.skuProfit.sku], set: { unitProfit: unitProfit.toFixed(2), updatedAt: new Date() } });
  return Response.json({ ok: true });
}
