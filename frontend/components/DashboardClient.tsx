"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Search, Plus, Sparkles, X, Folder, FolderOpen, Trash2, ChevronDown, ChevronRight, Menu } from "lucide-react";
import { useTheme } from "next-themes";
import IdeaCard from "@/components/IdeaCard";
import UnifiedChatWindow from "@/components/chat/UnifiedChatWindow";
import type { Task } from "@/types/task";
import type { Collection } from "@/types/collection";

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
  collectionId?: string | null;
  tasks?: Task[];
}

const FILTERS = ["All", "Raw", "Exploring", "Validated", "Building", "Shipped", "Abandoned"] as const;

const COLLECTION_EMOJIS = ["💻", "🧠", "🏃", "📚", "🎯", "🎬", "✍️", "🧪", "🚀", "🎨", "📈", "🎵", "🛠️", "🧩", "🧵", "🧘", "🍳", "📷", "🏠", "💡", "🧭", "🎮", "🧾", "🗂️"];
const COLLECTION_COLORS = ["#0ea5e9", "#2563eb", "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#16a34a", "#ef4444", "#0f766e", "#334155"];

type CollectionFilter = "all" | "none" | string;

function capitalizeStatus(s: string): Status {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as Status;
}

function capitalizePriority(s: string): Priority {
  return (s.charAt(0).toUpperCase() + s.slice(1)) as Priority;
}

function hexToRgba(hex: string, alpha: number) {
  const clean = hex.replace("#", "");
  const normalized = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function NewIdeaButton({ fullWidth = false }: { fullWidth?: boolean }) {
  const [hov, setHov] = useState(false);
  return (
    <Link href="/dashboard/ideas/new" style={{ textDecoration: "none", display: fullWidth ? "block" : "inline-block" }}>
      <button
        onMouseEnter={() => setHov(true)}
        onMouseLeave={() => setHov(false)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "0.4rem",
          padding: "0.75rem 1.8rem",
          borderRadius: 50,
          border: "none",
          fontWeight: 700,
          fontSize: "0.95rem",
          color: "#fff",
          cursor: "pointer",
          width: fullWidth ? "100%" : "auto",
          boxShadow: hov ? "0 14px 32px rgba(0,0,0,0.3)" : "0 8px 24px rgba(0,0,0,0.2)",
          transform: hov ? "translateY(-3px)" : "translateY(0)",
          transition: "all 0.25s ease",
        }}
        className="[background:linear-gradient(135deg,#0ea5e9,#0284c7)] dark:[background:linear-gradient(135deg,#22d3ee,#0284c7)] dark:[color:#ffffff]"
      >
        <Plus size={16} /> New Idea
      </button>
    </Link>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          style={{ height: 220, borderRadius: 22, overflow: "hidden", position: "relative" }}
          className="bg-white/50 dark:bg-[rgba(20,28,45,0.5)]"
        >
          <div className="shimmer" style={{ position: "absolute", inset: 0 }} />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ isDark }: { isDark: boolean }) {
  const grad = isDark ? "linear-gradient(135deg,#67e8f9,#38bdf8)" : "linear-gradient(135deg,#0ea5e9,#0284c7)";
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.75)",
        backdropFilter: "blur(16px)",
        borderRadius: 32,
        border: "2px dashed rgba(170,200,215,0.5)",
        padding: "4rem 2rem",
        textAlign: "center",
        boxShadow: "0 12px 32px rgba(80,120,140,0.12)",
      }}
      className="dark:bg-[rgba(20,28,45,0.7)]"
    >
      <img
        src="/logo1.jpeg"
        alt="Idea Vault"
        style={{
          width: 120,
          height: "auto",
          margin: "0 auto 1.5rem",
          borderRadius: 16,
          display: "block",
          boxShadow: "0 4px 14px rgba(0,0,0,0.1)",
        }}
      />
      <p
        style={{
          fontSize: "1.7rem",
          fontWeight: 700,
          background: grad,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          margin: "0 0 0.5rem",
        }}
      >
        Your vault is empty
      </p>
      <p style={{ color: "#6b8fa0", marginBottom: "2rem", fontSize: "0.95rem" }}>
        Drop your first brilliant idea and watch it grow!
      </p>
      <NewIdeaButton />
    </div>
  );
}

