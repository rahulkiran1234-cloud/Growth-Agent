import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { dummyHash, normalizeEmail, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { limited, rateLimit, tooMany } from "@/lib/rate-limit";

const Body = z.object({ email: z.string().trim().max(254), password: z.string().max(200) });

export async function POST(req: Request) {
  const blocked = limited(req, "login", 15, 10 * 60_000);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !parsed.data.email || !parsed.data.password) return Response.json({ error: "Enter your email and password." }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);

  // Slow down guessing against one account, whichever address the attempts come from.
  const perAccount = rateLimit(`login-account:${email}`, 8, 10 * 60_000);
  if (!perAccount.ok) return tooMany(perAccount.retryAfterSec);

  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  // Always do one hash comparison, so an unknown email takes as long as a wrong password.
  const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !ok) return Response.json({ error: "Email or password is incorrect." }, { status: 401 });

  await createSession(user.id);
  return Response.json({ ok: true, email: user.email });
}
