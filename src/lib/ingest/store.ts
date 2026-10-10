import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Local-disk storage for the MVP (swap for S3-compatible storage in a real deployment).
const DIR = path.join(process.cwd(), ".data", "uploads");

export const MAX_BYTES = 20 * 1024 * 1024;

export async function saveFile(uploadId: string, filename: string, data: Buffer): Promise<string> {
  await mkdir(DIR, { recursive: true });
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const key = `${uploadId}-${safe}`;
  await writeFile(path.join(DIR, key), data);
  return key;
}

export async function loadFile(key: string): Promise<Buffer> {
  if (key.includes("..") || key.includes("/") || key.includes("\\")) throw new Error("Bad storage key");
  return readFile(path.join(DIR, key));
}

/** Removes an uploaded file. Returns false if it was already gone. */
export async function deleteFile(key: string): Promise<boolean> {
  if (key.includes("..") || key.includes("/") || key.includes("\\")) return false;
  try {
    await rm(path.join(DIR, key));
    return true;
  } catch {
    return false;
  }
}
