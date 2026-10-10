import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { isUuid } from "@/lib/ids";
import { currentUser, type SessionUser } from "./session";

// Ownership checks used by every API route. A project, analysis or upload that belongs to someone else answers
// exactly like one that does not exist (404), so ids can never be used to probe other accounts.

const unauthorized = () => Response.json({ error: "Please sign in." }, { status: 401 });
const missing = () => Response.json({ error: "Not found" }, { status: 404 });

export async function guardUser(): Promise<Response | SessionUser> {
  return (await currentUser()) ?? unauthorized();
}

export async function guardProject(projectId: string): Promise<Response | { user: SessionUser; project: typeof schema.projects.$inferSelect }> {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!isUuid(projectId)) return missing();
  const [project] = await db.select().from(schema.projects).where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, user.id)));
  return project ? { user, project } : missing();
}

export async function guardAnalysis(analysisId: string): Promise<Response | { user: SessionUser; analysis: typeof schema.analyses.$inferSelect }> {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!isUuid(analysisId)) return missing();
  const [row] = await db
    .select({ a: schema.analyses })
    .from(schema.analyses)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.analyses.projectId))
    .where(and(eq(schema.analyses.id, analysisId), eq(schema.projects.userId, user.id)));
  return row ? { user, analysis: row.a } : missing();
}

export async function guardUpload(uploadId: string): Promise<Response | { user: SessionUser; upload: typeof schema.uploads.$inferSelect }> {
  const user = await currentUser();
  if (!user) return unauthorized();
  if (!isUuid(uploadId)) return missing();
  const [row] = await db
    .select({ u: schema.uploads })
    .from(schema.uploads)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.uploads.projectId))
    .where(and(eq(schema.uploads.id, uploadId), eq(schema.projects.userId, user.id)));
  return row ? { user, upload: row.u } : missing();
}

/** True if the signed-in user owns this analysis (used by server-rendered pages). */
export async function ownsAnalysis(analysisId: string): Promise<boolean> {
  const g = await guardAnalysis(analysisId);
  return !(g instanceof Response);
}
