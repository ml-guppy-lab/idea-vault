"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, Plus } from "lucide-react";
import IdeaCard from "@/components/IdeaCard";

type Status = "Raw" | "Exploring" | "Validated" | "Building" | "Shipped" | "Abandoned";
type Priority = "Low" | "Medium" | "High";

interface Idea {
  id: string;
  title: string;
  description: string;
  tags: string[];
  status: Status;
  priority: Priority;
  createdAt: string;
}

const FILTERS = ["All", "Raw", "Exploring", "Validated", "Building", "Shipped", "Abandoned"] as const;

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: "1.4rem", marginBottom: "1rem" }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ height: 200, borderRadius: 22, overflow: "hidden", position: "relative" }}
          className="[background:rgba(255,255,255,0.5)] dark:[background:rgba(20,28,45,0.5)]">
          <div className="shimmer" style={{ position: "absolute", inset: 0 }} />
        </div>
      ))}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ isDark }: { isDark: boolean }) {
  const grad = isDark ? "linear-gradient(135deg,#c0a0f0,#7dd3fc)" : "linear-gradient(135deg,#2d5766,#1e404b)";
  return (
    <div style={{
      background: "rgba(255,255,255,0.75)", backdropFilter: "blur(16px)", borderRadius: 32,
      border: "2px dashed rgba(170,200,215,0.5)", padding: "4rem 2rem", textAlign: "center",
      boxShadow: "0 12px 32px rgba(80,120,140,0.12)",
    }} className="dark:[background:rgba(20,28,45,0.7)]">
      <img src="/logo1.jpeg" alt="Idea Vault" style={{ width: 120, height: "auto", margin: "0 auto 1.5rem", borderRadius: 16, display: "block", boxShadow: "0 4px 14px rgba(0,0,0,0.1)" }} />
      <p style={{ fontSize: "1.7rem", fontWeight: 700, background: grad, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", margin: "0 0 0.5rem" }}>
        Your vault is empty
      </p>
      <p style={{ color: "#6b8fa0", marginBottom: "2rem", fontSize: "0.95rem" }}>Drop your first brilliant idea and watch it grow!</p>
      <NewIdeaButton />
    </div>
  );
}

// ── Shared buttons ────────────────────────────────────────────────────────────

function NewIdeaButton() {
  const [hov, setHov] = useState(false);
  return (
    <Link href="/dashboard/ideas/new" style={{ textDecoration: "none" }}>
      <button onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} style={{
        display: "inline-flex", alignItems: "center", gap: "0.4rem",
        padding: "0.75rem 1.8rem", borderRadius: 50, border: "none", fontWeight: 700, fontSize: "0.9rem",
        color: "#fff", cursor: "pointer",
        boxShadow: hov ? "0 14px 32px rgba(0,0,0,0.3)" : "0 8px 24px rgba(0,0,0,0.2)",
        transform: hov ? "translateY(-3px)" : "translateY(0)",
        transition: "all 0.25s ease",
      }} className="[background:linear-gradient(135deg,#3d7a8c,#1e4d5c)] dark:[background:linear-gradient(135deg,#9b7cf0,#5db8fe)] dark:[color:#0a0f1a]">
        <Plus size={16} /> New Idea
      </button>
    </Link>
  );
}

// ── Main client component ─────────────────────────────────────────────────────

export default function DashboardClient({ ideas, userName, loading }: {
  ideas: Idea[];
  userName: string;
  loading?: boolean;
}) {
  const [query, setQuery]       = useState("");
  const [filter, setFilter]     = useState<typeof FILTERS[number]>("All");
  const [searchFocused, setSearchFocused] = useState(false);

  const filtered = useMemo(() => ideas.filter((idea) => {
    const matchesFilter = filter === "All" || idea.status === filter;
    const q = query.toLowerCase();
    const matchesQuery = !q || idea.title.toLowerCase().includes(q) || idea.description?.toLowerCase().includes(q) || idea.tags.some((t) => t.toLowerCase().includes(q));
    return matchesFilter && matchesQuery;
  }), [ideas, filter, query]);

  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1rem 2rem" }} className="max-[480px]:!px-4">

      {/* Welcome header */}
      <div style={{ margin: "1.5rem 0 0.5rem" }}>
        <h1 style={{ fontSize: "1.6rem", fontWeight: 600, margin: 0 }} className="logo-text">
          👋 Welcome back, {userName.split(" ")[0]}
        </h1>
        <p style={{ fontSize: "0.9rem", margin: "0.3rem 0 0" }} className="[color:#6b8fa0] dark:[color:#7a8faa]">
          Your ideas are waiting. Never lose a thought again.
        </p>
      </div>

      {/* Controls bar */}
      <div style={{
        background: "rgba(255,255,255,0.75)", backdropFilter: "blur(16px)",
        borderRadius: 24, padding: "1rem 1.4rem", margin: "1.5rem 0",
        border: "1px solid rgba(255,255,255,0.7)", boxShadow: "0 12px 32px rgba(80,120,140,0.12)",
        display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "1rem",
      }} className="dark:[background:rgba(20,28,45,0.7)] dark:[border-color:rgba(180,160,240,0.25)]">

        {/* Search */}
        <div style={{
          flex: 1, maxWidth: 380, display: "flex", alignItems: "center", gap: "0.5rem",
          padding: "0.5rem 1.3rem", borderRadius: 50,
          border: `2px solid ${searchFocused ? "#8FD3F4" : "rgba(170,200,215,0.5)"}`,
          boxShadow: searchFocused ? "0 4px 12px rgba(80,120,140,0.08), 0 0 0 5px rgba(143,211,244,0.2)" : "0 4px 12px rgba(80,120,140,0.08)",
          transition: "all 0.2s ease",
        }} className="max-[700px]:max-w-full max-[700px]:w-full bg-white/60 dark:bg-white/10">
          <Search size={17} color="#6b8fa0" />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
            placeholder="Search your vault..."
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: "0.95rem" }}
            className="text-[#1a3a44] dark:text-[#8fafc8] placeholder:text-[#6b8fa0]"
          />
        </div>

        {/* Filter pills + button */}
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" }}>
          {FILTERS.slice(0, 5).map((f) => {
            const active = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "0.45rem 1.1rem", borderRadius: 50, fontSize: "0.82rem",
                fontWeight: active ? 600 : 500, border: active ? "2px solid transparent" : "2px solid rgba(170,200,215,0.5)",
                background: active ? "linear-gradient(135deg,#A8E6CF,#7ecbf0,#C7CEEA)" : "rgba(255,255,255,0.6)",
                color: "#3d6678", cursor: "pointer",
                boxShadow: active ? "0 0 30px rgba(168,230,207,0.35)" : "0 4px 12px rgba(80,120,140,0.08)",
                transition: "all 0.2s ease",
              }}>
                {f}
              </button>
            );
          })}
          <NewIdeaButton />
        </div>
      </div>

      {/* Grid / skeleton / empty */}
      {loading ? (
        <SkeletonGrid />
      ) : filtered.length === 0 && query === "" && filter === "All" ? (
        <EmptyState isDark={isDark} />
      ) : filtered.length === 0 ? (
        <p style={{ color: "#6b8fa0", textAlign: "center", padding: "3rem" }}>No ideas match your search.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))", gap: "1.4rem", marginBottom: "1rem" }}>
          {filtered.map((idea, i) => (
            <IdeaCard key={idea.id} {...idea} gradientIndex={i} />
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "1.8rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
        <div style={{ width: 20, height: 20, borderRadius: 6, background: "linear-gradient(135deg,#A8E6CF,#7ecbf0,#C7CEEA)", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", flexShrink: 0 }} />
        <span style={{ fontSize: "0.78rem", color: "#6b8fa0", opacity: 0.7, fontWeight: 500 }}>Built by The ML Guppy</span>
      </div>
    </div>
  );
}
