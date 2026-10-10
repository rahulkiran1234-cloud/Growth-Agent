import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { guardUser } from "@/lib/auth/access";
import { Credentials, hashPassword, verifyPassword } from "@/lib/auth/password";
import { setPassword } from "@/lib/auth/reset";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { rateLimit, tooMany } from "@/lib/rate-limit";

const Body = z.object({ current: z.string().min(1).max(200), password: Credentials.shape.password });

// Signed-in password change: needs the current password, and signs every OTHER device out.
export async function POST(req: Request) {
  const user = await guardUser();
  if (user instanceof Response) return user;
  const lim = rateLimit(`change-password:${user.id}`, 6, 10 * 60_000);
  if (!lim.ok) return tooMany(lim.retryAfterSec);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Enter your current and new password." }, { status: 400 });

  const [row] = await db.select({ hash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, user.id));
  if (!row || !(await verifyPassword(parsed.data.current, row.hash))) return Response.json({ error: "Your current password is incorrect." }, { status: 400 });
  if (parsed.data.current === parsed.data.password) return Response.json({ error: "Choose a password different from the current one." }, { status: 400 });

  const keep = (await cookies()).get(SESSION_COOKIE)?.value;
  await setPassword(user.id, await hashPassword(parsed.data.password), keep);
  return Response.json({ ok: true });
}
