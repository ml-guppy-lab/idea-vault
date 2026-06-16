/**
 * POST /api/chat
 *
 * Next.js proxy that:
 *   1. Reads the httpOnly access_token cookie (JS cannot access it directly)
 *   2. Proactively refreshes the token if it expires within 2 minutes —
 *      prevents mid-stream 401s (SSE streams cannot be retried once open)
 *   3. Forwards the request to the FastAPI backend with the Bearer token
 *   4. Pipes the SSE stream straight back to the browser without buffering
 *
 * The Node.js runtime is required because the Edge runtime does not support
 * piping fetch body streams from an upstream URL.
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";

export const runtime = "nodejs";
// Allow up to 5 minutes — needed for slow local LLM inference on CPU.
export const maxDuration = 300;

const API_BASE = () =>
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000/api";

const ACCESS_MAX_AGE = 15 * 60; // seconds — must match FastAPI setting
const isSecure = process.env.NODE_ENV === "production";
// Refresh if token expires within this many seconds
const REFRESH_THRESHOLD_SECS = 120;

/**
 * Decode the `exp` claim from a JWT without verifying the signature.
 * Signature verification happens on the FastAPI side.
 * Returns the expiry unix timestamp, or null if the token is malformed.
 */
function getTokenExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    // JWT payload is Base64url encoded — pad to make it valid Base64
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(payload, "base64").toString("utf-8");
    const { exp } = JSON.parse(json) as { exp?: number };
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

/**
 * Return true when the token will expire within REFRESH_THRESHOLD_SECS seconds.
 */
function isExpiringSoon(token: string): boolean {
  const exp = getTokenExp(token);
  if (exp === null) return true; // malformed → treat as expired, force refresh
  const nowSecs = Math.floor(Date.now() / 1000);
  return exp - nowSecs < REFRESH_THRESHOLD_SECS;
}

/**
 * Exchange the refresh_token cookie for a fresh access token via the Next.js
 * BFF refresh route (server-to-server).  Returns the new token string, or
 * null if the refresh failed (expired session, network error, etc.).
 */
async function proactiveRefresh(
  refreshToken: string,
): Promise<{ newAccessToken: string | null }> {
  try {
    const apiBase =
      process.env.INTERNAL_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:8000/api";

    const res = await fetch(`${apiBase}/auth/refresh`, {
      method: "POST",
      headers: { Cookie: `refresh_token=${refreshToken}` },
    });
    if (!res.ok) return { newAccessToken: null };
    const data = (await res.json()) as { access_token?: string };
    return { newAccessToken: data.access_token ?? null };
  } catch {
    return { newAccessToken: null };
  }
}

export async function POST(req: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const cookieStore = await cookies();
  let token = cookieStore.get("access_token")?.value ?? null;
  const refreshToken = cookieStore.get("refresh_token")?.value ?? null;

  if (!token) {
    return new Response(JSON.stringify({ detail: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Proactive refresh — prevent mid-stream 401 ─────────────────────────────
  // SSE streams cannot be retried once open; if the token expires during
  // generation the user sees an error mid-response.  Refreshing here (before
  // the stream opens) costs one extra HTTP round-trip only when the token is
  // about to expire — imperceptible to the user.
  let freshTokenForCookie: string | null = null;
  if (isExpiringSoon(token) && refreshToken) {
    const { newAccessToken } = await proactiveRefresh(refreshToken);
    if (newAccessToken) {
      token = newAccessToken;
      freshTokenForCookie = newAccessToken; // carry forward to set cookie later
    }
    // If refresh failed (revoked session, network error) continue with the
    // existing token and let FastAPI return 401 naturally — the client-side
    // Axios interceptor will handle it.
  }

  // ── Forward to backend via Node.js http (no body timeout) ─────────────────
  // fetch() via undici has a body timeout that kills slow SSE streams.
  // Node.js http.request has no such timeout by default — safe for streaming.
  const body = await req.text();
  const targetUrl = new URL(`${API_BASE()}/chat`);

  const backendRes = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const lib = targetUrl.protocol === "https:" ? https : http;
    const nodeReq = lib.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Length": Buffer.byteLength(body),
        },
        // No timeout — the SSE stream stays open until the LLM finishes.
      },
      resolve,
    );
    nodeReq.on("error", reject);
    nodeReq.write(body);
    nodeReq.end();
  });

  // Non-2xx — read body and return JSON error
  if (backendRes.statusCode && backendRes.statusCode >= 400) {
    const chunks: Buffer[] = [];
    for await (const chunk of backendRes) chunks.push(chunk as Buffer);
    const errText = Buffer.concat(chunks).toString();
    let err: unknown;
    try { err = JSON.parse(errText); } catch { err = { detail: "Unknown error" }; }
    return new Response(JSON.stringify(err), {
      status: backendRes.statusCode,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Pipe the SSE stream straight to the browser ────────────────────────────
  const stream = new ReadableStream({
    start(controller) {
      backendRes.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      backendRes.on("end", () => controller.close());
      backendRes.on("error", (err) => controller.error(err));
    },
  });

  const responseHeaders: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    // Prevents Nginx / reverse proxies from buffering the stream.
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  };

  // If we issued a proactive refresh, propagate the new access_token cookie
  // so the browser's httpOnly cookie is updated before the stream arrives.
  if (freshTokenForCookie) {
    const cookieValue = [
      `access_token=${freshTokenForCookie}`,
      "Path=/",
      `Max-Age=${ACCESS_MAX_AGE}`,
      "HttpOnly",
      "SameSite=Lax",
      isSecure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
    responseHeaders["Set-Cookie"] = cookieValue;
  }

  return new Response(stream, { headers: responseHeaders });
}
