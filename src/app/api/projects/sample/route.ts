import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { cloneProject, SAMPLE_PROJECT, SOURCE_PROJECT } from "@/lib/projects";
import { limited } from "@/lib/rate-limit";
import { guardUser } from "@/lib/auth/access";

// One-click onboarding: copies the seeded demo data (sales, reviews with AI tags, competitor documents
// and their embeddings) into a fresh project. Pure SQL, so it is instant and costs nothing.
export async function POST(req: Request) {
  const user = await guardUser();
  if (user instanceof Response) return user;
  const blocked = limited(req, "sample", 5);
  if (blocked) return blocked;

  // Each account gets its own sample copy.
  const [existing] = await db.select().from(schema.projects).where(and(eq(schema.projects.name, SAMPLE_PROJECT), eq(schema.projects.userId, user.id)));
  if (existing) return Response.json({ id: existing.id, reused: true });

  const [src] = await db.select().from(schema.projects).where(eq(schema.projects.name, SOURCE_PROJECT));
  if (!src) return Response.json({ error: "The demo data isn't set up on this server yet. Run: npm run seed" }, { status: 409 });

  return Response.json({ id: await cloneProject(src.id, SAMPLE_PROJECT, user.id), reused: false });
}
