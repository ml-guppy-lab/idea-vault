import { NextRequest, NextResponse } from "next/server";

// Use the same env-var resolution as every other BFF route: prefer the
// internal service URL (Docker / Render private network), fall back to the
// public API URL. BACKEND_URL was the old name used here and is not set on
// Render, which caused the BFF to call http://backend:8000 (Docker-only) and
// silently fail — every verification link returned "failed to verify".
const BACKEND =
  process.env.INTERNAL_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:8000/api";

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
    `${BACKEND}/auth/verify-email?token=${encodeURIComponent(token)}`,
    { method: "GET" }
  );

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
