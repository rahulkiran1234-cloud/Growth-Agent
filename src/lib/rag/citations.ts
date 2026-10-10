import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { isSourceId, SOURCE_RE } from "./format";

export { formatHitsForPrompt, isSourceId } from "./format";

export type Citation = {
  sourceId: string;
  competitor: string;
  title: string;
  page: number | null;
  docDate: string | null;
  snippet: string;
};

/** Resolves source ids to displayable citations. Ids that don't exist in THIS project come back
 *  in `missing`: the evidence gate (Phase 4) uses this to drop unsupported claims. */
export async function resolveCitations(projectId: string, sourceIds: string[]): Promise<{ found: Citation[]; missing: string[] }> {
  const valid = [...new Set(sourceIds.filter(isSourceId))];
  const invalid = sourceIds.filter((s) => !isSourceId(s));
  if (valid.length === 0) return { found: [], missing: [...new Set(invalid)] };
  const ids = valid.map((s) => Number(SOURCE_RE.exec(s)![1]));
  const rows = (
    await db.execute(sql`
      select c.id::int as id, c.content, c.page, co.name as competitor, d.title, to_char(d.doc_date,'YYYY-MM-DD') as doc_date
      from chunks c join documents d on d.id = c.document_id join competitors co on co.id = d.competitor_id
      where c.project_id = ${projectId} and c.id = any(${sql.raw(`ARRAY[${ids.join(",")}]::bigint[]`)})`)
  ).rows as { id: number; content: string; page: number | null; competitor: string; title: string; doc_date: string | null }[];
  const found = rows.map((r): Citation => ({ sourceId: `chunk:${r.id}`, competitor: r.competitor, title: r.title, page: r.page, docDate: r.doc_date, snippet: r.content.slice(0, 280) }));
  const foundIds = new Set(found.map((f) => f.sourceId));
  return { found, missing: [...new Set([...invalid, ...valid.filter((v) => !foundIds.has(v))])] };
}

