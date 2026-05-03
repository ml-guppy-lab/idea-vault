/**
 * /app/(auth)/signup/page.tsx — Sign Up page
 *
 * Route: /signup
 * Layout: full-viewport gradient background, centered glass card, no navbar.
 *
 * Composed from:
 *   BackgroundOrbs  — decorative fixed radial gradients behind everything
 *   AuthCard        — glassmorphism card wrapper with gradient top strip
 *   SignupForm      — form with Zod validation + POST /auth/register call
 *
 * Dark mode: triggered by adding class="dark" to <html>. Background gradient
 * and orb colours switch automatically via Tailwind dark: variants.
 */

import BackgroundOrbs from "@/components/auth/BackgroundOrbs";
import AuthCard from "@/components/auth/AuthCard";
import SignupForm from "@/components/auth/SignupForm";

export const metadata = {
  title: "Sign Up — Idea Vault",
  description: "Create your Idea Vault account",
};

export default function SignupPage() {
  return (
    <>
      {/* ── Full-viewport gradient background ──────────────────────────── */}
      <div
        style={{
          minHeight: "100vh",
          backgroundImage:
            "linear-gradient(135deg, #d4f1f9 0%, #e8d5f5 30%, #fce4d6 60%, #d5f5e8 100%)",
          backgroundAttachment: "fixed",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem 1rem",
          position: "relative",
        }}
        className="
          dark:[background-image:linear-gradient(135deg,#1a1a3e_0%,#1e2a4a_30%,#1a2035_60%,#1e1a35_100%)]
        "
      >
        {/* Decorative background orbs — sit at z-index 0 behind card */}
        <BackgroundOrbs />

        {/* Centered glass auth card */}
        <AuthCard>
          <SignupForm />
        </AuthCard>
      </div>
    </>
  );
}
