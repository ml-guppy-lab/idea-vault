import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.BACKEND_URL ?? "http://backend:8000";

/**
 * POST /api/auth/forgot-password
 * Body: { email: string }
 *
 * Proxies to FastAPI. Always returns 200 so the frontend can show a generic
 * "check your inbox" message without leaking whether the email is registered.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  const res = await fetch(`${BACKEND}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
