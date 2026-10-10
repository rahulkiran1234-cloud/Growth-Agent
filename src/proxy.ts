import { NextResponse, type NextRequest } from "next/server";

// Optimistic gate only: it checks that a session cookie exists and sends everyone else to the sign-in page. It does
// not prove the cookie is valid. Every API route and server-rendered page checks the session against the database.
const SESSION_COOKIE = "ga_session";
const PUBLIC = [/^\/login$/, /^\/signup$/, /^\/forgot-password$/, /^\/reset-password$/, /^\/api\/auth\//, /^\/api\/health$/];

export function proxy(req: NextRequest) {
  const { pathname, searchParams } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  // The PDF export's headless browser has no cookie; the report page verifies its signed, short-lived token itself.
  if (/^\/analysis\/[0-9a-f-]{36}\/report$/.test(pathname) && searchParams.has("pdf")) return NextResponse.next();
  if (req.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js)$).*)"],
};
