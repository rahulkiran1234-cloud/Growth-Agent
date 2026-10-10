import { z } from "zod";
import { hybridSearch } from "@/lib/rag/search";
import { limited } from "@/lib/rate-limit";
import { guardProject } from "@/lib/auth/access";

const Query = z.object({
  q: z.string().trim().min(2).max(300),
  competitor: z.string().trim().max(80).optional(),
  k: z.coerce.number().int().min(1).max(12).default(6),
  mode: z.enum(["hybrid", "vector", "keyword"]).default("hybrid"),
});

// Debug/demo endpoint: shows exactly what the agent's retrieval step would see.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardProject(id);
  if (g instanceof Response) return g;
  const blocked = limited(req, "search", 30);
  if (blocked) return blocked;
  const url = new URL(req.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return Response.json({ error: "Enter a search question (2–300 characters)." }, { status: 400 });
  const { q, competitor, k, mode } = parsed.data;
  try {
    const hits = await hybridSearch({ projectId: id, query: q, competitor: competitor || null, k, mode });
    return Response.json({ hits });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
