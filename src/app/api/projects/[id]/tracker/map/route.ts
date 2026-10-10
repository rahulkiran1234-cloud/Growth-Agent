import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { notFound } from "@/lib/ids";
import { limited } from "@/lib/rate-limit";
import { guardProject } from "@/lib/auth/access";
import { rebuildTrackerDocs } from "@/lib/ingest/tracker";

const Body = z.object({ competitor: z.string().min(1).max(120), product: z.string().min(1).max(240), sku: z.string().max(120).nullable() });

// "This competitor product competes with my SKU-01": saved on the product's snapshots, then the AI-readable
// summaries are rebuilt so the next analysis knows which of your products to compare it with.
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardProject(id);
  if (g instanceof Response) return g;
  const blocked = limited(req, "trackermap", 30);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  const { competitor, product, sku } = parsed.data;

  if (sku) {
    const known = await db.execute(sql`select 1 from sales where project_id = ${id} and sku = ${sku} limit 1`);
    if (known.rows.length === 0) return Response.json({ error: `${sku} is not one of your products.` }, { status: 400 });
  }
  const [comp] = await db.select().from(schema.competitors).where(and(eq(schema.competitors.projectId, id), sql`lower(${schema.competitors.name}) = lower(${competitor})`));
  if (!comp) return notFound();
  const t = schema.competitorSnapshots;
  const res = await db.update(t).set({ comparableSku: sku }).where(and(eq(t.projectId, id), eq(t.competitorId, comp.id), eq(t.product, product))).returning({ id: t.id });
  if (res.length === 0) return notFound();
  try {
    await rebuildTrackerDocs(id);
  } catch (e) {
    return Response.json({ ok: true, warning: `Saved, but the AI summaries could not be refreshed (${(e as Error).message.slice(0, 100)}). They update the next time you upload tracker data.` });
  }
  return Response.json({ ok: true });
}
