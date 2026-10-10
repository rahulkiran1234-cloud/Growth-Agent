import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { APP_NAME } from "@/components/brand";
import { normalizeEmail } from "@/lib/auth/password";
import { issueResetToken } from "@/lib/auth/reset";
import { appBaseUrl, resetEmail, resetLink } from "@/lib/auth/reset-pure";
import { deliveryMode, sendMail } from "@/lib/mail";
import { limited, rateLimit, tooMany } from "@/lib/rate-limit";

const Body = z.object({ email: z.string().trim().max(254).pipe(z.email("Enter a valid email address.")) });

// "Forgot password": always answers the same way, whether or not the email has an account, so it cannot be used to
// find out who is registered. The email is sent after responding, so timing does not give it away either.
export async function POST(req: Request) {
  const blocked = limited(req, "forgot", 8, 10 * 60_000);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Enter your email address." }, { status: 400 });
  const email = normalizeEmail(parsed.data.email);
  const perAccount = rateLimit(`forgot-account:${email}`, 3, 60 * 60_000);
  if (!perAccount.ok) return tooMany(perAccount.retryAfterSec);

  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
  if (user) {
    const base = appBaseUrl(process.env.APP_URL, process.env.NODE_ENV, req.url);
    if (!base) console.error("[auth] APP_URL is not set, so no reset link was built (set APP_URL to your site's address in production).");
    else {
      void issueResetToken(user.id)
        .then((token) => sendMail({ to: email, ...resetEmail(resetLink(base, token), APP_NAME) }))
        .catch((e) => console.error("[auth] could not send the password reset email:", (e as Error).message));
    }
  }
  return Response.json({ ok: true, delivery: deliveryMode() });
}
