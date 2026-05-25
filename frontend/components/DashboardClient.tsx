"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, Plus, Sparkles, X } from "lucide-react";
import { useTheme } from "next-themes";
import IdeaCard from "@/components/IdeaCard";
import ChatWindow from "@/components/chat/ChatWindow";
import type { Task } from "@/types/task";

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
  tasks?: Task[];
}

const FILTERS = ["All", "Raw", "Exploring", "Validated", "Building", "Shipped", "Abandoned"] as const;

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ height: 220, borderRadius: 22, overflow: "hidden", position: "relative" }}
          className="bg-white/50 dark:bg-[rgba(20,28,45,0.5)]">
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
    }} className="dark:bg-[rgba(20,28,45,0.7)]">
      <img src="/logo1.jpeg" alt="Idea Vault" style={{ width: 120, height: "auto", margin: "0 auto 1.5rem", borderRadius: 16, display: "block", boxShadow: "0 4px 14px rgba(0,0,0,0.1)" }} />
      <p style={{ fontSize: "1.7rem", fontWeight: 700, background: grad, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text", margin: "0 0 0.5rem" }}>
        Your vault is empty
      </p>
      <p style={{ color: "#6b8fa0", marginBottom: "2rem", fontSize: "0.95rem" }}>Drop your first brilliant idea and watch it grow!</p>
      <NewIdeaButton />
    </div>
  );
}

// ── New Idea button ────────────────────────────────────────────────────────────

function NewIdeaButton({ fullWidth = false }: { fullWidth?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <Link href="/dashboard/ideas/new" style={{ textDecoration: "none", display: fullWidth ? "block" : "inline-block" }}>
      <button onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)} style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem",
        padding: "0.75rem 1.8rem", borderRadius: 50, border: "none", fontWeight: 700, fontSize: "0.95rem",
        color: "#fff", cursor: "pointer", width: fullWidth ? "100%" : "auto",
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

export default function DashboardClient({ ideas, userName, userId, loading }: {
  ideas: Idea[];
  userName: string;
  userId: string;
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

  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <>
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

      {/* Welcome header */}
      <div className="mt-6 mb-2 text-center sm:text-left">
        <h1 className="logo-text text-2xl sm:text-3xl font-semibold m-0">
          👋 Welcome back, {userName.split(" ")[0]}
        </h1>
        <p className="text-sm sm:text-base mt-1 text-[#6b8fa0] dark:text-[#7a8faa]">
          Your ideas are waiting. Never lose a thought again.
        </p>
      </div>

      {/* Controls bar */}
      <div style={{
        background: "rgba(255,255,255,0.75)", backdropFilter: "blur(16px)",
        borderRadius: 24, padding: "1rem 1.4rem", margin: "1.2rem 0",
        border: "1px solid rgba(255,255,255,0.7)", boxShadow: "0 12px 32px rgba(80,120,140,0.12)",
      }} className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-between gap-3 dark:bg-[rgba(20,28,45,0.7)] dark:border-[rgba(180,160,240,0.25)]">

        {/* Search */}
        <div style={{
          display: "flex", alignItems: "center", gap: "0.5rem",
          padding: "0.6rem 1.3rem", borderRadius: 50,
          border: `2px solid ${searchFocused ? "#8FD3F4" : "rgba(170,200,215,0.5)"}`,
          boxShadow: searchFocused ? "0 4px 12px rgba(80,120,140,0.08), 0 0 0 5px rgba(143,211,244,0.2)" : "0 4px 12px rgba(80,120,140,0.08)",
          transition: "all 0.2s ease", flex: 1,
        }} className="bg-white/60 dark:bg-white/10 min-w-0">
          <Search size={17} color="#6b8fa0" style={{ flexShrink: 0 }} />
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)}
            placeholder="Search your vault..."
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: "1rem", minWidth: 0 }}
            className="text-[#1a3a44] dark:text-[#8fafc8] placeholder:text-[#6b8fa0]"
          />
        </div>

        {/* Filter pills */}
        <div className="flex flex-wrap gap-2 items-center">
          {FILTERS.slice(0, 5).map((f) => {
            const active = filter === f;
            return (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "0.5rem 1.1rem", borderRadius: 50, fontSize: "0.85rem",
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
        </div>

        {/* New Idea button — full width on mobile */}
        <div className="w-full sm:w-auto">
          <NewIdeaButton fullWidth />
        </div>
      </div>

      {/* Grid / skeleton / empty */}
      {loading ? (
        <SkeletonGrid />
      ) : filtered.length === 0 && query === "" && filter === "All" ? (
        <EmptyState isDark={isDark} />
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-[#6b8fa0] text-lg">No ideas match your search.</p>
          <p className="text-[#6b8fa0] text-sm mt-1 opacity-70">Try a different keyword or filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-4">
          {filtered.map((idea, i) => (
            <IdeaCard key={idea.id} {...idea} gradientIndex={i} />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="text-center py-8 flex items-center justify-center gap-2">
        <div style={{ width: 20, height: 20, borderRadius: 6, background: "linear-gradient(135deg,#A8E6CF,#7ecbf0,#C7CEEA)", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", flexShrink: 0 }} />
        <span className="text-xs text-[#6b8fa0] opacity-70 font-medium">Built by The ML Guppy</span>
      </div>
    </div>

    {/* Floating Vault AI widget — fixed bottom-right of the viewport */}
    <VaultAIWidget isDark={isDark} userId={userId} />
    </>
  );
}

// ── Floating Vault AI widget ──────────────────────────────────────────────────

function VaultAIWidget({ isDark, userId }: { isDark: boolean; userId: string }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 200,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 10,
        // Prevent the widget from capturing pointer events when collapsed
        pointerEvents: "auto",
      }}
    >
      {/* Chat panel — shown when open */}
      {open && (
        <div
          style={{
            width: 360,
            height: 480,
            borderRadius: 24,
            overflow: "hidden",
            border: isDark
              ? "1px solid rgba(180,160,240,0.25)"
              : "1px solid rgba(170,200,215,0.5)",
            boxShadow: isDark
              ? "0 24px 56px rgba(0,0,0,0.55)"
              : "0 24px 56px rgba(80,120,140,0.22)",
            display: "flex",
            flexDirection: "column",
            // Smooth slide-in via opacity — no layout shift
            animation: "fadeUp 0.2s ease",
          }}
          className="[background:rgba(255,255,255,0.96)] [backdrop-filter:blur(20px)] dark:[background:rgba(14,20,36,0.96)]"
        >
          <ChatWindow userId={userId} compact onClose={() => setOpen(false)} />
        </div>
      )}

      {/* Trigger pill button */}
      <button
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={open ? "Close Vault AI" : "Open Vault AI"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.45rem",
          padding: "0.65rem 1.3rem",
          borderRadius: 50,
          border: "none",
          cursor: "pointer",
          fontSize: "0.9rem",
          fontWeight: 700,
          color: "#fff",
          boxShadow: hovered
            ? "0 16px 36px rgba(0,0,0,0.35)"
            : "0 8px 24px rgba(0,0,0,0.22)",
          transform: hovered ? "translateY(-3px)" : "translateY(0)",
          transition: "all 0.25s ease",
        }}
        className="[background:linear-gradient(135deg,#3d7a8c,#1e4d5c)] dark:[background:linear-gradient(135deg,#9b7cf0,#5db8fe)] dark:[color:#0a0f1a]"
      >
        {open ? <X size={16} /> : <Sparkles size={16} />}
        {open ? "Close" : "Vault AI"}
      </button>
    </div>
  );
}

