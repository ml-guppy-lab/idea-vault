"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

/**
 * /verify-email?token=...
 *
 * Reads the one-time token from the URL query param and calls the BFF route,
 * which proxies to FastAPI. Shows success/error feedback.
 */
function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">(
    "loading"
  );
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");

    if (!token) {
      setStatus("error");
      setMessage("Verification link is invalid. Please check your email for the correct link.");
      return;
    }

    fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.message) {
          setStatus("success");
          setMessage(data.message);
        } else {
          setStatus("error");
          setMessage(data.detail ?? "Verification failed. Please request a new link.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("Something went wrong. Please try again.");
      });
  }, [searchParams]);

  return (
    <div className="text-center">
      {status === "loading" && (
        <p className="text-gray-500 dark:text-gray-400">Verifying your email…</p>
      )}

      {status === "success" && (
        <>
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
            Email Verified!
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mb-6">{message}</p>
          <Link
            href="/login"
            className="inline-block px-6 py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-semibold transition-colors"
          >
            Go to Login
          </Link>
        </>
      )}

      {status === "error" && (
        <>
          <div className="text-5xl mb-4">❌</div>
          <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
            Verification Failed
          </h1>
          <p className="text-gray-600 dark:text-gray-300 mb-6">{message}</p>
          <Link
            href="/login"
            className="inline-block px-6 py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-semibold transition-colors"
          >
            Back to Login
          </Link>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-cyan-100 via-purple-100 to-orange-100 dark:from-[#1a1a3e] dark:via-[#1e2a4a] dark:to-[#1a2035] p-4">
      <div className="w-full max-w-md bg-white/80 dark:bg-white/10 backdrop-blur-lg rounded-3xl border border-white/70 dark:border-white/20 shadow-xl p-10">
        {/* Suspense is required because useSearchParams() opts into dynamic rendering */}
        <Suspense fallback={<p className="text-center text-gray-500">Loading…</p>}>
          <VerifyEmailContent />
        </Suspense>
      </div>
    </div>
  );
}
