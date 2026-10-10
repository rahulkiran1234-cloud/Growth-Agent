import { count, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { Credentials, hashPassword, normalizeEmail } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { limited } from "@/lib/rate-limit";

// Simple email + password sign-up. No email confirmation in this version, so anyone can register: keep the
// sign-up rate limit low and do not use it for anything that needs a verified address.
export async function POST(req: Request) {
  const blocked = limited(req, "signup", 5, 10 * 60_000);
  if (blocked) return blocked;
  const parsed = Credentials.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Enter an email and a password." }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);

  const [taken] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (taken) return Response.json({ error: "An account with this email already exists. Sign in instead." }, { status: 409 });

  const passwordHash = await hashPassword(parsed.data.password);
  const user = await db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: count() }).from(schema.users);
    const [u] = await tx.insert(schema.users).values({ email, passwordHash }).returning({ id: schema.users.id, email: schema.users.email });
    // The very first account adopts the projects that existed before accounts did (demo data, earlier work).
    if (n === 0) await tx.update(schema.projects).set({ userId: u.id }).where(isNull(schema.projects.userId));
    return u;
  }).catch((e: { code?: string }) => (e.code === "23505" ? null : Promise.reject(e)));
  if (!user) return Response.json({ error: "An account with this email already exists. Sign in instead." }, { status: 409 });

  await createSession(user.id);
  return Response.json({ ok: true, email: user.email });
}
