import { currentUser } from "@/lib/auth/session";

export async function GET() {
  const user = await currentUser();
  return user ? Response.json({ email: user.email }) : Response.json({ error: "Please sign in." }, { status: 401 });
}
