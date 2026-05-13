"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

/**
 * /reset-password?token=...
 *
 * Reads the one-time reset token from the URL, shows a new-password form,
 * and proxies the submission to FastAPI via the BFF route.
 */
function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Same rules enforced by the backend (shown here for immediate UX feedback)
  function validate(): string {
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter.";
    if (!/[0-9]/.test(password)) return "Password must contain at least one number.";
    if (password !== confirm) return "Passwords do not match.";
    return "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!token) {
      setError("Reset token is missing. Please use the link from your email.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.detail ?? "Reset failed. Please request a new link.");
        return;
      }

      setDone(true);
      // Redirect to login after a short delay so the user can read the message
      setTimeout(() => router.push("/login"), 2500);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="text-center">
        <div className="text-5xl mb-4">❌</div>
        <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
          Invalid Link
        </h1>
        <p className="text-gray-600 dark:text-gray-300 mb-6">
          This reset link is missing a token. Please use the link from your email.
        </p>
        <Link href="/forgot-password" className="text-indigo-500 hover:text-indigo-600 font-semibold">
          Request New Link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="text-center">
        <div className="text-5xl mb-4">✅</div>
        <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
          Password Reset!
        </h1>
        <p className="text-gray-600 dark:text-gray-300">
          Your password has been updated. Redirecting to login…
        </p>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold mb-2 text-gray-900 dark:text-white">
        Reset Password
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-6 text-sm">
        Choose a new password for your account.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            New Password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-white/20 bg-white/60 dark:bg-white/5 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="Min 8 chars, 1 uppercase, 1 number"
          />
        </div>

        <div>
          <label
            htmlFor="confirm"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Confirm Password
          </label>
          <input
            id="confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-white/20 bg-white/60 dark:bg-white/5 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            placeholder="Repeat password"
          />
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-60 text-white rounded-xl font-semibold transition-colors"
        >
          {loading ? "Resetting…" : "Reset Password"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
        Link expired?{" "}
        <Link href="/forgot-password" className="text-indigo-500 hover:text-indigo-600 font-semibold">
          Request a new one
        </Link>
      </p>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-cyan-100 via-purple-100 to-orange-100 dark:from-[#1a1a3e] dark:via-[#1e2a4a] dark:to-[#1a2035] p-4">
      <div className="w-full max-w-md bg-white/80 dark:bg-white/10 backdrop-blur-lg rounded-3xl border border-white/70 dark:border-white/20 shadow-xl p-10">
        <Suspense fallback={<p className="text-center text-gray-500">Loading…</p>}>
          <ResetPasswordContent />
        </Suspense>
      </div>
    </div>
  );
}
