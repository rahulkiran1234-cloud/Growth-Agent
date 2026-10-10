// Small in-memory sliding-window limiter. Fine for a single Node process (this MVP); a multi-instance
// deployment would need a shared store such as Redis.
const buckets = ((globalThis as unknown as { __rl?: Map<string, number[]> }).__rl ??= new Map<string, number[]>());

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterSec: number } {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { ok: true, retryAfterSec: 0 };
}

/** One bucket per caller and endpoint. Behind a proxy the first X-Forwarded-For entry is the client. */
export function clientKey(req: Request, scope: string): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  return `${scope}:${ip}`;
}

export const tooMany = (retryAfterSec: number) =>
  Response.json({ error: `Too many requests. Please wait ${retryAfterSec}s and try again.` }, { status: 429, headers: { "Retry-After": String(retryAfterSec) } });

/** Returns a 429 response when the caller is over the limit, otherwise null. */
export function limited(req: Request, scope: string, limit: number, windowMs = 60_000): Response | null {
  const r = rateLimit(clientKey(req, scope), limit, windowMs);
  return r.ok ? null : tooMany(r.retryAfterSec);
}

export function resetRateLimits() {
  buckets.clear();
}
