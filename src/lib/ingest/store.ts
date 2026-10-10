import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

// Uploaded files live in Postgres (table upload_files), so they work on hosts with no persistent disk (Netlify) and
// every serverless function sees the same file. Netlify limits a request body to about 6 MB, so the cap is lower there.
export const onNetlify = () => process.env.NETLIFY === "true";
export const MAX_BYTES = onNetlify() ? 5 * 1024 * 1024 : 20 * 1024 * 1024;
export const MAX_MB_LABEL = onNetlify() ? "5 MB" : "20 MB";

const badKey = (key: string) => key.includes("..") || key.includes("/") || key.includes("\\");

export async function saveFile(uploadId: string, filename: string, data: Buffer): Promise<string> {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const key = `${uploadId}-${safe}`;
  await db.insert(schema.uploadFiles).values({ key, data }).onConflictDoUpdate({ target: schema.uploadFiles.key, set: { data } });
  return key;
}

export async function loadFile(key: string): Promise<Buffer> {
  if (badKey(key)) throw new Error("Bad storage key");
  const [row] = await db.select({ data: schema.uploadFiles.data }).from(schema.uploadFiles).where(eq(schema.uploadFiles.key, key));
  if (!row) throw new Error("The uploaded file is no longer stored. Upload it again.");
  return Buffer.from(row.data);
}

/** Removes an uploaded file. Returns false if it was already gone. */
export async function deleteFile(key: string): Promise<boolean> {
  if (badKey(key)) return false;
  const gone = await db.delete(schema.uploadFiles).where(eq(schema.uploadFiles.key, key)).returning({ key: schema.uploadFiles.key });
  return gone.length > 0;
}
