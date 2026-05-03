/**
 * AuthCard — the glassmorphism container that wraps all auth UI.
 *
 * Spec:
 * - max-width 460px, rounded-[36px]
 * - glass: bg white/75 + backdrop-blur-[28px]
 * - border: 1px solid white/70
 * - box-shadow: layered drop shadow + green glow
 * - 6px gradient strip across the top (absolute positioned)
 * - fade-in animation on mount via auth-card-enter class (defined in globals.css)
 * - Dark mode: darker bg, purple-tinted border + glow
 */

import { ReactNode } from "react";

interface AuthCardProps {
  children: ReactNode;
}

export default function AuthCard({ children }: AuthCardProps) {
  return (
    <div
      className="auth-card-enter relative z-10 w-full"
      style={{ maxWidth: 460 }}
    >
      {/* ── gradient strip across the top ───────────────────────────────── */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 6,
          borderRadius: "36px 36px 0 0",
          background: "linear-gradient(135deg, #A8E6CF, #7ecbf0, #C7CEEA)",
        }}
      />

      {/* ── glass card body ─────────────────────────────────────────────── */}
      <div
        style={{
          borderRadius: 36,
          padding: "3.5rem 3rem",
          background: "rgba(255, 255, 255, 0.75)",
          backdropFilter: "blur(28px)",
          WebkitBackdropFilter: "blur(28px)",
          border: "1px solid rgba(255, 255, 255, 0.7)",
          boxShadow:
            "0 30px 60px rgba(60, 100, 130, 0.18), 0 0 30px rgba(168, 230, 207, 0.3)",
        }}
        className="
          dark:[background:rgba(20,28,45,0.7)]
          dark:[border:1px_solid_rgba(180,160,240,0.25)]
          dark:[box-shadow:0_30px_60px_rgba(0,0,0,0.5),0_0_35px_rgba(185,128,240,0.4)]
          max-[480px]:!p-8
          max-[480px]:!rounded-[24px]
        "
      >
        {children}
      </div>
    </div>
  );
}
