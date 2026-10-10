import { createHmac, timingSafeEqual } from "node:crypto";

// The PDF export renders the report page in a headless browser, which has no login cookie. The export route (after
// checking the user owns the analysis) gives that browser a short-lived link that is valid only for this one report.

const secret = () => process.env.AUTH_SECRET || process.env.DATABASE_URL || "";
const TTL_MS = 2 * 60_000;

const sign = (analysisId: string, exp: number) => createHmac("sha256", secret()).update(`${analysisId}.${exp}`).digest("base64url");

export function makePdfToken(analysisId: string, now = Date.now()): string {
  const exp = now + TTL_MS;
  return `${exp}.${sign(analysisId, exp)}`;
}

export function verifyPdfToken(analysisId: string, token: unknown, now = Date.now()): boolean {
  if (typeof token !== "string" || token.length > 200 || !secret()) return false;
  const [expRaw, mac] = token.split(".");
  const exp = Number(expRaw);
  if (!mac || !Number.isFinite(exp) || exp < now || exp > now + TTL_MS + 5_000) return false;
  const want = Buffer.from(sign(analysisId, exp));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}
