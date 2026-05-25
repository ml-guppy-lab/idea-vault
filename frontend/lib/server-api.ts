/**
 * lib/server-api.ts
 *
 * Centralised FastAPI fetch wrapper for Next.js server-side route handlers.
 *
 * Every API route that proxies to FastAPI should use apiFetch() instead of
 * calling fetch() directly. This gives transparent 401 → refresh → retry
 * behaviour without duplicating the logic in every route file.
 *
 * Security
 * --------
 * - Tokens live in httpOnly cookies — never exposed to browser JS.
 * - The refresh token is forwarded as a Cookie header (not a body field),
 *   matching exactly what FastAPI's /auth/refresh endpoint expects.
 * - refreshPromise is a process-level lock: if multiple concurrent requests
 *   all 401 simultaneously, only one refresh call fires. All others wait
 *   for the same promise and then retry with the new token.
 *
 * Usage
 * -----
 *   const { response, newAccessToken } = await apiFetch("/profile/me");
 *   const data = await response.json();
 *   const res = NextResponse.json(data, { status: response.status });
 *   applyNewToken(res, newAccessToken);   // no-op when null
 *   return res;
 */

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const INTERNAL_API = () =>
  process.env.INTERNAL_API_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:8000/api";

// 15 minutes — must match FastAPI's ACCESS_TOKEN_EXPIRE_MINUTES
const ACCESS_MAX_AGE = 15 * 60;
const isSecure = process.env.NODE_ENV === "production";

// One refresh in-flight at a time per server worker process.
// Prevents multiple redundant refresh calls when concurrent requests all 401.
let refreshPromise: Promise<string | null> | null = null;

/** Call FastAPI's refresh endpoint server-to-server and return the new access token. */
async function doRefresh(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${INTERNAL_API()}/auth/refresh`, {
      method: "POST",
      // FastAPI reads request.cookies.get("refresh_token").
      // Forwarding as a Cookie header keeps the raw token out of any response body.
      headers: { Cookie: `refresh_token=${refreshToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    // Backend unreachable during refresh — don't crash the route handler.
    return null;
  }
}

/**
 * Set the updated access_token as an httpOnly cookie on an outgoing NextResponse.
 * This is a no-op when newAccessToken is null, which is the common case
 * (most requests succeed on the first attempt and never need a refresh).
 */
export function applyNewToken(res: NextResponse, newAccessToken: string | null): void {
  if (!newAccessToken) return;
  res.cookies.set("access_token", newAccessToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: ACCESS_MAX_AGE,
  });
}

/**
 * Fetch a FastAPI endpoint from a Next.js server-side route handler.
 *
 * @param path  FastAPI path without the base URL prefix, e.g. "/profile/me"
 * @param init  Standard RequestInit (method, headers, body, …)
 *
 * @returns
 *   response        — FastAPI response (first attempt, or post-refresh retry)
 *   newAccessToken  — non-null only when a silent refresh was performed;
 *                     pass to applyNewToken() so the browser gets the
 *                     updated httpOnly cookie in the same HTTP response
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {}
): Promise<{ response: Response; newAccessToken: string | null }> {
  const cookieStore = await cookies();
  const accessToken  = cookieStore.get("access_token")?.value  ?? null;
  const refreshToken = cookieStore.get("refresh_token")?.value ?? null;

  // Attach the Bearer token without overwriting any caller-supplied headers.
  // Note: do NOT set Content-Type here — callers with FormData bodies rely on
  // fetch setting it automatically (including the multipart boundary).
  const makeRequest = (token: string | null) =>
    fetch(`${INTERNAL_API()}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

  // ── First attempt ──────────────────────────────────────────────────────────
  const first = await makeRequest(accessToken);
  if (first.status !== 401) {
    return { response: first, newAccessToken: null };
  }

  // ── 401 received — attempt silent refresh ──────────────────────────────────
  if (!refreshToken) {
    // No refresh token either — fully expired session; let the caller return 401
    return { response: first, newAccessToken: null };
  }

  // Only one refresh fires at a time; concurrent 401s wait for the same promise
  if (!refreshPromise) {
    refreshPromise = doRefresh(refreshToken).finally(() => {
      refreshPromise = null; // release lock after completion (success or failure)
    });
  }
  const newToken = await refreshPromise;

  if (!newToken) {
    // Refresh failed (e.g. refresh token expired or revoked) — return the 401
    return { response: first, newAccessToken: null };
  }

  // ── Retry the original request with the fresh token ────────────────────────
  const retry = await makeRequest(newToken);
  return { response: retry, newAccessToken: newToken };
}
