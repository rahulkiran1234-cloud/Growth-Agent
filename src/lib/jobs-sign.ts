import { createHmac, timingSafeEqual } from "node:crypto";

// Long jobs (the AI analysis, review tagging, document indexing) run in a Netlify background function. The app calls it
// over HTTP, so every call is signed: only this app can start a job, and a captured request expires after 5 minutes.

export type Job =
  | { kind: "analysis"; analysisId: string; projectId: string }
  | { kind: "tag"; projectId: string; uploadId: string }
  | { kind: "doc"; uploadId: string; competitor: string; docDate: string | null };

const TTL_MS = 5 * 60_000;
const secret = () => process.env.AUTH_SECRET || process.env.DATABASE_URL || "";
const mac = (body: string, ts: number) => createHmac("sha256", secret()).update(`${ts}.${body}`).digest("base64url");

export function signJob(job: Job, now = Date.now()): { body: string; header: string } {
  const body = JSON.stringify(job);
  return { body, header: `${now}.${mac(body, now)}` };
}

export function verifyJob(body: string, header: string | null, now = Date.now()): Job | null {
  if (!header || header.length > 200 || !secret()) return null;
  const [tsRaw, got] = header.split(".");
  const ts = Number(tsRaw);
  if (!got || !Number.isFinite(ts) || now - ts > TTL_MS || ts - now > 60_000) return null;
  const want = Buffer.from(mac(body, ts)), have = Buffer.from(got);
  if (want.length !== have.length || !timingSafeEqual(want, have)) return null;
  try {
    const j = JSON.parse(body) as Job;
    const uuid = /^[0-9a-f-]{36}$/;
    if (j.kind === "analysis" && uuid.test(j.analysisId) && uuid.test(j.projectId)) return j;
    if (j.kind === "tag" && uuid.test(j.projectId) && uuid.test(j.uploadId)) return j;
    if (j.kind === "doc" && uuid.test(j.uploadId) && typeof j.competitor === "string" && (j.docDate === null || typeof j.docDate === "string")) return j;
  } catch { /* fall through */ }
  return null;
}
