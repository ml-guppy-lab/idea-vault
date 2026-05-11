import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// Routes that require authentication
const PROTECTED_PREFIXES = ["/dashboard"];

// Routes that logged-in users should not visit
const AUTH_ROUTES = ["/login", "/signup"];

function isProtected(pathname: string) {
  return PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAuthRoute(pathname: string) {
  return AUTH_ROUTES.some((route) => pathname.startsWith(route));
}

const ACCESS_MAX_AGE = 15 * 60; // 15 minutes
const isSecure = process.env.NODE_ENV === "production";

/**
 * Attempt a silent token refresh using the refresh_token cookie.
 * Calls the FastAPI backend directly (server-to-server, no browser involved).
 * Returns the new access token string, or null if the refresh token is
 * missing, expired, or the backend is unreachable.
 */
async function tryRefresh(req: NextRequest): Promise<string | null> {
  const refreshToken = req.cookies.get("refresh_token")?.value;
  if (!refreshToken) return null;

  const apiBase =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000/api";

  try {
    const res = await fetch(`${apiBase}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!res.ok) return null;
    const { access_token } = await res.json();
    return access_token as string;
  } catch {
    // Backend unreachable (e.g. cold start) — treat as failed refresh
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get("access_token")?.value;

  // Verify the access token JWT
  let isValid = false;
  if (token) {
    try {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET);
      await jwtVerify(token, secret, { algorithms: ["HS256"] });
      isValid = true;
    } catch {
      isValid = false;
    }
  }

  // ── Protected route: access token invalid — try silent refresh ────────────
  if (isProtected(pathname) && !isValid) {
    const newToken = await tryRefresh(req);

    if (newToken) {
      // Refresh succeeded — continue to the page and set the new cookie
      const response = NextResponse.next();
      response.cookies.set("access_token", newToken, {
        httpOnly: true,
        secure: isSecure,
        sameSite: "lax",
        path: "/",
        maxAge: ACCESS_MAX_AGE,
      });
      return response;
    }

    // Both tokens invalid — send user to login
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── Auth route: redirect logged-in users away ─────────────────────────────
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