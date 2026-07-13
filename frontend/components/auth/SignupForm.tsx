"use client";

/**
 * SignupForm — email/password registration form with Zod validation.
 *
 * Validation rules (mirror the backend):
 *   - email:           valid format
 *   - password:        min 8 chars, ≥1 uppercase, ≥1 digit
 *   - confirmPassword: must match password
 *
 * On submit:  POST /auth/register via the shared axios instance.
 * On success: router.push("/login")
 * On error:   shows the API error detail message inline below the form.
 *
 * The component also renders the vault icon, app name, tagline, Google
 * button, and divider — composing the full card content.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import GoogleButton from "./GoogleButton";

// ── Zod schema ───────────────────────────────────────────────────────────────

const signupSchema = z
  .object({
    email: z
      .string()
      .min(1, "Email is required")
      .email("Enter a valid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[0-9]/, "Password must contain at least one number"),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SignupFormValues = z.infer<typeof signupSchema>;

// ── Shared input style ────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.75rem 1rem",
  borderRadius: "8px",
  border: "1.5px solid #e0e7ff",
  background: "#ffffff",
  fontSize: "0.95rem",
  color: "#1f2937",
  outline: "none",
  transition: "border-color 0.2s ease, box-shadow 0.2s ease",
  boxSizing: "border-box",
};

const inputFocusStyle: React.CSSProperties = {
  borderColor: "#0ea5e9",
  boxShadow: "0 0 0 3px rgba(14, 165, 233, 0.1)",
};

// ── Input wrapper with inline error ──────────────────────────────────────────

function AuthInput({
  type,
  placeholder,
  error,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & {
  error?: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <input
        type={type}
        placeholder={placeholder}
        style={{
          ...inputStyle,
          ...(focused ? inputFocusStyle : {}),
        }}
        className="placeholder:[color:#6b8fa0]"
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
// Email verification is active. mlguppy.site is a verified Resend sending domain,
// so verification links are delivered to the actual user's inbox.
// To disable: set to false and comment out the token/email blocks in auth.py.
const EMAIL_VERIFICATION_ENABLED: boolean = true;
// ── Main component ────────────────────────────────────────────────────────────

export default function SignupForm() {
  // When non-null, the form is replaced by the "check your email" screen.
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  // State for the "resend" button on the check-email screen.
  const [resendStatus, setResendStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
  });

  // ── Form submit handler ─────────────────────────────────────────────────────
  const onSubmit = async (values: SignupFormValues) => {
    setApiError(null);
    try {
      // POST /auth/register — expects { email, password }
      await api.post("/auth/register", {
        email: values.email,
        password: values.password,
      });
      if (EMAIL_VERIFICATION_ENABLED) {
        // Show the "check your email" screen instead of redirecting to login.
        setRegisteredEmail(values.email);
      } else {
        // Verification disabled — the account is created pre-verified, so skip
        // the check-email screen and send the user straight to login.
        router.push("/login");
      }
    } catch (err: unknown) {
      // Extract the FastAPI detail message, fall back to a generic string
      const detail =
        (err as { response?: { data?: { detail?: string | { msg: string }[] } } })
          ?.response?.data?.detail;

      if (Array.isArray(detail)) {
        // Pydantic 422 returns an array of {msg, loc, ...} objects
        setApiError(detail.map((d) => d.msg).join(" · "));
      } else if (typeof detail === "string") {
        setApiError(detail);
      } else {
        setApiError("Something went wrong. Please try again.");
      }
    }
  };

  // ── Resend verification email ───────────────────────────────────────────────
  const handleResend = async () => {
    if (!registeredEmail || resendStatus === "sending") return;
    setResendStatus("sending");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: registeredEmail }),
      });
      setResendStatus(res.ok ? "sent" : "error");
    } catch {
      setResendStatus("error");
    }
  };

  // ── Google OAuth handler (placeholder — wired to next-auth in a later step) ──
  const handleGoogleSignIn = () => {
    const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";
    window.location.href = `${apiBase}/auth/google`;
  };

  return (
    <>
      {/* ── Check-email screen (shown after successful registration) ──────── */}
      {registeredEmail ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "3.5rem", marginBottom: "1rem" }}>📧</div>

          <h2
            style={{
              fontSize: "1.5rem",
              fontWeight: 800,
              marginBottom: "0.5rem",
              background: "linear-gradient(135deg, #2d5766, #1e404b)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
            className="dark:[background:linear-gradient(135deg,#c0a0f0,#7dd3fc)] dark:[WebkitBackgroundClip:text] dark:[backgroundClip:text]"
          >
            Check your email!
          </h2>

          <p style={{ color: "#6b8fa0", fontSize: "0.95rem", marginBottom: "0.5rem" }}
             className="dark:[color:#7a8faa]">
            We sent a verification link to
          </p>
          <p style={{ fontWeight: 700, color: "#2d5766", marginBottom: "1.5rem", wordBreak: "break-all" }}
             className="dark:[color:#c0a0f0]">
            {registeredEmail}
          </p>

          <p style={{ color: "#6b8fa0", fontSize: "0.85rem", marginBottom: "1.5rem" }}
             className="dark:[color:#7a8faa]">
            Click the link in the email to activate your account.
            The link expires in <strong>24 hours</strong>.
          </p>

          {/* Resend button */}
          <button
            onClick={handleResend}
            disabled={resendStatus === "sending" || resendStatus === "sent"}
            style={{
              width: "100%",
              background: "linear-gradient(135deg, #3d7a8c, #1e4d5c)",
              color: "#fff",
              border: "none",
              borderRadius: 50,
              padding: "0.85rem",
              fontWeight: 700,
              fontSize: "0.95rem",
              cursor: resendStatus === "sending" || resendStatus === "sent" ? "not-allowed" : "pointer",
              opacity: resendStatus === "sending" || resendStatus === "sent" ? 0.7 : 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              marginBottom: "1rem",
            }}
            className="dark:[background:linear-gradient(135deg,#9b7cf0,#5db8fe)] dark:[color:#0a0f1a]"
          >
            {resendStatus === "sending" && <Loader2 size={16} className="animate-spin" />}
            {resendStatus === "sent" ? "Email resent!" : resendStatus === "sending" ? "Sending…" : "Resend verification email"}
          </button>

          {resendStatus === "error" && (
            <p style={{ color: "#FF8B94", fontSize: "0.8rem", marginBottom: "1rem" }}>
              Failed to resend. Please try again later.
            </p>
          )}

          {/* Sign-in link */}
          <p style={{ fontSize: "0.85rem", color: "#6b8fa0" }} className="dark:[color:#7a8faa]">
            Email verified?{" "}
            <a href="/login" style={{ color: "#FF8B94", fontWeight: 600, textDecoration: "none" }}>
              Sign in here
            </a>
          </p>
        </div>
      ) : (
        <>
      {/* ── Google button ─────────────────────────────────────────────────── */}
      <GoogleButton onSignIn={handleGoogleSignIn} disabled={isSubmitting} />

      {/* ── Divider ───────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          margin: "0.95rem 0",
          gap: "0",
        }}
      >
        <div
          style={{
            flex: 1,
            height: 1,
            background: "rgba(170, 200, 215, 0.5)",
          }}
        />
        <span
          style={{
            fontSize: "0.85rem",
            color: "#6b8fa0",
            padding: "0 1rem",
            whiteSpace: "nowrap",
          }}
          className="dark:[color:#7a8faa]"
        >
          or
        </span>
        <div
          style={{
            flex: 1,
            height: 1,
            background: "rgba(170, 200, 215, 0.5)",
          }}
        />
      </div>

      {/* ── Registration form ─────────────────────────────────────────────── */}
      <form
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
      >
        <AuthInput
          type="email"
          placeholder="Email address"
          error={errors.email?.message}
          {...register("email")}
        />

        <AuthInput
          type="password"
          placeholder="Password"
          error={errors.password?.message}
          {...register("password")}
        />

        <AuthInput
          type="password"
          placeholder="Confirm Password"
          error={errors.confirmPassword?.message}
          {...register("confirmPassword")}
        />

        {/* ── API-level error (e.g. 409 email already registered) ─────── */}
        {apiError && (
          <p
            style={{
              color: "#FF8B94",
              fontSize: "0.85rem",
              textAlign: "center",
              marginTop: "-0.25rem",
            }}
          >
            {apiError}
          </p>
        )}

        {/* ── Submit button ────────────────────────────────────────────── */}
        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            width: "100%",
            background: "#0ea5e9",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            padding: "0.75rem",
            fontWeight: 600,
            fontSize: "0.95rem",
            cursor: isSubmitting ? "not-allowed" : "pointer",
            transition: "background 0.2s ease",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.5rem",
            opacity: isSubmitting ? 0.7 : 1,
          }}
          className="dark:[background:#06b6d4] dark:[color:#ffffff]"
          onMouseEnter={(e) => {
            if (!isSubmitting) {
              (e.currentTarget as HTMLButtonElement).style.background =
                "#0284c7";
            }
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background =
              "#0ea5e9";
          }}
        >
          {isSubmitting && <Loader2 size={18} className="animate-spin" />}
          Create Account
        </button>
      </form>

      {/* ── Link to login ─────────────────────────────────────────────────── */}
      <p
        style={{
          textAlign: "center",
          marginTop: "0.35rem",
          fontSize: "0.8rem",
          color: "#6b8fa0",
        }}
        className="dark:[color:#7a8faa]"
      >
        Already have an account?{" "}
        <a
          href="/login"
          style={{
            color: "#FF8B94",
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Sign in
        </a>
      </p>
    </>
      )}
    </>
  );
}
