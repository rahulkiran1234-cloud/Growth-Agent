import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signJob, verifyJob, type Job } from "./jobs-sign";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const analysis: Job = { kind: "analysis", analysisId: A, projectId: B };
const env = { ...process.env };
beforeEach(() => { process.env.AUTH_SECRET = "test-secret-for-jobs"; });
afterEach(() => { process.env = { ...env }; });

describe("background job signatures", () => {
  it("accepts a job signed by this app", () => {
    const { body, header } = signJob(analysis);
    expect(verifyJob(body, header)).toEqual(analysis);
  });
  it("accepts each kind of job", () => {
    for (const j of [{ kind: "tag", projectId: A, uploadId: B }, { kind: "doc", uploadId: A, competitor: "Rival", docDate: null }, { kind: "doc", uploadId: A, competitor: "Rival", docDate: "2026-09-01" }] as Job[]) {
      const { body, header } = signJob(j);
      expect(verifyJob(body, header)).toEqual(j);
    }
  });
  it("rejects a missing, malformed or wrong signature", () => {
    const { body, header } = signJob(analysis);
    expect(verifyJob(body, null)).toBeNull();
    expect(verifyJob(body, "garbage")).toBeNull();
    expect(verifyJob(body, `${Date.now()}.${"A".repeat(43)}`)).toBeNull();
    expect(verifyJob(body, header.slice(0, -2) + "xx")).toBeNull();
  });
  it("rejects a body that was changed after signing", () => {
    const { header } = signJob(analysis);
    const other = JSON.stringify({ kind: "analysis", analysisId: B, projectId: A });
    expect(verifyJob(other, header)).toBeNull();
  });
  it("rejects a signature made with a different secret", () => {
    const { body, header } = signJob(analysis);
    process.env.AUTH_SECRET = "another-secret";
    expect(verifyJob(body, header)).toBeNull();
  });
  it("expires after 5 minutes and refuses one dated in the future", () => {
    const now = Date.now();
    const { body, header } = signJob(analysis, now - 6 * 60_000);
    expect(verifyJob(body, header, now)).toBeNull();
    const fresh = signJob(analysis, now - 4 * 60_000);
    expect(verifyJob(fresh.body, fresh.header, now)).toEqual(analysis);
    const future = signJob(analysis, now + 10 * 60_000);
    expect(verifyJob(future.body, future.header, now)).toBeNull();
  });
  it("rejects ids that are not UUIDs even when correctly signed", () => {
    const { body, header } = signJob({ kind: "analysis", analysisId: "not-a-uuid", projectId: B });
    expect(verifyJob(body, header)).toBeNull();
  });
  it("accepts nothing when no secret is configured", () => {
    const { body, header } = signJob(analysis);
    delete process.env.AUTH_SECRET; delete process.env.DATABASE_URL;
    expect(verifyJob(body, header)).toBeNull();
  });
});
