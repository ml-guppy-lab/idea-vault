/**
 * POST /api/chat
 *
 * Next.js proxy that:
 *   1. Reads the httpOnly access_token cookie (JS cannot access it directly)
 *   2. Forwards the request to the FastAPI backend with the Bearer token
 *   3. Pipes the SSE stream straight back to the browser without buffering
 *
 * The Node.js runtime is required because the Edge runtime does not support
 * piping fetch body streams from an upstream URL.
 */

import { cookies } from "next/headers";
import { NextRequest } from "next/server";

export const runtime = "nodejs";

const API_BASE = () =>
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000/api";

export async function POST(req: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;

  if (!token) {
    return new Response(JSON.stringify({ detail: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Forward to backend ─────────────────────────────────────────────────────
  const body = await req.text();

  let backendRes: Response;
  try {
    backendRes = await fetch(`${API_BASE()}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body,
    });
  } catch {
    return new Response(
      JSON.stringify({ detail: "Failed to reach the backend" }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  // Non-2xx responses (e.g. 429 rate-limit, 422 validation) — return JSON error.
  if (!backendRes.ok) {
    const err = await backendRes
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    return new Response(JSON.stringify(err), {
      status: backendRes.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Pipe the SSE stream straight to the browser ────────────────────────────
  return new Response(backendRes.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      // Prevents Nginx / reverse proxies from buffering the stream.
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