function BrowsePanel({
  collections,
  collectionsLoading,
  allIdeasCount,
  uncategorisedCount,
  activeCollection,
  onSelectCollection,
  filter,
  onSelectStatus,
  onNewCollection,
  onDeleteCollection,
  isDark,
  showStatus = false,
}: {
  collections: Collection[];
  collectionsLoading: boolean;
  allIdeasCount: number;
  uncategorisedCount: number;
  activeCollection: CollectionFilter;
  onSelectCollection: (key: CollectionFilter) => void;
  filter: typeof FILTERS[number];
  onSelectStatus: (f: typeof FILTERS[number]) => void;
  onNewCollection: () => void;
  onDeleteCollection: (id: string) => void;
  isDark: boolean;
  showStatus?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-[#d3e8f3] dark:border-[#24465f] bg-[#f8fdff] dark:bg-[#0f1d31] p-4 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-[#244b66] dark:text-[#cde8fb]">Collections</h2>
          <p className="text-xs text-[#6b8fa0] dark:text-[#88aac2]">Organize your vault</p>
        </div>
        <button
          onClick={onNewCollection}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold bg-[#0ea5e9] hover:bg-[#0284c7] text-white transition"
        >
          <Plus size={14} /> New
        </button>
      </div>

      <div className="space-y-2">
        <button
          onClick={() => onSelectCollection("all")}
          className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 border transition ${
            activeCollection === "all"
              ? "bg-[#e0f2fe] border-[#7dd3fc] text-[#075985] dark:bg-[#0b3552] dark:border-[#0ea5e9] dark:text-[#bfe8ff]"
              : "bg-white border-[#d8e8f1] text-[#2f5d79] hover:bg-[#eef7fc] dark:bg-[#13263f] dark:border-[#24465f] dark:text-[#a8c8dd] dark:hover:bg-[#17314f]"
          }`}
        >
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <FolderOpen size={16} /> All Ideas
          </span>
          <span className="text-xs font-semibold rounded-full px-2 py-1 bg-white/70 dark:bg-white/10">{allIdeasCount}</span>
        </button>

        <button
          onClick={() => onSelectCollection("none")}
          className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 border transition ${
            activeCollection === "none"
              ? "bg-[#e0f2fe] border-[#7dd3fc] text-[#075985] dark:bg-[#0b3552] dark:border-[#0ea5e9] dark:text-[#bfe8ff]"
              : "bg-white border-[#d8e8f1] text-[#2f5d79] hover:bg-[#eef7fc] dark:bg-[#13263f] dark:border-[#24465f] dark:text-[#a8c8dd] dark:hover:bg-[#17314f]"
          }`}
        >
          <span className="inline-flex items-center gap-2 text-sm font-medium">
            <Folder size={16} /> Uncategorised
          </span>
          <span className="text-xs font-semibold rounded-full px-2 py-1 bg-white/70 dark:bg-white/10">{uncategorisedCount}</span>
        </button>

        {collectionsLoading ? (
          <div className="pt-2 text-xs text-[#6b8fa0] dark:text-[#88aac2]">Loading collections...</div>
        ) : (
          collections.map((collection) => {
            const selected = activeCollection === collection._id;
            return (
              <div
                key={collection._id}
                className={`group w-full rounded-xl border px-3 py-2.5 transition ${
                  selected
                    ? "border-transparent"
                    : "border-[#d8e8f1] bg-white text-[#2f5d79] hover:bg-[#eef7fc] dark:border-[#24465f] dark:bg-[#13263f] dark:text-[#a8c8dd] dark:hover:bg-[#17314f]"
                }`}
                style={selected
                  ? {
                      background: hexToRgba(collection.color, isDark ? 0.18 : 0.2),
                      borderColor: hexToRgba(collection.color, isDark ? 0.65 : 0.45),
                      color: isDark ? "#d5ecff" : "#12344d",
                    }
                  : undefined}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => onSelectCollection(collection._id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="inline-flex items-center gap-2 max-w-full">
                      <span className="text-base leading-none">{collection.emoji}</span>
                      <span className="truncate text-sm font-semibold">{collection.name}</span>
                    </div>
                    <div className="text-xs opacity-80 mt-1">{collection.ideaCount} ideas</div>
                  </button>
                  <button
                    onClick={() => onDeleteCollection(collection._id)}
                    className="opacity-70 hover:opacity-100 text-[#ef4444] transition"
                    aria-label={`Delete ${collection.name}`}
                    title={`Delete ${collection.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showStatus && (
        <div className="mt-5 pt-4 border-t border-[#d3e8f3] dark:border-[#24465f]">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#6b8fa0] dark:text-[#88aac2] mb-2.5">Filter by status</p>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => onSelectStatus(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition ${
                  filter === f
                    ? "bg-[#0284c7] text-white border-[#0284c7] dark:bg-[#22d3ee] dark:text-[#07253a] dark:border-[#22d3ee]"
                    : "bg-white text-[#2f5d79] border-[#d3e8f3] hover:bg-[#eef8fd] dark:bg-[#11243c] dark:text-[#a8c8dd] dark:border-[#2c4f68] dark:hover:bg-[#17314f]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardClient({ ideas, userName, userId, loading }: {
  ideas: Idea[];
  userName: string;
  userId: string;
  loading?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<typeof FILTERS[number]>("All");
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeCollection, setActiveCollection] = useState<CollectionFilter>("all");
  const [ideasState, setIdeasState] = useState<Idea[]>(ideas);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);
  const [ideasLoading, setIdeasLoading] = useState(Boolean(loading));
  const [uncategorisedCount, setUncategorisedCount] = useState(0);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [collectionEmoji, setCollectionEmoji] = useState("📁");
  const [collectionColor, setCollectionColor] = useState("#0ea5e9");
  const [collectionSaving, setCollectionSaving] = useState(false);
  const [collectionError, setCollectionError] = useState("");
  const [shippedOpen, setShippedOpen] = useState(false);
  const [abandonedOpen, setAbandonedOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const allIdeasCount = collections.reduce((acc, c) => acc + c.ideaCount, 0) + uncategorisedCount;

  async function fetchIdeasByCollection(collectionKey: CollectionFilter) {
    setIdeasLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (collectionKey === "none") params.set("collectionId", "none");
      else if (collectionKey !== "all") params.set("collectionId", collectionKey);

      const res = await fetch(`/api/ideas/list?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load ideas");

      const data = await res.json() as {
        items: Array<{
          _id: string;
          title: string;
          description?: string;
          tags: string[];
          status: string;
          priority: string;
          createdAt: string;
          collectionId?: string | null;
          tasks?: Task[];
        }>;
      };

      setIdeasState(data.items.map((ideaItem) => ({
        id: ideaItem._id,
        title: ideaItem.title,
        description: ideaItem.description ?? "",
        tags: ideaItem.tags ?? [],
        status: capitalizeStatus(ideaItem.status),
        priority: capitalizePriority(ideaItem.priority),
        createdAt: ideaItem.createdAt,
        collectionId: ideaItem.collectionId ?? null,
        tasks: ideaItem.tasks ?? [],
      })));
    } catch {
      setIdeasState([]);
    } finally {
      setIdeasLoading(false);
    }
  }

  async function fetchCollections() {
    setCollectionsLoading(true);
    try {
      const [collectionsRes, uncategorisedRes] = await Promise.all([
        fetch("/api/collections", { cache: "no-store" }),
        fetch("/api/ideas/list?limit=1&collectionId=none", { cache: "no-store" }),
      ]);

      if (!collectionsRes.ok) throw new Error("Failed to load collections");
      const collectionData = await collectionsRes.json() as Collection[];
      setCollections(collectionData);

      if (uncategorisedRes.ok) {
        const uncategorisedData = await uncategorisedRes.json() as { total?: number };
        setUncategorisedCount(uncategorisedData.total ?? 0);
      } else {
        setUncategorisedCount(0);
      }
    } catch {
      setCollections([]);
      setUncategorisedCount(0);
    } finally {
      setCollectionsLoading(false);
    }
  }

  useEffect(() => {
    void fetchCollections();
  }, []);

  useEffect(() => {
    void fetchIdeasByCollection(activeCollection);
  }, [activeCollection]);

  async function handleCreateCollection() {
    const trimmedName = collectionName.trim();
    if (!trimmedName) {
      setCollectionError("Collection name is required");
      return;
    }

    setCollectionSaving(true);
    setCollectionError("");
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          emoji: collectionEmoji,
          color: collectionColor,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to create collection" })) as { detail?: string };
        throw new Error(err.detail ?? "Failed to create collection");
      }

      setCollectionModalOpen(false);
      setCollectionName("");
      setCollectionEmoji("📁");
      setCollectionColor("#0ea5e9");
      await fetchCollections();
    } catch (error) {
      setCollectionError(error instanceof Error ? error.message : "Failed to create collection");
    } finally {
      setCollectionSaving(false);
    }
  }

  async function handleDeleteCollection(id: string) {
    try {
      const res = await fetch(`/api/collections/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete collection");

      if (activeCollection === id) {
        setActiveCollection("all");
      }
      await fetchCollections();
    } catch {
      // keep silent: UI state remains consistent on next refresh
    }
  }

  const { activeIdeas, shippedIdeas, abandonedIdeas } = useMemo(() => {
    const bySearch = ideasState.filter(
      (i) =>
        i.title.toLowerCase().includes(query.toLowerCase()) ||
        i.description.toLowerCase().includes(query.toLowerCase()) ||
        i.tags.some((t) => t.toLowerCase().includes(query.toLowerCase())),
    );
    const byStatus = filter === "All" ? bySearch : bySearch.filter((i) => i.status === filter);
    return {
      activeIdeas:    byStatus.filter((i) => i.status !== "Shipped" && i.status !== "Abandoned"),
      shippedIdeas:   byStatus.filter((i) => i.status === "Shipped"),
      abandonedIdeas: byStatus.filter((i) => i.status === "Abandoned"),
    };
  }, [ideasState, query, filter]);

  const shippedExpanded = shippedOpen || filter === "Shipped";
  const abandonedExpanded = abandonedOpen || filter === "Abandoned";
  const activeCollectionLabel =
    activeCollection === "all" ? "All Ideas"
      : activeCollection === "none" ? "Uncategorised"
        : collections.find((c) => c._id === activeCollection)?.name ?? "Collection";

  const selectCollection = (key: CollectionFilter) => {
    setActiveCollection(key);
    setDrawerOpen(false);
  };
  const selectStatus = (f: typeof FILTERS[number]) => {
    setFilter(f);
    setDrawerOpen(false);
  };

  const browsePanelProps = {
    collections,
    collectionsLoading,
    allIdeasCount,
    uncategorisedCount,
    activeCollection,
    onSelectCollection: selectCollection,
    filter,
    onSelectStatus: selectStatus,
    onNewCollection: () => { setCollectionModalOpen(true); setDrawerOpen(false); },
    onDeleteCollection: (id: string) => void handleDeleteCollection(id),
    isDark,
  };

  return (
    <div className="min-h-screen px-3 sm:px-5 lg:px-6 2xl:px-8 py-4 md:py-8"
      style={{
        background: isDark
          ? "radial-gradient(1200px 700px at 10% -10%, rgba(34,211,238,0.08), transparent 55%), radial-gradient(1000px 600px at 95% 0%, rgba(59,130,246,0.1), transparent 50%), linear-gradient(180deg,#050915 0%,#0a1222 100%)"
          : "radial-gradient(900px 500px at 8% -12%, rgba(14,165,233,0.12), transparent 50%), radial-gradient(700px 420px at 94% 2%, rgba(125,211,252,0.2), transparent 46%), linear-gradient(180deg,#f8fdff 0%,#f0f8ff 100%)",
      }}
    >
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .shimmer {
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent);
          transform: translateX(-100%);
          animation: shimmer 1.4s infinite;
        }
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
        @keyframes slideInLeft {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
      `}</style>

      <main className="mx-auto w-full max-w-[1920px]">
        <div className="flex flex-col xl:flex-row gap-6 items-start">
          {/* Desktop collections sidebar */}
          <aside className="hidden xl:block xl:w-[25%] xl:min-w-[280px] xl:max-w-[360px] shrink-0 xl:sticky xl:top-24">
            <BrowsePanel {...browsePanelProps} />
          </aside>

          {/* Mobile / tablet drawer */}
          {drawerOpen && (
            <div className="xl:hidden fixed inset-0 z-[80]">
              <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={() => setDrawerOpen(false)}
                aria-hidden
              />
              <div
                className="absolute left-0 top-0 h-full w-[86%] max-w-[340px] overflow-y-auto p-4 shadow-2xl"
                style={{ animation: "slideInLeft 0.25s ease", background: isDark ? "#0a1424" : "#f4fbff" }}
              >
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-base font-bold text-[#244b66] dark:text-[#cde8fb]">Browse</h2>
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="rounded-full p-1.5 text-[#6b8fa0] hover:bg-[#eef7fc] dark:hover:bg-[#17314f]"
                    aria-label="Close menu"
                  >
                    <X size={18} />
                  </button>
                </div>
                <BrowsePanel {...browsePanelProps} showStatus />
              </div>
            </div>
          )}

          <section className="w-full xl:flex-1 rounded-[28px] border border-white/60 dark:border-white/10 bg-white/70 dark:bg-[rgba(10,18,34,0.7)] backdrop-blur-xl shadow-[0_25px_70px_rgba(2,132,199,0.15)] dark:shadow-[0_25px_70px_rgba(0,0,0,0.45)] p-4 sm:p-6 lg:p-8">
            {/* Mobile browse trigger */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="xl:hidden mb-4 w-full flex items-center justify-between rounded-2xl border border-[#d3e8f3] dark:border-[#24465f] bg-white/80 dark:bg-[#11243c]/80 px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2.5 text-sm font-semibold text-[#1f4560] dark:text-[#cfe6fb]">
                <Menu size={18} /> {activeCollectionLabel}
              </span>
              <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-[#e0f2fe] text-[#075985] dark:bg-[#0b3552] dark:text-[#bfe8ff]">
                {filter === "All" ? "Filter" : filter}
              </span>
            </button>

            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#1f4560] dark:text-[#d5ecff]">
                Welcome back, {userName || "Builder"}
              </h1>
              <p className="text-sm sm:text-base text-[#52748a] dark:text-[#9fc4dd] mt-1">
                Curate ideas by collection and move fast from concept to execution.
              </p>
            </div>

            <div className="w-full lg:w-auto flex flex-col sm:flex-row gap-3">
              <div
                className="relative flex-1 sm:w-[320px]"
                style={{
                  borderRadius: 16,
                  background: isDark ? "rgba(15,25,42,0.8)" : "rgba(255,255,255,0.85)",
                  border: searchFocused
                    ? "1px solid rgba(34,211,238,0.75)"
                    : isDark
                      ? "1px solid rgba(159,196,221,0.3)"
                      : "1px solid rgba(82,116,138,0.25)",
                  boxShadow: searchFocused
                    ? "0 0 0 3px rgba(34,211,238,0.15)"
                    : "none",
                  transition: "all 0.2s ease",
                }}
              >
                <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#5f8aa5] dark:text-[#96c2df]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setSearchFocused(false)}
                  placeholder="Search ideas, tags, descriptions..."
                  className="w-full bg-transparent pl-10 pr-3 py-2.5 outline-none text-[15px] text-[#12344d] dark:text-[#e2f3ff] placeholder:text-[#7390a2] dark:placeholder:text-[#8eb2cc]"
                />
              </div>
              <NewIdeaButton />
            </div>
          </div>

            <section className="min-w-0">
              <div className="hidden sm:flex flex-wrap gap-2 mb-4">
                {FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-4 py-2 rounded-full text-sm font-semibold border transition ${
                      filter === f
                        ? "bg-[#0284c7] text-white border-[#0284c7] dark:bg-[#22d3ee] dark:text-[#07253a] dark:border-[#22d3ee]"
                        : "bg-white text-[#2f5d79] border-[#d3e8f3] hover:bg-[#eef8fd] dark:bg-[#11243c] dark:text-[#a8c8dd] dark:border-[#2c4f68] dark:hover:bg-[#17314f]"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>

              {ideasLoading ? (
                <SkeletonGrid />
              ) : activeIdeas.length === 0 && shippedIdeas.length === 0 && abandonedIdeas.length === 0 ? (
                <EmptyState isDark={isDark} />
              ) : (
                <>
                  {/* ── Active ideas ─────────────────────────────────────── */}
                  {activeIdeas.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5">
                      {activeIdeas.map((idea, i) => (
                        <IdeaCard
                          key={idea.id}
                          id={idea.id}
                          title={idea.title}
                          description={idea.description}
                          tags={idea.tags}
                          status={idea.status}
                          priority={idea.priority}
                          createdAt={idea.createdAt}
                          tasks={idea.tasks ?? []}
                          gradientIndex={i}
                        />
                      ))}
                    </div>
                  )}

                  {/* ── Shipped section (collapsible) ────────────────────── */}
                  {shippedIdeas.length > 0 && (
                    <div className="mt-8">
                      <button
                        onClick={() => setShippedOpen((o) => !o)}
                        className="w-full flex items-center gap-3 mb-5 select-none"
                        aria-expanded={shippedOpen}
                      >
                        <div className="flex-1 h-px" style={{ background: isDark ? "rgba(139,92,246,0.2)" : "rgba(139,92,246,0.25)" }} />
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase px-3 py-1.5 rounded-full border transition ${
                          isDark
                            ? "border-[#3b2060] bg-[#130d24] text-[#a78bfa] hover:bg-[#1a1130]"
                            : "border-[#ddd6fe] bg-white/70 text-[#7c3aed] hover:bg-[#f5f3ff]"
                        }`}>
                          {shippedExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          Shipped · {shippedIdeas.length}
                        </span>
                        <div className="flex-1 h-px" style={{ background: isDark ? "rgba(139,92,246,0.2)" : "rgba(139,92,246,0.25)" }} />
                      </button>

                      {shippedExpanded && (
                        <div
                          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5"
                          style={{ opacity: 0.88 }}
                        >
                          {shippedIdeas.map((idea, i) => (
                            <IdeaCard
                              key={idea.id}
                              id={idea.id}
                              title={idea.title}
                              description={idea.description}
                              tags={idea.tags}
                              status={idea.status}
                              priority={idea.priority}
                              createdAt={idea.createdAt}
                              tasks={idea.tasks ?? []}
                              gradientIndex={activeIdeas.length + i}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Abandoned section (collapsible) ──────────────────── */}
                  {abandonedIdeas.length > 0 && (
                    <div className="mt-8">
                      <button
                        onClick={() => setAbandonedOpen((o) => !o)}
                        className="w-full flex items-center gap-3 mb-5 select-none"
                        aria-expanded={abandonedOpen}
                      >
                        <div className="flex-1 h-px" style={{ background: isDark ? "rgba(239,68,68,0.18)" : "rgba(239,68,68,0.22)" }} />
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase px-3 py-1.5 rounded-full border transition ${
                          isDark
                            ? "border-[#5a1c1c] bg-[#1a0a0a] text-[#f87171] hover:bg-[#220d0d]"
                            : "border-[#fecaca] bg-white/70 text-[#dc2626] hover:bg-[#fef2f2]"
                        }`}>
                          {abandonedExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          Abandoned · {abandonedIdeas.length}
                        </span>
                        <div className="flex-1 h-px" style={{ background: isDark ? "rgba(239,68,68,0.18)" : "rgba(239,68,68,0.22)" }} />
                      </button>

                      {abandonedExpanded && (
                        <div
                          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5"
                          style={{ opacity: 0.65 }}
                        >
                          {abandonedIdeas.map((idea, i) => (
                            <IdeaCard
                              key={idea.id}
                              id={idea.id}
                              title={idea.title}
                              description={idea.description}
                              tags={idea.tags}
                              status={idea.status}
                              priority={idea.priority}
                              createdAt={idea.createdAt}
                              tasks={idea.tasks ?? []}
                              gradientIndex={activeIdeas.length + shippedIdeas.length + i}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          </section>
        </div>
      </main>

      <div style={{ textAlign: "center", padding: "1.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
        <div style={{ width: 20, height: 20, borderRadius: 6, background: "linear-gradient(135deg,#7dd3fc,#38bdf8,#0284c7)", boxShadow: "0 2px 8px rgba(14,165,233,0.2)", flexShrink: 0 }} />
        <span style={{ fontSize: "0.78rem", color: "#6b8fa0", opacity: 0.7, fontWeight: 500 }}>Built by The ML Guppy</span>
      </div>

      {collectionModalOpen && (
        <div className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="w-full max-w-md rounded-2xl border border-[#d3e8f3] dark:border-[#24465f] bg-white dark:bg-[#0f1d31] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg font-bold text-[#1f4560] dark:text-[#d5ecff]">Create Collection</h3>
                <p className="text-xs text-[#6b8fa0] dark:text-[#88aac2]">Group related ideas for faster planning.</p>
              </div>
              <button
                onClick={() => setCollectionModalOpen(false)}
                className="rounded-full p-1.5 text-[#6b8fa0] hover:bg-[#eef7fc] dark:hover:bg-[#17314f]"
                aria-label="Close create collection modal"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4">
              <label className="block text-sm font-medium text-[#2f5d79] dark:text-[#a8c8dd]">
                Name
                <input
                  value={collectionName}
                  onChange={(e) => setCollectionName(e.target.value)}
                  maxLength={60}
                  placeholder="e.g. Launch Plans"
                  className="mt-1 w-full rounded-xl border border-[#d3e8f3] dark:border-[#24465f] bg-white dark:bg-[#13263f] px-3 py-2 text-sm text-[#12344d] dark:text-[#d5ecff] placeholder:text-[#7f9bad] dark:placeholder:text-[#88aac2] outline-none focus:ring-2 focus:ring-[#0ea5e9]/40"
                />
              </label>

              <div>
                <label className="block text-sm font-medium text-[#2f5d79] dark:text-[#a8c8dd] mb-1.5">Emoji</label>
                <div className="grid grid-cols-8 gap-2 max-h-[140px] overflow-y-auto pr-1">
                  {COLLECTION_EMOJIS.map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => setCollectionEmoji(emoji)}
                      className={`h-9 rounded-lg border text-base transition ${
                        collectionEmoji === emoji
                          ? "border-[#0ea5e9] bg-[#e0f2fe] dark:bg-[#0b3552]"
                          : "border-[#d3e8f3] bg-white hover:bg-[#f2faff] dark:border-[#24465f] dark:bg-[#13263f] dark:hover:bg-[#17314f]"
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#2f5d79] dark:text-[#a8c8dd] mb-1.5">Color</label>
                <div className="flex flex-wrap gap-2">
                  {COLLECTION_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => setCollectionColor(color)}
                      className={`h-8 w-8 rounded-full border-2 transition ${
                        collectionColor === color ? "border-[#111827] dark:border-white scale-110" : "border-white/80 dark:border-[#1f334a]"
                      }`}
                      style={{ backgroundColor: color }}
                      aria-label={`Select ${color}`}
                      title={color}
                    />
                  ))}
                </div>
              </div>

              {collectionError ? (
                <p className="text-sm text-[#dc2626]">{collectionError}</p>
              ) : null}

              <div className="pt-1 flex justify-end gap-2">
                <button
                  onClick={() => setCollectionModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-semibold border border-[#d3e8f3] dark:border-[#24465f] text-[#2f5d79] dark:text-[#a8c8dd] hover:bg-[#eef7fc] dark:hover:bg-[#17314f]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void handleCreateCollection()}
                  disabled={collectionSaving}
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-[#0284c7] hover:bg-[#0369a1] text-white disabled:opacity-60"
                >
                  {collectionSaving ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <FloatingChatWidget userId={userId} />
    </div>
  );
}

function FloatingChatWidget({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <div style={{ position: "fixed", right: 26, bottom: 24, zIndex: 50 }}>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            bottom: 62,
            width: 360,
            maxWidth: "calc(100vw - 24px)",
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
            animation: "fadeUp 0.2s ease",
          }}
          className="[background:rgba(255,255,255,0.96)] [backdrop-filter:blur(20px)] dark:[background:rgba(14,20,36,0.96)]"
        >
          <UnifiedChatWindow userId={userId} compact onClose={() => setOpen(false)} />
        </div>
      )}

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
        className="[background:linear-gradient(135deg,#0ea5e9,#0284c7)] dark:[background:linear-gradient(135deg,#22d3ee,#0284c7)] dark:[color:#ffffff]"
      >
        {open ? <X size={16} /> : <Sparkles size={16} />}
        {open ? "Close" : "Vault AI"}
      </button>
    </div>
  );
}
