"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * /forgot-password
 *
 * Accepts an email address and calls the BFF route, which proxies to FastAPI.
 * Always shows the same "check your inbox" message regardless of whether the
 * email is registered — prevents account-enumeration attacks.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (res.status === 429) {
        const data = await res.json();
        setError(data.detail ?? "Too many requests. Please wait and try again.");
        return;
      }

      // Treat all non-429 responses as success — backend never reveals
      // whether the email exists (always returns 200 with a generic message).
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-cyan-100 via-purple-100 to-orange-100 dark:from-[#1a1a3e] dark:via-[#1e2a4a] dark:to-[#1a2035] p-4">
      <div className="w-full max-w-md bg-white/80 dark:bg-white/10 backdrop-blur-lg rounded-3xl border border-white/70 dark:border-white/20 shadow-xl p-10">
        {submitted ? (
          <div className="text-center">
            <div className="text-5xl mb-4">📧</div>
            <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
              Check Your Inbox
            </h1>
            <p className="text-gray-600 dark:text-gray-300 mb-6">
              If <strong>{email}</strong> is registered, you&apos;ll receive a
              password reset link shortly. The link expires in 1 hour.
            </p>
            <Link
              href="/login"
              className="text-indigo-500 hover:text-indigo-600 font-semibold"
            >
              Back to Login
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
              Forgot Password
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">
              Enter your email and we&apos;ll send you a reset link.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-white/20 bg-white/60 dark:bg-white/5 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="you@example.com"
                />
              </div>

              {error && (
                <p className="text-red-500 text-sm">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 text-white rounded-xl font-semibold transition-colors"
              >
                {loading ? "Sending…" : "Send Reset Link"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
              Remembered it?{" "}
              <Link
                href="/login"
                className="text-indigo-500 hover:text-indigo-600 font-semibold"
              >
                Back to Login
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
