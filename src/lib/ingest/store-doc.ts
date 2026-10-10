import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { embed } from "@/lib/rag/voyage";
import type { ParsedDoc } from "./docs";

/** Embeds and stores a parsed competitor document. Re-uploading the same file for the same
 *  competitor replaces the old copy instead of duplicating its chunks. */
export async function storeParsedDoc(opts: {
  projectId: string;
  uploadId: string | null;
  competitorName: string;
  title: string;
  parsed: ParsedDoc;
  docDate: string | null;
}) {
  const { projectId, uploadId, competitorName, title, parsed, docDate } = opts;
  const vectors = await embed(parsed.chunks.map((c) => c.content), "document");

  const existing = await db.select().from(schema.competitors).where(and(eq(schema.competitors.projectId, projectId), sql`lower(${schema.competitors.name}) = lower(${competitorName})`));
  const comp = existing[0] ?? (await db.insert(schema.competitors).values({ projectId, name: competitorName }).returning())[0];

  await db.delete(schema.documents).where(and(eq(schema.documents.competitorId, comp.id), eq(schema.documents.title, title)));
  const [doc] = await db.insert(schema.documents).values({ projectId, competitorId: comp.id, uploadId, title, docType: parsed.docType, docDate }).returning();
  const rows = parsed.chunks.map((c, i) => ({
    projectId, documentId: doc.id, content: c.content, page: c.page, embedding: vectors[i],
    metadata: { competitor: comp.name, docDate, filename: title },
  }));
  for (let i = 0; i < rows.length; i += 100) await db.insert(schema.chunks).values(rows.slice(i, i + 100));
  return { competitor: comp.name, chunks: rows.length, documentId: doc.id };
}
