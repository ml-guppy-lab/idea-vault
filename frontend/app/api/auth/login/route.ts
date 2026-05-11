import { NextRequest, NextResponse } from "next/server";

const ACCESS_MAX_AGE  = 15 * 60;                   // 15 min — matches backend
const REFRESH_MAX_AGE = 180 * 24 * 60 * 60;        // 180 days — matches backend
const isSecure        = process.env.NODE_ENV === "production";

const COOKIE_BASE = {
  httpOnly: true,
  secure:   isSecure,
  sameSite: "lax" as const,
  path:     "/",
};

/**
 * POST /api/auth/login
 *
 * BFF (Backend-for-Frontend) proxy — sits between the browser and FastAPI:
 *   1. Forwards credentials to FastAPI /auth/login (server-to-server).
 *   2. Reads access_token from FastAPI's JSON response body.
 *   3. Reads refresh_token from FastAPI's Set-Cookie response header.
 *   4. Sets both as httpOnly cookies scoped to THIS domain (:3000).
 *   5. Returns { ok: true } — no token ever reaches browser JavaScript.
 *
 * Why a proxy?  FastAPI runs on :8000; the browser can only hold cookies
 * for the origin it talks to.  Proxying through Next.js (:3000) ensures
 * the cookies are set on the origin the browser actually uses.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  const apiBase =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000/api";

  // Server-to-server call — forward the real client IP for rate limiting.
  const clientIp =
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for") ??
    "";

  const fastapiRes = await fetch(`${apiBase}/auth/login`, {
    method:  "POST",
    headers: {
      "Content-Type":    "application/json",
      "X-Forwarded-For": clientIp,
    },
    body: JSON.stringify(body),
  });

  if (!fastapiRes.ok) {
    // Forward the exact error (detail, status) from FastAPI to the browser.
    const error = await fastapiRes.json().catch(() => ({ detail: "Login failed" }));
    return NextResponse.json(error, { status: fastapiRes.status });
  }

  const { access_token } = await fastapiRes.json();

  // FastAPI set refresh_token via Set-Cookie on :8000.  Extract the raw value
  // so we can re-set the cookie on :3000 (the origin the browser talks to).
  const setCookieHeader  = fastapiRes.headers.get("set-cookie") ?? "";
  const refreshTokenMatch = setCookieHeader.match(/refresh_token=([^;]+)/);
  const refreshToken      = refreshTokenMatch?.[1];

  if (!access_token || !refreshToken) {
    return NextResponse.json(
      { error: "Incomplete auth response from upstream" },
      { status: 502 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("access_token",  access_token,  { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE });
  res.cookies.set("refresh_token", refreshToken,  { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE });
  return res;
}
