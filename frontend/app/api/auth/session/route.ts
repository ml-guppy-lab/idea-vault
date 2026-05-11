import { NextRequest, NextResponse } from "next/server";

const ACCESS_MAX_AGE  = 15 * 60;           // 15 minutes  (matches backend)
const REFRESH_MAX_AGE = 180 * 24 * 60 * 60; // 180 days   (matches backend)

const isSecure = process.env.NODE_ENV === "production";

const COOKIE_BASE = {
  httpOnly: true,
  secure: isSecure,
  sameSite: "lax" as const,
  path: "/",
};

/**
 * POST /api/auth/session
 * Body: { access_token: string }
 *
 * Sets the access_token as an httpOnly cookie.  The refresh_token is handled
 * separately — it is set by FastAPI via Set-Cookie and re-issued on the
 * frontend domain by /api/auth/login or /api/auth/oauth-token.
 */
export async function POST(req: NextRequest) {
  const body = await req.json() as { access_token?: string };
  const { access_token } = body;

  if (!access_token) {
    return NextResponse.json({ error: "Missing access_token" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });

  res.cookies.set("access_token", access_token, {
    ...COOKIE_BASE,
    maxAge: ACCESS_MAX_AGE,
  });

  return res;
}

/**
 * DELETE /api/auth/session
 * Clears both auth cookies (logout).
 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("access_token");
  res.cookies.delete("refresh_token");
  return res;
}
