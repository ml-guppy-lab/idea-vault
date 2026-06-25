/**
 * POST /api/ai/chat
 *
 * Unified Vault AI proxy. The FastAPI backend (`/api/ai/chat`) classifies the
 * message and returns EITHER:
 *   - an SSE stream (Content-Type: text/event-stream) for RAG read answers, or
 *   - a JSON body `{ mode: "agent", message, proposals }` for agent writes.
 *
 * This route does not know in advance which one is coming, so it:
 *   1. Reads the httpOnly access_token cookie (JS cannot access it directly).
 *   2. Proactively refreshes the token if it expires within 2 minutes — this
 *      prevents a mid-stream 401 (an SSE stream cannot be retried once open).
 *   3. Forwards to FastAPI via Node's http(s) module (undici/fetch imposes a
 *      body timeout that would kill slow local-LLM SSE streams; node:http does
 *      not — it also comfortably covers slow agent tool-calling turns).
 *   4. Inspects the upstream Content-Type and either pipes the SSE stream
 *      straight to the browser, or buffers and returns the JSON response.
 *
 * The Node.js runtime is required because the Edge runtime cannot pipe an
 * upstream fetch body stream.
 */

import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import * as http from "node:http";
import * as https from "node:https";
import { URL } from "node:url";

export const runtime = "nodejs";
// Allow up to 5 minutes — needed for slow local LLM inference / agent turns on CPU.
export const maxDuration = 300;

const API_BASE = () =>
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000/api";

const ACCESS_MAX_AGE = 15 * 60; // seconds — must match FastAPI setting
const isSecure = process.env.NODE_ENV === "production";
// Refresh if the token expires within this many seconds.
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
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(payload, "base64").toString("utf-8");
    const { exp } = JSON.parse(json) as { exp?: number };
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

/** True when the token will expire within REFRESH_THRESHOLD_SECS seconds. */
function isExpiringSoon(token: string): boolean {
  const exp = getTokenExp(token);
  if (exp === null) return true; // malformed → treat as expired, force refresh
  const nowSecs = Math.floor(Date.now() / 1000);
  return exp - nowSecs < REFRESH_THRESHOLD_SECS;
}

/**
 * Exchange the refresh_token cookie for a fresh access token (server-to-server).
 * Returns the new token string, or null if the refresh failed.
 */
async function proactiveRefresh(
  refreshToken: string,
): Promise<{ newAccessToken: string | null }> {
  try {
    const res = await fetch(`${API_BASE()}/auth/refresh`, {
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

/** Build the Set-Cookie header value for a refreshed access token. */
function accessCookie(token: string): string {
  return [
    `access_token=${token}`,
    "Path=/",
    `Max-Age=${ACCESS_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
    isSecure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
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

  // ── Proactive refresh — prevent a mid-stream 401 ───────────────────────────
  let freshTokenForCookie: string | null = null;
  if (isExpiringSoon(token) && refreshToken) {
    const { newAccessToken } = await proactiveRefresh(refreshToken);
    if (newAccessToken) {
      token = newAccessToken;
      freshTokenForCookie = newAccessToken;
    }
    // If refresh failed, continue with the existing token and let FastAPI
    // return 401 naturally — the client handles the session-expired state.
  }

  // ── Forward to backend via node:http (no body timeout) ─────────────────────
  const body = await req.text();
  const targetUrl = new URL(`${API_BASE()}/ai/chat`);

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
        // No timeout — the SSE stream / agent turn stays open until complete.
      },
      resolve,
    );
    nodeReq.on("error", reject);
    nodeReq.write(body);
    nodeReq.end();
  });

  const statusCode = backendRes.statusCode ?? 502;
  const upstreamContentType = backendRes.headers["content-type"] ?? "";

  // ── Non-2xx — buffer the JSON error body and return it ─────────────────────
  if (statusCode >= 400) {
    const chunks: Buffer[] = [];
    for await (const chunk of backendRes) chunks.push(chunk as Buffer);
    const errText = Buffer.concat(chunks).toString();
    let err: unknown;
    try {
      err = JSON.parse(errText);
    } catch {
      err = { detail: "Unknown error" };
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (freshTokenForCookie) headers["Set-Cookie"] = accessCookie(freshTokenForCookie);
    return new Response(JSON.stringify(err), { status: statusCode, headers });
  }

  // ── READ path: pipe the SSE stream straight to the browser ─────────────────
  if (upstreamContentType.includes("text/event-stream")) {
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
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    };
    if (freshTokenForCookie) responseHeaders["Set-Cookie"] = accessCookie(freshTokenForCookie);

    return new Response(stream, { headers: responseHeaders });
  }

  // ── WRITE path: buffer the agent JSON response and return it ────────────────
  const chunks: Buffer[] = [];
  for await (const chunk of backendRes) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { detail: "Invalid response from server" };
  }

  const jsonHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (freshTokenForCookie) jsonHeaders["Set-Cookie"] = accessCookie(freshTokenForCookie);

  return new Response(JSON.stringify(data), { status: statusCode, headers: jsonHeaders });
}
