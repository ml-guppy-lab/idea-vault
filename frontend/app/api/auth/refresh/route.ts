import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const ACCESS_MAX_AGE = 15 * 60; // 15 minutes — matches backend
const isSecure = process.env.NODE_ENV === "production";

/**
 * POST /api/auth/refresh
 *
 * Called by the Axios interceptor (lib/api.ts) when any API call returns 401.
 * Reads the refresh_token from the httpOnly cookie (JS can't touch it),
 * exchanges it with the backend for a new access token, then sets the new
 * access_token cookie. Returns 401 if the refresh token is missing/expired.
 */
export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("refresh_token")?.value;

  if (!refreshToken) {
    return NextResponse.json({ error: "No refresh token" }, { status: 401 });
  }

  const apiBase =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000/api";

  // Forward the refresh token to FastAPI as a Cookie header (server-to-server).
  // FastAPI now reads it from request.cookies, not the JSON body, so the raw
  // token value is never returned in any response the browser can inspect.
  const backendRes = await fetch(`${apiBase}/auth/refresh`, {
    method:  "POST",
    headers: { "Cookie": `refresh_token=${refreshToken}` },
  });

  if (!backendRes.ok) {
    // Refresh token is expired or revoked — caller should redirect to login
    return NextResponse.json({ error: "Refresh failed" }, { status: 401 });
  }

  const { access_token } = await backendRes.json();

  // Set the new access token as an httpOnly cookie
  const res = NextResponse.json({ ok: true });
  res.cookies.set("access_token", access_token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_MAX_AGE,
  });

  return res;
}
