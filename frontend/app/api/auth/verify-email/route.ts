import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://backend:8000";

/**
 * GET /api/auth/verify-email?token=...
 *
 * Proxies the token to FastAPI. Keeps the backend URL server-side.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { detail: "Missing token." },
      { status: 400 }
    );
  }

  const res = await fetch(
    `${BACKEND}/api/auth/verify-email?token=${encodeURIComponent(token)}`,
    { method: "GET" }
  );

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
