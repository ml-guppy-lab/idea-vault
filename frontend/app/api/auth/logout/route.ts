import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/**
 * POST /api/auth/logout
 *
 * The Navbar calls this instead of calling the backend directly.
 * Why: the refresh_token is httpOnly — JS (document.cookie) cannot read it.
 * This server route reads it, revokes it on the backend, then clears both
 * auth cookies in one response.
 */
export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get("refresh_token")?.value;
  const accessToken = cookieStore.get("access_token")?.value;

  const apiBase =
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000/api";

  // Revoke the refresh token in the DB — best effort, don't block logout if it fails.
  // Forward it as a Cookie header (server-to-server); FastAPI reads from request.cookies.
  if (refreshToken) {
    try {
      await fetch(`${apiBase}/auth/logout`, {
        method:  "POST",
        headers: {
          // FastAPI reads refresh_token from the Cookie header, not the body.
          "Cookie": `refresh_token=${refreshToken}`,
          // JWT still required — get_current_user validates it server-side.
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      });
    } catch {
      // Backend unreachable — still clear cookies locally
    }
  }

  // Clear both auth cookies regardless of whether backend revocation succeeded
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("access_token");
  res.cookies.delete("refresh_token");

  return res;
}
