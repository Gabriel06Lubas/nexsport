import { NextResponse, type NextRequest } from "next/server";

// Optimistic check only: is there a session cookie at all? It saves a round
// trip for signed-out visitors but proves nothing. A stale or forged cookie
// passes here and is rejected by the Data Access Layer
// (src/modules/auth/dal.ts), which every protected page and action calls.
// Per Next.js guidance, no database access happens in the proxy.

const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"];
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();

  const hasSessionCookie = SESSION_COOKIES.some((name) => request.cookies.has(name));
  if (hasSessionCookie) return NextResponse.next();

  const login = new URL("/login", request.url);
  login.searchParams.set("callbackUrl", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/dashboard/:path*", "/onboarding"],
};
