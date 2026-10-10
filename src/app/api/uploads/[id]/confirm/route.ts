import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { processCsvUpload } from "@/lib/ingest/process";
import { limited } from "@/lib/rate-limit";
import { guardUpload } from "@/lib/auth/access";

const Body = z.object({ mapping: z.record(z.string(), z.string().nullable()) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardUpload(id);
  if (g instanceof Response) return g;
  const blocked = limited(req, "confirm", 20);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "A column mapping is required." }, { status: 400 });

  try {
    await processCsvUpload(id, parsed.data.mapping);
  } catch (e) {
    return Response.json({ error: `Could not import this file (${(e as Error).message.slice(0, 160)}).` }, { status: 500 });
  }
  const [after] = await db.select().from(schema.uploads).where(eq(schema.uploads.id, id));
  return Response.json({ upload: after });
}
