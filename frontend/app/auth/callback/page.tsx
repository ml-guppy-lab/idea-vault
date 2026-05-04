"use client";

/**
 * /auth/callback — Google OAuth callback handler
 *
 * The backend redirects here after completing the Google OAuth flow:
 *   GET /auth/callback?access_token=<jwt>&refresh_token=<opaque>
 *
 * This page:
 *   1. Reads both tokens from the URL query string.
 *   2. POSTs them to /api/auth/session (our Next.js server route) which sets
 *      them as httpOnly cookies — JS on the page never touches the token values.
 *   3. Replaces the URL (strips the tokens from browser history / address bar).
 *   4. Redirects to /dashboard.
 *
 * If tokens are missing or the session route fails, the user is sent to /login
 * with an error message in the query string.
 */

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const access_token  = searchParams.get("access_token");
    const refresh_token = searchParams.get("refresh_token");

    if (!access_token || !refresh_token) {
      router.replace("/login?error=oauth_failed");
      return;
    }

    // Strip tokens from the URL immediately so they don't linger in history.
    window.history.replaceState({}, "", "/auth/callback");

    // Hand the tokens to the server-side route which sets httpOnly cookies.
    fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token, refresh_token }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("session store failed");
        router.replace("/dashboard");
      })
      .catch(() => {
        router.replace("/login?error=session_failed");
      });
  }, [router, searchParams]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "system-ui, sans-serif",
        color: "#6b8fa0",
      }}
    >
      Signing you in…
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense>
      <CallbackHandler />
    </Suspense>
  );
}
