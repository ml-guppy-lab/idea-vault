"use client";

import Link from "next/link";
import { useState } from "react";

interface IdeaCardProps {
  id: string;
  title: string;
  description: string;
  tags: string[];
  status: "Raw" | "Exploring" | "Validated" | "Building" | "Shipped" | "Abandoned";
  priority: "Low" | "Medium" | "High";
  image?: string;
  createdAt: string;
  gradientIndex?: number;
}

const GRADIENTS_LIGHT = [
  "linear-gradient(135deg,#A8E6CF,#7ecbf0,#C7CEEA)",
  "linear-gradient(135deg,#FFB7C5,#f5c4a1,#8FD3F4)",
  "linear-gradient(135deg,#E2B0FF,#a8d8ea,#A8E6CF)",
  "linear-gradient(135deg,#8FD3F4,#f9d5bb,#FF8B94)",
  "linear-gradient(135deg,#FFD3B6,#c5e0d8,#B5EAD7)",
];

const GRADIENTS_DARK = [
  "linear-gradient(135deg,#B980F0,#38bdf8,#FF6B6B)",
  "linear-gradient(135deg,#FFE66D,#ff8c6b,#B980F0)",
  "linear-gradient(135deg,#4ECDC4,#8b7cf0,#FFE66D)",
  "linear-gradient(135deg,#1A535C,#38bdf8,#FF6B6B)",
  "linear-gradient(135deg,#B980F0,#ff6b8a,#4ECDC4)",
];

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  Raw:       { bg: "#FFD3B6", color: "#5a3e2b", label: "RAW" },
  Exploring: { bg: "#A8E6CF", color: "#1b4d3e", label: "EXPLORING" },
  Validated: { bg: "#8FD3F4", color: "#1a4560", label: "VALIDATED" },
  Building:  { bg: "#C7CEEA", color: "#2d3a6e", label: "BUILDING" },
  Shipped:   { bg: "#B5EAD7", color: "#1e4a3a", label: "SHIPPED" },
  Abandoned: { bg: "#FFB7C5", color: "#6e2d3a", label: "ABANDONED" },
};

const PRIORITY_COLOR: Record<string, string> = {
  Low:    "#A8E6CF",
  Medium: "#FFE66D",
  High:   "#FF8B94",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function IdeaCard({
  id, title, description, tags, status, priority, image, createdAt, gradientIndex = 0,
}: IdeaCardProps) {
  const [hovered, setHovered] = useState(false);
  const idx = gradientIndex % 5;
  const st = STATUS_STYLES[status];
  const pColor = PRIORITY_COLOR[priority];

  return (
    <Link href={`/dashboard/ideas/${id}`} style={{ textDecoration: "none" }}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          borderRadius: 22,
          overflow: "hidden",
          border: `1px solid ${hovered ? "rgba(143,211,244,0.5)" : "rgba(255,255,255,0.7)"}`,
          boxShadow: hovered
            ? "0 24px 44px -12px rgba(0,0,0,0.2), 0 0 0 2px rgba(143,211,244,0.3)"
            : "0 12px 32px rgba(80,120,140,0.12)",
          cursor: "pointer",
          position: "relative",
          transform: hovered ? "translateY(-8px)" : "translateY(0)",
          transition: "all 0.3s ease",
        }}
        className="
          [background:rgba(255,255,255,0.75)] [backdrop-filter:blur(14px)]
          dark:[background:rgba(20,28,45,0.7)] dark:[border-color:rgba(180,160,240,0.25)]
        "
      >
        {/* Gradient top strip */}
        <div style={{ height: 5, background: GRADIENTS_LIGHT[idx] }} className="dark-strip" />
        <style>{`.dark .dark-strip { background: ${GRADIENTS_DARK[idx]} !important; }`}</style>

        <div style={{ padding: "1.4rem" }}>
          {/* Optional image */}
          {image && (
            <img src={image} alt={title} style={{
              width: "100%", height: 140, objectFit: "cover", borderRadius: 14,
              boxShadow: "0 4px 14px rgba(0,0,0,0.1)", marginBottom: "0.8rem", display: "block",
            }} />
          )}

          {/* Status badge */}
          <span style={{
            display: "inline-block", padding: "0.25rem 0.8rem", borderRadius: 50,
            fontSize: "0.68rem", fontWeight: 700, letterSpacing: "0.6px",
            background: st.bg, color: st.color, boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          }}>
            {st.label}
          </span>

          {/* Title */}
          <p style={{
            fontWeight: 700, fontSize: "1.05rem", letterSpacing: "-0.2px",
            margin: "0.6rem 0 0.3rem",
          }} className="[color:#1a3a44] dark:[color:#e6eefc]">
            {title}
          </p>

          {/* Description — 2-line clamp */}
          <p style={{
            fontSize: "0.85rem", lineHeight: 1.5, margin: "0 0 0.75rem",
            display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
          }} className="[color:#3d6678] dark:[color:#b4c8e0]">
            {description}
          </p>

          {/* Tags */}
          {tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginBottom: "0.9rem" }}>
              {tags.map((tag) => (
                <span key={tag} style={{
                  padding: "0.2rem 0.6rem", borderRadius: 50, fontSize: "0.7rem",
                  border: "1px solid rgba(170,200,215,0.5)",
                }} className="bg-white/60 dark:bg-white/10 text-[#3d6678] dark:text-[#c8dff0]">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Footer */}
          <div style={{
            borderTop: "1px solid rgba(170,200,215,0.5)", paddingTop: "0.7rem",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            fontSize: "0.72rem",
          }} className="[color:#6b8fa0]">
            {/* Priority dot */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <div style={{
                width: 9, height: 9, borderRadius: "50%", background: pColor,
                boxShadow: `0 0 8px ${pColor}`,
              }} />
              {priority}
            </div>
            <span>{formatDate(createdAt)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
