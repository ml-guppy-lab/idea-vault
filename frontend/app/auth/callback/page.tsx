"use client";

/**
 * /auth/callback — Google OAuth callback handler
 *
 * The backend redirects here after completing the Google OAuth flow:
 *   GET /auth/callback?code=<one-time-uuid>
 *
 * The opaque code (stored in Redis, 60-second TTL) is exchanged for real
 * auth tokens via a server-to-server call in /api/auth/oauth-token.
 * Tokens are set as httpOnly cookies — they never touch browser JavaScript.
 *
 * This page:
 *   1. Reads the one-time code from the URL query string.
 *   2. POSTs the code to /api/auth/oauth-token (Next.js server route).
 *   3. That route calls FastAPI, gets tokens, sets httpOnly cookies.
 *   4. Redirects to /dashboard.
 *
 * If the code is missing or exchange fails, sends to /login with an error.
 */

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("code");

    if (!code) {
      router.replace("/login?error=oauth_failed");
      return;
    }

    // Strip the code from the URL — it's one-time-use and short-lived,
    // but there's no reason to leave it visible in the address bar.
    window.history.replaceState({}, "", "/auth/callback");

    // Exchange the one-time code for tokens via the Next.js BFF route.
    // FastAPI deletes the code from Redis immediately (replay-safe).
    fetch("/api/auth/oauth-token", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ code }),
    })
      .then((res) => {
        if (!res.ok) throw new Error("token exchange failed");
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
