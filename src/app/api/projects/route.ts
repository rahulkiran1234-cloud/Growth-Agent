import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { guardUser } from "@/lib/auth/access";

const MAX_PROJECTS_PER_ACCOUNT = 20;

export async function GET() {
  const user = await guardUser();
  if (user instanceof Response) return user;
  const rows = await db.execute(sql`
    select p.id, p.name, p.goal, p.created_at,
      (select count(*)::int from sales s where s.project_id = p.id) as sales,
      (select count(*)::int from reviews r where r.project_id = p.id) as reviews,
      (select count(*)::int from chunks c where c.project_id = p.id) as chunks
    from projects p where p.user_id = ${user.id} order by p.created_at desc`);
  return Response.json(rows.rows);
}

const Body = z.object({ name: z.string().trim().min(1).max(80), goal: z.enum(["revenue", "rating", "margin"]).default("revenue") });

export async function POST(req: Request) {
  const user = await guardUser();
  if (user instanceof Response) return user;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "A project name is required." }, { status: 400 });
  const [{ n }] = await db.select({ n: count() }).from(schema.projects).where(eq(schema.projects.userId, user.id));
  if (n >= MAX_PROJECTS_PER_ACCOUNT) return Response.json({ error: `You can have up to ${MAX_PROJECTS_PER_ACCOUNT} projects. Delete one you no longer need first.` }, { status: 400 });
  const [p] = await db.insert(schema.projects).values({ ...parsed.data, userId: user.id }).returning();
  return Response.json(p);
}
