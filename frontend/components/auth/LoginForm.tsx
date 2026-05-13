"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import api from "@/lib/api";
import GoogleButton from "./GoogleButton";

// ── Zod schema ────────────────────────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

// ── Shared input style ────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.9rem 1.3rem",
  borderRadius: 50,
  border: "2px solid rgba(170, 200, 215, 0.5)",
  background: "rgba(255, 255, 255, 0.85)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
  fontSize: "0.95rem",
  color: "#1a3a44",
  outline: "none",
  transition: "border-color 0.2s ease, box-shadow 0.2s ease",
  boxSizing: "border-box",
};

const inputFocusStyle: React.CSSProperties = {
  borderColor: "#8FD3F4",
  boxShadow: "0 0 0 4px rgba(143, 211, 244, 0.2)",
};

// ── Input with inline error ───────────────────────────────────────────────────

function AuthInput({
  type,
  placeholder,
  error,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  const [focused, setFocused] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <input
        type={type}
        placeholder={placeholder}
        style={{ ...inputStyle, ...(focused ? inputFocusStyle : {}) }}
        className="
          placeholder:[color:#6b8fa0]
        "
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        aria-invalid={!!error}
        {...rest}
      />
      {error && (
        <p style={{ color: "#FF8B94", fontSize: "0.8rem", paddingLeft: "1rem" }}>
          {error}
        </p>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LoginForm() {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | null>(null);
  // When true, the error is "email not verified" — show the resend button.
  const [showResend, setShowResend] = useState(false);
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  // Track the last attempted email so we can resend to it.
  const [lastEmail, setLastEmail] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (values: LoginFormValues) => {
    setApiError(null);
    setShowResend(false);
    setResendStatus("idle");
    setLastEmail(values.email);
    try {
      // Call the Next.js BFF login proxy — never FastAPI directly.
      // The proxy sets access_token + refresh_token as httpOnly cookies
      // and returns { ok: true }. No token ever reaches browser JavaScript.
      const res = await fetch("/api/auth/login", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: values.email, password: values.password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { detail?: string | { msg: string }[] };
        const detail = data?.detail;
        if (Array.isArray(detail)) {
          setApiError(detail.map((d) => d.msg).join(" · "));
        } else if (typeof detail === "string") {
          setApiError(detail);
          // 403 with "verify" in message → show the resend button
          if (res.status === 403 && detail.toLowerCase().includes("verify")) {
            setShowResend(true);
          }
        } else {
          setApiError("Something went wrong. Please try again.");
        }
        return;
      }

      router.push("/dashboard");
    } catch {
      setApiError("Something went wrong. Please try again.");
    }
  };

  const handleResend = async () => {
    if (!lastEmail || resendStatus === "sending") return;
    setResendStatus("sending");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: lastEmail }),
      });
      setResendStatus(res.ok ? "sent" : "error");
    } catch {
      setResendStatus("error");
    }
  };

  const handleGoogleSignIn = () => {
    // Redirect browser to the backend Google OAuth initiation endpoint.
    // The backend stores the OAuth state in a signed session cookie for CSRF
    // protection, then redirects to Google. On return, the backend issues our
    // own JWT + refresh token and redirects to /auth/callback with them.
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";
    window.location.href = `${apiBase}/auth/google`;
  };

  return (
    <>
      {/* ── App icon + name ─────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          style={{ margin: "0 auto 0.75rem" }}
        >
          <defs>
            <linearGradient id="vaultGrad-login" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#2d5766" />
              <stop offset="100%" stopColor="#1e404b" />
            </linearGradient>
          </defs>
          <rect x="8" y="14" width="32" height="26" rx="4" stroke="url(#vaultGrad-login)" strokeWidth="2.5" fill="none" />
          <path d="M16 14v-3a8 8 0 0 1 16 0v3" stroke="url(#vaultGrad-login)" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          <circle cx="24" cy="27" r="3.5" stroke="url(#vaultGrad-login)" strokeWidth="2" fill="none" />
          <line x1="24" y1="30.5" x2="24" y2="34" stroke="url(#vaultGrad-login)" strokeWidth="2" strokeLinecap="round" />
        </svg>

        <h1
          style={{
            fontSize: "1.7rem",
            fontWeight: 800,
            background: "linear-gradient(135deg, #2d5766, #1e404b)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            margin: 0,
          }}
        >
          Idea Vault
        </h1>
        <p
          style={{ color: "#6b8fa0", fontSize: "0.88rem", marginTop: "0.3rem" }}
          className="dark:[color:#7a8faa]"
        >
          Welcome back
        </p>
      </div>

      {/* ── Google button ────────────────────────────────────────────────── */}
      <GoogleButton onSignIn={handleGoogleSignIn} />

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          margin: "1.25rem 0",
        }}
      >
        <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.1)" }} className="dark:[background:rgba(255,255,255,0.1)]" />
        <span style={{ fontSize: "0.8rem", color: "#9ab0be" }}>or</span>
        <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.1)" }} className="dark:[background:rgba(255,255,255,0.1)]" />
      </div>

      {/* ── Form ─────────────────────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit(onSubmit)}
        style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
        noValidate
      >
        <AuthInput
          type="email"
          placeholder="Email"
          error={errors.email?.message}
          {...register("email")}
        />

        <AuthInput
          type="password"
          placeholder="Password"
          error={errors.password?.message}
          {...register("password")}
        />

        {apiError && (
          <div style={{ textAlign: "center", marginTop: "-0.25rem" }}>
            <p style={{ color: "#FF8B94", fontSize: "0.85rem" }}>{apiError}</p>

            {/* Resend verification link — shown when backend says email not verified */}
            {showResend && (
              <div style={{ marginTop: "0.5rem" }}>
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendStatus === "sending" || resendStatus === "sent"}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#8FD3F4",
                    fontSize: "0.82rem",
                    cursor: resendStatus === "sending" || resendStatus === "sent" ? "default" : "pointer",
                    textDecoration: "underline",
                    padding: 0,
                  }}
                >
                  {resendStatus === "sent"
                    ? "✓ Verification email sent!"
                    : resendStatus === "sending"
                    ? "Sending…"
                    : "Resend verification email"}
                </button>
                {resendStatus === "error" && (
                  <p style={{ color: "#FF8B94", fontSize: "0.75rem", marginTop: "0.25rem" }}>
                    Failed to send. Please try again.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            width: "100%",
            background: "linear-gradient(135deg, #3d7a8c, #1e4d5c)",
            color: "#fff",
            border: "none",
            borderRadius: 50,
            padding: "0.95rem",
            fontWeight: 700,
            fontSize: "1rem",
            cursor: isSubmitting ? "not-allowed" : "pointer",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.15)",
            transition: "box-shadow 0.25s ease, transform 0.25s ease",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            opacity: isSubmitting ? 0.8 : 1,
          }}
          className="dark:[background:linear-gradient(135deg,#9b7cf0,#5db8fe)] dark:[color:#0a0f1a]"
          onMouseEnter={(e) => {
            if (!isSubmitting) {
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-3px)";
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 14px 32px rgba(0,0,0,0.25)";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
            (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.15)";
          }}
        >
          {isSubmitting && <Loader2 size={18} className="animate-spin" />}
          Sign In
        </button>
      </form>

      {/* ── Link to signup ───────────────────────────────────────────────── */}
      <p
        style={{
          textAlign: "center",
          marginTop: "0.5rem",
          fontSize: "0.8rem",
          color: "#6b8fa0",
        }}
        className="dark:[color:#7a8faa]"
      >
        Don&apos;t have an account?{" "}
        <a
          href="/signup"
          style={{ color: "#FF8B94", fontWeight: 600, textDecoration: "none" }}
        >
          Sign up
        </a>
      </p>

      {/* ── Forgot password link ─────────────────────────────────────────── */}
      <p
        style={{
          textAlign: "center",
          marginTop: "0.25rem",
          fontSize: "0.8rem",
          color: "#6b8fa0",
        }}
        className="dark:[color:#7a8faa]"
      >
        <a
          href="/forgot-password"
          style={{ color: "#6b8fa0", textDecoration: "underline" }}
          className="dark:[color:#7a8faa]"
        >
          Forgot password?
        </a>
      </p>
    </>
  );
}
