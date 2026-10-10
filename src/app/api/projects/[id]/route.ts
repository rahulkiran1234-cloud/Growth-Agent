import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { readiness } from "@/lib/ingest/readiness";
import { resumeStalledJobs } from "@/lib/ingest/process";
import { isUuid, notFound } from "@/lib/ids";
import { freeUsage } from "@/lib/limits";
import { deleteProject } from "@/lib/projects";
import { limited } from "@/lib/rate-limit";
import { guardProject } from "@/lib/auth/access";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardProject(id);
  if (g instanceof Response) return g;
  const { project } = g;

  await resumeStalledJobs(id);
  const uploads = await db
    .select({ id: schema.uploads.id, kind: schema.uploads.kind, status: schema.uploads.status, filename: schema.uploads.filename, stats: schema.uploads.stats, error: schema.uploads.error, mapping: schema.uploads.mapping, createdAt: schema.uploads.createdAt })
    .from(schema.uploads)
    .where(eq(schema.uploads.projectId, id))
    .orderBy(desc(schema.uploads.createdAt));
  const competitors = (await db.execute(sql`
    select c.name, count(distinct d.id)::int as documents, count(ch.id)::int as chunks
    from competitors c left join documents d on d.competitor_id = c.id left join chunks ch on ch.document_id = d.id
    where c.project_id = ${id} group by c.name order by c.name`)).rows;

  const analyses = await db
    .select({ id: schema.analyses.id, status: schema.analyses.status, startedAt: schema.analyses.startedAt, costUsd: schema.analyses.costUsd })
    .from(schema.analyses).where(eq(schema.analyses.projectId, id)).orderBy(desc(schema.analyses.startedAt)).limit(10);

  return Response.json({ project, uploads, competitors, analyses, usage: await freeUsage(id), readiness: await readiness(id) });
}

// "Delete my data": removes the project, every row under it, and the uploaded files.
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();
  const g = await guardProject(id);
  if (g instanceof Response) return g;
  const blocked = limited(req, "delete", 10);
  if (blocked) return blocked;
  const r = await deleteProject(id);
  if (!r.ok) return Response.json({ error: r.reason }, { status: 409 });
  return Response.json({ ok: true, filesRemoved: r.files });
}
