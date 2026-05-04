import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Routes that require a valid access_token cookie.
// Any path starting with these prefixes is protected.
const PROTECTED_PREFIXES = ["/dashboard"];

// Routes that logged-in users should not visit (redirect to dashboard).
const AUTH_ROUTES = ["/login", "/signup"];

function isProtected(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAuthRoute(pathname: string) {
  return AUTH_ROUTES.some((route) => pathname.startsWith(route));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get("access_token")?.value;

  // ── Verify the JWT ─────────────────────────────────────────────────────────
  let isValid = false;
  if (token) {
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET);
      await jwtVerify(token, secret, { algorithms: ["HS256"] });
      isValid = true;
    } catch {
      // Token missing, expired, or tampered — treat as unauthenticated
      isValid = false;
    }
  }

  // ── Guard protected routes ─────────────────────────────────────────────────
  if (isProtected(pathname) && !isValid) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    // Preserve the original destination so we can redirect back after login
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Redirect logged-in users away from auth pages ─────────────────────────
  if (isAuthRoute(pathname) && isValid) {
    const dashboardUrl = req.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  return NextResponse.next();
}

// Only run middleware on these paths — skip static files, images, api routes
export const config = {
  matcher: [
    "/dashboard/:path*",
    "/login",
    "/signup",
  ],
};