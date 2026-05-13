import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://backend:8000";

/**
 * POST /api/auth/reset-password
 * Body: { token: string; new_password: string }
 *
 * Proxies to FastAPI. On success the user is redirected to /login.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  const res = await fetch(`${BACKEND}/api/auth/reset-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
