import { beforeEach, describe, expect, it } from "vitest";
import { clientKey, rateLimit, resetRateLimits } from "./rate-limit";
import { isUuid } from "./ids";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit, then blocks with a retry time", () => {
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 60_000, 1_000 + i).ok).toBe(true);
    const r = rateLimit("k", 3, 60_000, 1_010);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBe(60); // oldest hit at t=1000 frees up at 61,000
  });
  it("frees capacity as the window slides", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", 3, 10_000, 0);
    expect(rateLimit("k", 3, 10_000, 5_000).ok).toBe(false);
    expect(rateLimit("k", 3, 10_000, 10_001).ok).toBe(true);
  });
  it("keeps callers and endpoints separate", () => {
    for (let i = 0; i < 2; i++) rateLimit("a", 2, 60_000, 0);
    expect(rateLimit("a", 2, 60_000, 1).ok).toBe(false);
    expect(rateLimit("b", 2, 60_000, 1).ok).toBe(true);
  });
  it("keys by the first forwarded address", () => {
    const req = new Request("http://x/", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } });
    expect(clientKey(req, "uploads")).toBe("uploads:9.9.9.9");
    expect(clientKey(new Request("http://x/"), "uploads")).toBe("uploads:local");
  });
});

describe("isUuid", () => {
  it("accepts UUIDs and rejects everything that could reach SQL", () => {
    expect(isUuid("1dc7dd8e-4b1d-4845-85a3-318ec077acf2")).toBe(true);
    for (const bad of ["", "1", "../etc/passwd", "1dc7dd8e-4b1d-4845-85a3-318ec077acf2'; drop table projects;--", undefined, 5, null]) expect(isUuid(bad)).toBe(false);
  });
});
