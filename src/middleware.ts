import { NextResponse, type NextRequest } from "next/server";

// Cheap edge check: no session cookie → send to login. Full session validation
// (expiry, idle timeout, account status, permissions) happens server-side on
// every page, action and API route.
const PUBLIC = [/^\/login/, /^\/forgot-password/, /^\/reset-password/, /^\/pay\//, /^\/api\/payments\/webhook/, /^\/api\/health/, /^\/_next/, /^\/favicon/];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  if (!req.cookies.get("trends_session")) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
