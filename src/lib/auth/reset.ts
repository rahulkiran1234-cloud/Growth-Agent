import { and, eq, gt, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { newResetToken, RESET_TTL_MS } from "./reset-pure";
import { hashToken } from "./token";

/** Creates a one-time reset token for the user (replacing any earlier one) and returns the token to email. */
export async function issueResetToken(userId: string): Promise<string> {
  const { token, tokenHash } = newResetToken();
  await db.delete(schema.passwordResets).where(eq(schema.passwordResets.userId, userId));
  await db.insert(schema.passwordResets).values({ tokenHash, userId, expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  return token;
}

/** Uses up a reset token. Returns the user it belongs to, or null if it is unknown, expired or already used. */
export async function consumeResetToken(token: string): Promise<string | null> {
  if (!token || token.length > 200) return null;
  const [row] = await db
    .delete(schema.passwordResets)
    .where(and(eq(schema.passwordResets.tokenHash, hashToken(token)), gt(schema.passwordResets.expiresAt, new Date())))
    .returning({ userId: schema.passwordResets.userId });
  return row?.userId ?? null;
}

/** Sets a new password and signs the account out everywhere (except the session named in `keepSessionToken`). */
export async function setPassword(userId: string, passwordHash: string, keepSessionToken?: string): Promise<void> {
  await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, userId));
  await db.delete(schema.passwordResets).where(eq(schema.passwordResets.userId, userId));
  const others = keepSessionToken
    ? and(eq(schema.sessions.userId, userId), ne(schema.sessions.tokenHash, hashToken(keepSessionToken)))
    : eq(schema.sessions.userId, userId);
  await db.delete(schema.sessions).where(others);
}
