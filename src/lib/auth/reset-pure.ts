import { randomBytes } from "node:crypto";
import { hashToken } from "./token";

// Pure helpers for password reset links (no database), so they can be unit tested.

export const RESET_TTL_MS = 60 * 60_000; // a link works for one hour

export function newResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

/**
 * Where reset links point. Production must set APP_URL: building the link from the request's Host header would let
 * an attacker get a link to their own domain emailed to a victim. Outside production, the request origin is fine.
 */
export function appBaseUrl(appUrl: string | undefined, nodeEnv: string | undefined, requestUrl: string): string | null {
  const configured = appUrl?.trim().replace(/\/+$/, "");
  if (configured) return /^https?:\/\//.test(configured) ? configured : null;
  return nodeEnv === "production" ? null : new URL(requestUrl).origin;
}

export const resetLink = (base: string, token: string) => `${base}/reset-password?token=${encodeURIComponent(token)}`;

export function resetEmail(link: string, appName: string): { subject: string; text: string; html: string } {
  const subject = `Reset your ${appName} password`;
  const text = `Someone asked to reset the password for your ${appName} account.\n\nTo choose a new password, open this link (it works once and expires in 1 hour):\n${link}\n\nIf this wasn't you, ignore this email and your password stays as it is.`;
  const html = `<p>Someone asked to reset the password for your ${appName} account.</p><p><a href="${link}">Choose a new password</a><br><small>This link works once and expires in 1 hour.</small></p><p><small>If this wasn't you, ignore this email and your password stays as it is.</small></p>`;
  return { subject, text, html };
}
