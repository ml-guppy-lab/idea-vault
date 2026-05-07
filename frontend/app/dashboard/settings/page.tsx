"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor } from "lucide-react";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const isDark = mounted && theme === "dark";

  const bg     = isDark ? "rgba(16,22,38,0.85)"     : "rgba(255,255,255,0.72)";
  const border = isDark ? "rgba(100,120,170,0.3)"   : "rgba(170,200,215,0.5)";
  const text   = isDark ? "#e8eef8"                 : "#1a3a44";
  const muted  = "#6b8fa0";

  const cardStyle: React.CSSProperties = {
    background: bg,
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    borderRadius: 24,
    border: `1px solid ${border}`,
    padding: "2rem",
    marginBottom: "1.5rem",
  };

  const themes = [
    { key: "light", label: "Light",  icon: Sun  },
    { key: "dark",  label: "Dark",   icon: Moon },
  ] as const;

  if (!mounted) return null;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "2.5rem 1.25rem 4rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: text, margin: 0 }}>
          Settings
        </h1>
        <p style={{ color: muted, marginTop: "0.3rem", fontSize: "0.95rem" }}>
          Manage your app preferences
        </p>
      </div>

      {/* ── Appearance ────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, color: text, margin: "0 0 1.25rem" }}>
          Appearance
        </h2>
        <p style={{ color: muted, fontSize: "0.88rem", marginBottom: "1rem" }}>
          Choose your preferred color scheme.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {themes.map(({ key, label, icon: Icon }) => {
            const active = theme === key;
            return (
              <button
                key={key}
                onClick={() => setTheme(key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.6rem 1.25rem",
                  borderRadius: 50,
                  border: `2px solid ${active ? "#7ecbf0" : border}`,
                  background: active
                    ? (isDark ? "rgba(126,203,240,0.15)" : "rgba(126,203,240,0.2)")
                    : "transparent",
                  color: active ? (isDark ? "#7ecbf0" : "#1a3a44") : muted,
                  fontWeight: active ? 700 : 500,
                  fontSize: "0.9rem",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                <Icon size={16} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── About ─────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, color: text, margin: "0 0 1rem" }}>
          About
        </h2>
        <div style={{ display: "grid", gap: "0.6rem" }}>
          {[
            ["App",     "Idea Vault"],
            ["Version", "1.0.0"],
            ["Purpose", "Never lose a thought again"],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", gap: "1rem" }}>
              <span style={{ color: muted, fontSize: "0.88rem", minWidth: 80 }}>{label}</span>
              <span style={{ color: text, fontSize: "0.88rem", fontWeight: 500 }}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
