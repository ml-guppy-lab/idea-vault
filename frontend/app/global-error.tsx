"use client";

// Global error boundary — catches uncaught render errors anywhere in the App
// Router tree and reports them to Sentry, then shows a minimal recovery UI.
// (Next.js requires this file to render its own <html>/<body>.)
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          fontFamily: "system-ui, sans-serif",
          background: "#0f172a",
          color: "#e2e8f0",
          textAlign: "center",
          padding: "2rem",
        }}
      >
        <h2 style={{ fontSize: "1.4rem", fontWeight: 600 }}>Something went wrong</h2>
        <p style={{ color: "#94a3b8", maxWidth: 420 }}>
          An unexpected error occurred. Our team has been notified. You can try again below.
        </p>
        <button
          onClick={() => reset()}
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 1.4rem",
            borderRadius: 8,
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
            color: "#fff",
            background: "linear-gradient(135deg, #0ea5e9, #0284c7)",
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
