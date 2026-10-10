import { afterEach, describe, expect, it, vi } from "vitest";
import { appBaseUrl, newResetToken, resetEmail, resetLink, RESET_TTL_MS } from "./reset-pure";
import { hashToken } from "./token";
import { deliveryMode, mailConfigured, sendMail } from "../mail";

describe("reset tokens", () => {
  it("are long, unique, and stored only as a hash", () => {
    const a = newResetToken(), b = newResetToken();
    expect(a.token.length).toBeGreaterThanOrEqual(40);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashToken(a.token));
    expect(a.tokenHash).not.toContain(a.token);
  });
  it("expire after one hour", () => expect(RESET_TTL_MS).toBe(3_600_000));
});

describe("where the emailed link points", () => {
  const req = "http://localhost:3000/api/auth/forgot";
  it("uses APP_URL when set, without a trailing slash", () => {
    expect(appBaseUrl("https://app.example.com/", "production", req)).toBe("https://app.example.com");
    expect(appBaseUrl("http://localhost:3000", "development", req)).toBe("http://localhost:3000");
  });
  it("refuses to build a link from the request in production (Host header poisoning)", () => {
    expect(appBaseUrl(undefined, "production", "https://evil.example/api/auth/forgot")).toBeNull();
    expect(appBaseUrl("", "production", req)).toBeNull();
  });
  it("falls back to the request origin outside production", () => {
    expect(appBaseUrl(undefined, "development", req)).toBe("http://localhost:3000");
    expect(appBaseUrl(undefined, undefined, "http://localhost:3055/x")).toBe("http://localhost:3055");
  });
  it("rejects an APP_URL that is not http(s)", () => expect(appBaseUrl("javascript:alert(1)", "development", req)).toBeNull());
  it("builds the reset link with the token escaped", () => {
    expect(resetLink("https://app.example.com", "abc-DEF_123")).toBe("https://app.example.com/reset-password?token=abc-DEF_123");
    expect(resetLink("https://a.b", "x&y=z")).toBe("https://a.b/reset-password?token=x%26y%3Dz");
  });
});

describe("the reset email", () => {
  const link = "https://app.example.com/reset-password?token=abc";
  const m = resetEmail(link, "Growth Agent");
  it("contains the link, says it works once, and tells the wrong recipient to ignore it", () => {
    expect(m.subject).toBe("Reset your Growth Agent password");
    expect(m.text).toContain(link);
    expect(m.html).toContain(`href="${link}"`);
    expect(m.text).toMatch(/works once and expires in 1 hour/);
    expect(m.text).toMatch(/ignore this email/);
  });
});

describe("mail delivery", () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; vi.restoreAllMocks(); });
  const msg = { to: "a@b.com", subject: "S", text: "Open https://x/reset-password?token=SECRET", html: "<p>x</p>" };

  it("reports whether real email is configured", () => {
    delete process.env.SMTP_HOST; delete process.env.MAIL_FROM;
    expect(mailConfigured()).toBe(false);
    process.env.SMTP_HOST = "smtp.example.com";
    expect(mailConfigured()).toBe(false); // needs a sender address too
    process.env.MAIL_FROM = "Growth Agent <no-reply@example.com>";
    expect(mailConfigured()).toBe(true);
    expect(deliveryMode()).toBe("email");
  });
  it("prints the email to the terminal in development when SMTP is not set up", async () => {
    delete process.env.SMTP_HOST; delete process.env.MAIL_FROM;
    (process.env as Record<string, string>).NODE_ENV = "development";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(deliveryMode()).toBe("console");
    expect(await sendMail(msg)).toBe("console");
    expect(log.mock.calls.join(" ")).toContain("token=SECRET");
  });
  it("never logs the link in production without SMTP, and says nothing was sent", async () => {
    delete process.env.SMTP_HOST; delete process.env.MAIL_FROM;
    (process.env as Record<string, string>).NODE_ENV = "production";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(deliveryMode()).toBe("none");
    expect(await sendMail(msg)).toBe("none");
    expect(log).not.toHaveBeenCalled();
    expect(err.mock.calls.join(" ")).not.toContain("SECRET");
  });
});
