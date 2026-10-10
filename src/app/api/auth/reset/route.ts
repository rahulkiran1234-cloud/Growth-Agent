import { z } from "zod";
import { Credentials, hashPassword } from "@/lib/auth/password";
import { consumeResetToken, setPassword } from "@/lib/auth/reset";
import { limited } from "@/lib/rate-limit";

const Body = z.object({ token: z.string().min(10).max(200), password: Credentials.shape.password });

// Finishes a password reset: the emailed link is single-use and expires after an hour. Changing the password signs
// the account out everywhere, so a stolen session does not survive a reset.
export async function POST(req: Request) {
  const blocked = limited(req, "reset", 10, 10 * 60_000);
  if (blocked) return blocked;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Enter a new password." }, { status: 400 });

  const userId = await consumeResetToken(parsed.data.token);
  if (!userId) return Response.json({ error: "This reset link is invalid, expired or already used. Request a new one." }, { status: 400 });
  await setPassword(userId, await hashPassword(parsed.data.password));
  return Response.json({ ok: true });
}
