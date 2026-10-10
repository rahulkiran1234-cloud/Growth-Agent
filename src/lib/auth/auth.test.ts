import { beforeAll, describe, expect, it } from "vitest";
import { Credentials, dummyHash, hashPassword, normalizeEmail, verifyPassword } from "./password";
import { safeNext } from "./next";
import { makePdfToken, verifyPdfToken } from "./pdf-token";
import { hashToken } from "./token";

describe("password hashing", () => {
  it("never stores the password and salts every hash", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toContain("correct horse");
    expect(a).not.toBe(b);
  });
  it("accepts the right password and rejects the wrong one", async () => {
    const h = await hashPassword("s3cret-pass!");
    expect(await verifyPassword("s3cret-pass!", h)).toBe(true);
    expect(await verifyPassword("s3cret-pass", h)).toBe(false);
    expect(await verifyPassword("", h)).toBe(false);
  });
  it("fails safely on malformed or foreign hashes instead of throwing", async () => {
    for (const bad of ["", "plain", "bcrypt$10$abc$def", "scrypt$1$2$3$$", "scrypt$x$y$z$AAAA$AAAA"]) expect(await verifyPassword("x", bad)).toBe(false);
  });
  it("has a dummy hash so unknown emails cost the same time as a wrong password", async () => {
    expect(await verifyPassword("anything", await dummyHash())).toBe(false);
  });
});

describe("credentials", () => {
  it("accepts a normal email and password", () => {
    expect(Credentials.safeParse({ email: "  Rahul@Example.com ", password: "longenough1" }).success).toBe(true);
  });
  it("explains what is wrong", () => {
    expect(Credentials.safeParse({ email: "not-an-email", password: "longenough1" }).error?.issues[0].message).toMatch(/valid email/);
    expect(Credentials.safeParse({ email: "a@b.com", password: "short" }).error?.issues[0].message).toMatch(/8 characters/);
    expect(Credentials.safeParse({ email: "a@b.com", password: "x".repeat(201) }).success).toBe(false);
  });
  it("treats emails case-insensitively", () => expect(normalizeEmail("  Rahul@Example.COM ")).toBe("rahul@example.com"));
});

describe("safeNext (no open redirects)", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNext("/projects/abc/sales-price?sku=SKU-01")).toBe("/projects/abc/sales-price?sku=SKU-01");
    const backslash = "/" + String.fromCharCode(92) + "evil.example";
    for (const bad of ["https://evil.example", "//evil.example", backslash, "javascript:alert(1)", "projects/abc", "/ok" + String.fromCharCode(13, 10) + "Set-Cookie: x=1", null, undefined, 5, "/" + "a".repeat(400)]) expect(safeNext(bad)).toBe("/");
  });
});

describe("PDF export link token", () => {
  beforeAll(() => { process.env.AUTH_SECRET = "test-secret-for-unit-tests-only"; });
  const id = "1dc7dd8e-4b1d-4845-85a3-318ec077acf2";
  it("is valid for the one report it was made for, for a short time", () => {
    const now = 1_000_000;
    const t = makePdfToken(id, now);
    expect(verifyPdfToken(id, t, now + 1_000)).toBe(true);
    expect(verifyPdfToken("00000000-0000-0000-0000-000000000000", t, now + 1_000)).toBe(false); // another report
    expect(verifyPdfToken(id, t, now + 3 * 60_000)).toBe(false); // expired
  });
  it("rejects tampered, stretched or malformed tokens", () => {
    const now = 1_000_000;
    const [exp, mac] = makePdfToken(id, now).split(".");
    expect(verifyPdfToken(id, `${Number(exp) + 600_000}.${mac}`, now)).toBe(false); // longer lifetime, same signature
    expect(verifyPdfToken(id, `${exp}.${mac}x`, now)).toBe(false);
    for (const bad of [undefined, null, "", "abc", "1.2.3", 42, "x".repeat(300)]) expect(verifyPdfToken(id, bad, now)).toBe(false);
  });
});

describe("session tokens", () => {
  it("stores only a hash that cannot be turned back into the cookie value", () => {
    const token = "Zm9vYmFyLXNlc3Npb24tdG9rZW4";
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token + "x")).not.toBe(hashToken(token));
  });
});
