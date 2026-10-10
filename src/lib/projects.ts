import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { deleteFile } from "@/lib/ingest/store";

export const SOURCE_PROJECT = "Acme Home (demo)";
export const SAMPLE_PROJECT = "Sample seller: Acme Home";

/** Copies a project's sales, reviews (with AI tags), ads and per-SKU profit, and competitor documents (with embeddings) into a
 *  new project. Pure SQL, so it is instant and free. Returns the new project id. */
export async function cloneProject(srcId: string, name: string, userId: string | null = null): Promise<string> {
  return db.transaction(async (tx) => {
    const [src] = await tx.select().from(schema.projects).where(eq(schema.projects.id, srcId));
    const [p] = await tx.insert(schema.projects).values({ name, goal: src.goal, userId }).returning();
    await tx.execute(sql`insert into sales (project_id, order_date, sku, units, revenue, price, returned, customer_hash)
      select ${p.id}, order_date, sku, units, revenue, price, returned, customer_hash from sales where project_id = ${srcId}`);
    await tx.execute(sql`insert into reviews (project_id, review_date, sku, rating, body, topics, sentiment)
      select ${p.id}, review_date, sku, rating, body, topics, sentiment from reviews where project_id = ${srcId}`);
    await tx.execute(sql`insert into ad_daily (project_id, day, sku, campaign, product_name, impressions, clicks, spend, orders, units, ad_sales)
      select ${p.id}, day, sku, campaign, product_name, impressions, clicks, spend, orders, units, ad_sales from ad_daily where project_id = ${srcId}`);
    await tx.execute(sql`insert into sku_profit (project_id, sku, unit_profit) select ${p.id}, sku, unit_profit from sku_profit where project_id = ${srcId}`);
    await tx.execute(sql`insert into competitors (project_id, name) select ${p.id}, name from competitors where project_id = ${srcId}`);
    await tx.execute(sql`insert into competitor_snapshots (project_id, competitor_id, snapshot_date, product, category, price, discount_applied, rating, total_reviews, new_reviews, stock_status, promo, data_type, comparable_sku)
      select ${p.id}, nc.id, s.snapshot_date, s.product, s.category, s.price, s.discount_applied, s.rating, s.total_reviews, s.new_reviews, s.stock_status, s.promo, s.data_type, s.comparable_sku
      from competitor_snapshots s join competitors oc on oc.id = s.competitor_id
      join competitors nc on nc.project_id = ${p.id} and nc.name = oc.name
      where s.project_id = ${srcId}`);
    await tx.execute(sql`insert into documents (project_id, competitor_id, title, doc_type, doc_date)
      select ${p.id}, nc.id, d.title, d.doc_type, d.doc_date
      from documents d join competitors oc on oc.id = d.competitor_id
      join competitors nc on nc.project_id = ${p.id} and nc.name = oc.name
      where d.project_id = ${srcId}`);
    await tx.execute(sql`insert into chunks (project_id, document_id, content, page, metadata, embedding)
      select ${p.id}, nd.id, c.content, c.page, c.metadata, c.embedding
      from chunks c join documents od on od.id = c.document_id
      join competitors oc on oc.id = od.competitor_id
      join competitors nc on nc.project_id = ${p.id} and nc.name = oc.name
      join documents nd on nd.competitor_id = nc.id and nd.title = od.title
      where c.project_id = ${srcId}`);
    return p.id;
  });
}

/** Permanently deletes a project and everything under it (rows cascade) plus its uploaded files.
 *  Refuses while an analysis is still running. */
export async function deleteProject(id: string): Promise<{ ok: true; files: number } | { ok: false; reason: string }> {
  const active = await db.select({ id: schema.analyses.id }).from(schema.analyses).where(and(eq(schema.analyses.projectId, id), inArray(schema.analyses.status, ["queued", "running"])));
  if (active.length > 0) return { ok: false, reason: "An analysis is still running for this project. Wait for it to finish, then delete." };
  const uploads = await db.select({ key: schema.uploads.storageKey }).from(schema.uploads).where(eq(schema.uploads.projectId, id));
  await db.delete(schema.projects).where(eq(schema.projects.id, id)); // every child table cascades
  let files = 0;
  for (const u of uploads) if (await deleteFile(u.key)) files++;
  return { ok: true, files };
}
