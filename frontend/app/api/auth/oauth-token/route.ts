import { NextRequest, NextResponse } from "next/server";

const ACCESS_MAX_AGE  = 15 * 60;                   // 15 min
const REFRESH_MAX_AGE = 180 * 24 * 60 * 60;        // 180 days
const isSecure        = process.env.NODE_ENV === "production";

const COOKIE_BASE = {
  httpOnly: true,
  secure:   isSecure,
  sameSite: "lax" as const,
  path:     "/",
};

/**
 * POST /api/auth/oauth-token
 *
 * Second leg of the Google OAuth handshake.
 *
 * After Google redirects the browser to /auth/callback?code=<UUID>, the
 * callback page calls this server route with that opaque code.  This route
 * exchanges the code with FastAPI in a server-to-server call — tokens are
 * never returned to browser JavaScript.
 *
 *   FastAPI GET /auth/google/token?code=<UUID>
 *     ← { access_token }  +  Set-Cookie: refresh_token (httpOnly)
 *
 * This route then re-sets both cookies on the frontend domain (:3000).
 * The one-time code is consumed and deleted in Redis by FastAPI (replay-safe).
 */
export async function POST(req: NextRequest) {
  const { code } = (await req.json()) as { code?: string };

  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const apiBase =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000/api";

  // Server-to-server token exchange — browser never sees the response.
  const fastapiRes = await fetch(
    `${apiBase}/auth/google/token?code=${encodeURIComponent(code)}`
  );

  if (!fastapiRes.ok) {
    return NextResponse.json(
      { error: "Token exchange failed" },
      { status: fastapiRes.status }
    );
  }

  const { access_token } = await fastapiRes.json();

  // FastAPI sets refresh_token via Set-Cookie on :8000.  Extract and re-set
  // on :3000 so Next.js routes can read it from browser cookies.
  const setCookieHeader   = fastapiRes.headers.get("set-cookie") ?? "";
  const refreshTokenMatch = setCookieHeader.match(/refresh_token=([^;]+)/);
  const refreshToken      = refreshTokenMatch?.[1];

  if (!access_token || !refreshToken) {
    return NextResponse.json(
      { error: "Incomplete token response from upstream" },
      { status: 502 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("access_token",  access_token, { ...COOKIE_BASE, maxAge: ACCESS_MAX_AGE });
  res.cookies.set("refresh_token", refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_MAX_AGE });
  return res;
}
