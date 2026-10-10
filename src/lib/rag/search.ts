import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { embed } from "./voyage";
import { queryTerms, recencyFactor, STALE_DAYS, toOrQuery } from "./pure";

export type SearchMode = "hybrid" | "vector" | "keyword";

export type Hit = {
  /** Stable citation id, e.g. "chunk:42". Every competitor claim in a report must cite one. */
  sourceId: string;
  chunkId: number;
  content: string;
  page: number | null;
  competitor: string;
  title: string;
  docDate: string | null;
  score: number;
  /** 1-based rank in each retrieval leg (null = not retrieved by that leg). */
  vectorRank: number | null;
  keywordRank: number | null;
  stale: boolean;
};

const LEG_LIMIT = 30;
const RRF_K = 60; // standard Reciprocal Rank Fusion constant
// Keyword matches are a supporting signal for exact terms (SKUs, prices, names); meaning-based
// vector search leads, so its votes count more in the fusion.
const W_VECTOR = 1;
const W_KEYWORD = 0.3;
// A term found in more than this share of chunks says nothing about relevance (e.g. a
// competitor's own name in a corpus where most chunks are about that competitor).
const MAX_TERM_DF = 0.15;
const MIN_CHUNKS_FOR_DF = 10;


/** Keeps only terms that discriminate: present in at least one chunk, but not in most of them. */
async function informativeTerms(projectId: string, terms: string[]): Promise<string[]> {
  if (terms.length === 0) return [];
  const rows = (
    await db.execute(sql`
      select t.term, count(*) filter (where c.tsv @@ plainto_tsquery('english', t.term))::int as df, count(*)::int as total
      from unnest(${sql.raw(`ARRAY[${terms.map((t) => `'${t.replace(/[^a-z0-9]/g, "")}'`).join(",")}]::text[]`)}) as t(term), chunks c
      where c.project_id = ${projectId} group by t.term`)
  ).rows as { term: string; df: number; total: number }[];
  return rows
    .filter((r) => r.df > 0 && (r.total < MIN_CHUNKS_FOR_DF || r.df / r.total <= MAX_TERM_DF))
    .map((r) => r.term);
}

const vecLiteral = (v: number[]) => `[${v.join(",")}]`;

export async function hybridSearch(opts: {
  projectId: string;
  query: string;
  k?: number;
  competitor?: string | null;
  mode?: SearchMode;
  /** Pass a precomputed query embedding to avoid an extra API call (used by batch evals). */
  queryEmbedding?: number[];
}): Promise<Hit[]> {
  const { projectId, query, k = 8, competitor = null, mode = "hybrid" } = opts;
  const compFilter = competitor ? sql`and lower(co.name) = lower(${competitor})` : sql``;

  const legs: Promise<{ id: number; rnk: number }[]>[] = [];

  if (mode !== "keyword") {
    const qv = opts.queryEmbedding ?? (await embed([query], "query"))[0];
    legs.push(
      db.execute(sql`
        select c.id::int as id, row_number() over (order by c.embedding <=> ${vecLiteral(qv)}::vector)::int as rnk
        from chunks c join documents d on d.id = c.document_id join competitors co on co.id = d.competitor_id
        where c.project_id = ${projectId} and c.embedding is not null ${compFilter}
        order by c.embedding <=> ${vecLiteral(qv)}::vector limit ${LEG_LIMIT}`).then((r) => r.rows as { id: number; rnk: number }[]),
    );
  } else legs.push(Promise.resolve([]));

  const orQuery = mode !== "vector" ? toOrQuery(await informativeTerms(projectId, queryTerms(query))) : null;
  if (orQuery) {
    legs.push(
      db.execute(sql`
        select c.id::int as id, row_number() over (order by ts_rank_cd(c.tsv, q) desc)::int as rnk
        from chunks c join documents d on d.id = c.document_id join competitors co on co.id = d.competitor_id,
             to_tsquery('english', ${orQuery}) q
        where c.project_id = ${projectId} and c.tsv @@ q ${compFilter}
        order by ts_rank_cd(c.tsv, q) desc limit ${LEG_LIMIT}`).then((r) => r.rows as { id: number; rnk: number }[]),
    );
  } else legs.push(Promise.resolve([]));

  const [vec, kw] = await Promise.all(legs);
  const vRank = new Map(vec.map((r) => [r.id, r.rnk]));
  const kRank = new Map(kw.map((r) => [r.id, r.rnk]));
  const ids = [...new Set([...vRank.keys(), ...kRank.keys()])];
  if (ids.length === 0) return [];

  const details = (
    await db.execute(sql`
      select c.id::int as id, c.content, c.page, co.name as competitor, d.title, to_char(d.doc_date, 'YYYY-MM-DD') as doc_date
      from chunks c join documents d on d.id = c.document_id join competitors co on co.id = d.competitor_id
      where c.project_id = ${projectId} and c.id = any(${sql.raw(`ARRAY[${ids.join(",")}]::bigint[]`)})`)
  ).rows as { id: number; content: string; page: number | null; competitor: string; title: string; doc_date: string | null }[];

  const now = Date.now();
  return details
    .map((d): Hit => {
      const v = vRank.get(d.id) ?? null;
      const kk = kRank.get(d.id) ?? null;
      const fused = (v ? W_VECTOR / (RRF_K + v) : 0) + (kk ? W_KEYWORD / (RRF_K + kk) : 0);
      return {
        sourceId: `chunk:${d.id}`, chunkId: d.id, content: d.content, page: d.page, competitor: d.competitor, title: d.title,
        docDate: d.doc_date, score: fused * recencyFactor(d.doc_date, now), vectorRank: v, keywordRank: kk,
        stale: d.doc_date ? (now - Date.parse(d.doc_date)) / 864e5 > STALE_DAYS : false,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
