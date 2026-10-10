import { notFound } from "@/lib/ids";
import { limited } from "@/lib/rate-limit";
import { guardProject } from "@/lib/auth/access";
import { KPI_SECTIONS, sqlKpis, type KpiSection } from "@/lib/agent/kpis";
import { isSourceId, resolveCitations } from "@/lib/rag/citations";

// Evidence drawer: resolves a reference stored by the agent ("chunk:12" or "sql_kpis:returns") to what it points at.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await guardProject(id);
  if (g instanceof Response) return g;
  const blocked = limited(req, "evidence", 60);
  if (blocked) return blocked;
  const ref = new URL(req.url).searchParams.get("ref") ?? "";

  if (isSourceId(ref)) {
    const { found } = await resolveCitations(id, [ref]);
    if (!found[0]) return notFound();
    return Response.json({ kind: "quote", ref, ...found[0] });
  }
  const m = /^sql_kpis:([a-z_]+)(?::(.{1,60}))?$/.exec(ref);
  if (m && (KPI_SECTIONS as readonly string[]).includes(m[1])) {
    const data = await sqlKpis(id, m[1] as KpiSection, m[2]);
    return Response.json({ kind: "data", ref, section: m[1], sku: m[2] ?? null, data });
  }
  return Response.json({ error: "Unknown reference" }, { status: 400 });
}
