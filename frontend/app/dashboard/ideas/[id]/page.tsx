"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { ArrowLeft, Edit2, Trash2, Save, Loader2, Calendar, Flag, Clock, CloudUpload } from "lucide-react";
import type { Task } from "@/types/task";
import TaskList from "@/components/tasks/TaskList";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import type { Collection } from "@/types/collection";

// ── Types & schema ────────────────────────────────────────────────────────────

interface Idea { id: string; title: string; summary: string; description?: string; tags: string[]; status: string; priority: string; createdAt: string; updatedAt: string; imageUrl?: string; collectionId?: string | null; tasks: Task[]; }

const SUMMARY_MAX_WORDS = 190;
function countWords(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}
function handleSummaryKeyDown(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  currentText: string
) {
  const allowed = ["Backspace","Delete","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","Tab"];
  if (allowed.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (countWords(currentText) >= SUMMARY_MAX_WORDS) e.preventDefault();
}

const schema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  summary: z
    .string()
    .min(1, "Summary is required")
    .refine((v) => countWords(v) <= SUMMARY_MAX_WORDS, {
      message: `Summary must be ${SUMMARY_MAX_WORDS} words or fewer`,
    }),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(["Raw","Exploring","Validated","Building","Shipped","Abandoned"]),
  priority: z.enum(["Low","Medium","High"]),
  collectionId: z.string().optional(),
});
type FormData = z.infer<typeof schema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  Raw: { bg: "#FFD3B6", color: "#5a3e2b" }, Exploring: { bg: "#A8E6CF", color: "#1b4d3e" },
  Validated: { bg: "#8FD3F4", color: "#1a4560" }, Building: { bg: "#C7CEEA", color: "#2d3a6e" },
  Shipped: { bg: "#B5EAD7", color: "#1e4a3a" }, Abandoned: { bg: "#FFB7C5", color: "#6e2d3a" },
};

const inputBase: React.CSSProperties = { width: "100%", padding: "0.8rem 1.1rem", borderRadius: 16, border: "2px solid rgba(125,211,252,0.5)", background: "rgba(255,255,255,0.6)", backdropFilter: "blur(8px)", fontSize: "0.9rem", outline: "none", boxSizing: "border-box", fontFamily: "inherit", color: "#0f2f47" };

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IdeaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [idea, setIdea]       = useState<Idea | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null); // new file picked in edit mode
  const [apiErr, setApiErr]   = useState("");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [updatingCollection, setUpdatingCollection] = useState(false);
  const [deletingImage, setDeletingImage] = useState(false);

  const { register, handleSubmit, control, setValue, watch, reset, formState: { errors } } =
    useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { status: "Raw", priority: "Medium", tags: [], collectionId: "none" } });

  useEffect(() => {
    fetch("/api/collections", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: Collection[]) => setCollections(data))
      .catch(() => setCollections([]));
  }, []);

  useEffect(() => {
    fetch(`/api/ideas/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: { _id: string; title: string; summary: string; description?: string; tags: string[]; status: string; priority: string; createdAt: string; updatedAt: string; image?: string; imageUrl?: string; collectionId?: string | null; tasks?: Task[] }) => {
        const idea: Idea = { ...d, id: d._id, status: cap(d.status), priority: cap(d.priority), tasks: d.tasks ?? [], collectionId: d.collectionId ?? null };
        setIdea(idea);
        reset({ title: idea.title, summary: idea.summary, description: idea.description ?? "", tags: idea.tags, status: idea.status as FormData["status"], priority: idea.priority as FormData["priority"], collectionId: idea.collectionId ?? "none" });
        if (idea.imageUrl) setPreview(idea.imageUrl); // show existing Cloudinary image
      })
      .catch(code => { if (code === 404) setNotFound(true); })
      .finally(() => setLoading(false));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSave(data: FormData) {
    // Flush any tag still typed but not yet committed
    const pendingTag = tagInput.trim().replace(/,$/, "");
    const finalTags = pendingTag
      ? [...(data.tags ?? []), pendingTag]
      : (data.tags ?? []);
    setSaving(true); setApiErr("");
    try {
      // Upload new image first if the user picked one in edit mode.
      // Only fires when a new file was selected; existing imageUrl is kept otherwise.
      let imageUrl: string | undefined = idea?.imageUrl;
      if (imageFile) {
        const formData = new FormData();
        formData.append("file", imageFile);
        const uploadRes = await fetch("/api/ideas/image", { method: "POST", body: formData });
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({})) as { detail?: string };
          throw new Error(err.detail ?? "Image upload failed.");
        }
        const uploadData = await uploadRes.json() as { url: string };
        imageUrl = uploadData.url;
      }

      const res = await fetch(`/api/ideas/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, status: data.status.toLowerCase(), priority: data.priority.toLowerCase(), tags: finalTags, ...(imageUrl ? { imageUrl } : {}), collectionId: data.collectionId && data.collectionId !== "none" ? data.collectionId : null }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      const updated: Idea = { ...d, id: d._id, status: cap(d.status), priority: cap(d.priority) };
      setIdea(updated);
      setImageFile(null);
      setEditing(false);
    } catch (err: unknown) {
      setApiErr(err instanceof Error ? err.message : "Failed to save. Please try again.");
    } finally { setSaving(false); }
  }

  async function onDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/ideas/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error();
      router.push("/dashboard");
    } catch { setApiErr("Failed to delete. Please try again."); setDeleting(false); }
  }

  async function onCollectionChange(value: string) {
    if (!idea) return;
    setUpdatingCollection(true);
    setApiErr("");
    try {
      const res = await fetch(`/api/ideas/${idea.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId: value === "none" ? null : value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to update collection" })) as { detail?: string };
        throw new Error(err.detail ?? "Failed to update collection");
      }
      const updated = await res.json() as { _id: string; collectionId?: string | null };
      setIdea((prev) => (prev ? { ...prev, collectionId: updated.collectionId ?? null } : prev));
    } catch (err: unknown) {
      setApiErr(err instanceof Error ? err.message : "Failed to update collection");
    } finally {
      setUpdatingCollection(false);
    }
  }

  async function onDeleteImage() {
    if (!idea?.imageUrl) return;
    setDeletingImage(true);
    setApiErr("");
    try {
      const res = await fetch(`/api/ideas/${idea.id}/image`, {
        method: "DELETE",
      });
      if (res.status !== 204) {
        const err = await res.json().catch(() => ({ detail: "Failed to delete image" })) as { detail?: string };
        throw new Error(err.detail ?? "Failed to delete image");
      }
      setIdea((prev) => (prev ? { ...prev, imageUrl: undefined } : prev));
      setPreview(null);
    } catch (err: unknown) {
      setApiErr(err instanceof Error ? err.message : "Failed to delete image");
    } finally {
      setDeletingImage(false);
    }
  }

  const tags = watch("tags") ?? [];

  // ── Loading skeleton ──
  if (loading) return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem" }}>
      <div style={{ height: 400, borderRadius: 28, position: "relative", overflow: "hidden" }} className="[background:rgba(255,255,255,0.5)] dark:[background:rgba(20,28,45,0.5)]">
        <div className="shimmer" style={{ position: "absolute", inset: 0 }} />
      </div>
    </div>
  );

  // ── Not found ──
  if (notFound || !idea) return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem", textAlign: "center" }}>
      <h2 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#3d6678" }}>Idea not found</h2>
      <p style={{ color: "#6b8fa0", marginBottom: "1.5rem" }}>This idea may have been deleted or the link is broken.</p>
      <Link href="/dashboard"><button style={{ padding: "0.75rem 1.8rem", borderRadius: 50, border: "none", fontWeight: 700, cursor: "pointer", background: "linear-gradient(135deg,#3d7a8c,#1e4d5c)", color: "#fff" }}>Back to Dashboard</button></Link>
    </div>
  );

  const sc = STATUS_COLORS[idea.status] ?? { bg: "#e0e0e0", color: "#333" };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "1rem 2rem" }}>
      {/* Back */}
      <Link href="/dashboard" style={{ textDecoration: "none" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem", fontWeight: 600, color: "#ffffff", padding: "0.65rem 1.2rem", borderRadius: 50, background: "linear-gradient(135deg,#0ea5e9,#0284c7)", boxShadow: "0 8px 20px rgba(14,165,233,0.2)", cursor: "pointer", transition: "all 0.2s ease" }}
          onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 12px 28px rgba(14,165,233,0.3)")}
          onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "0 8px 20px rgba(14,165,233,0.2)")}
        >
          <ArrowLeft size={15} /> Back to Vault
        </span>
      </Link>

      {/* Card */}
      <div style={{ marginTop: "1.5rem", borderRadius: 28, padding: "2.2rem", background: "rgba(255,255,255,0.75)", backdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.7)", position: "relative", overflow: "hidden", boxShadow: "0 12px 32px rgba(80,120,140,0.12)" }}
        className="dark:[background:rgba(19,35,56,0.92)!important] dark:[border-color:rgba(56,189,248,0.3)!important] dark:[box-shadow:0_12px_32px_rgba(56,189,248,0.16)!important] max-[500px]:!p-6">
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: "linear-gradient(135deg,#0ea5e9,#0284c7)" }} />

        {!editing ? (
          /* ── Display mode ── */
          <>
            <span style={{ display: "inline-block", padding: "0.25rem 0.8rem", borderRadius: 50, fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", background: sc.bg, color: sc.color, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>{idea.status}</span>
            <h1 style={{ fontSize: "1.6rem", fontWeight: 700, margin: "0.5rem 0", color: "#17384f" }}>{idea.title}</h1>

            {/* Meta */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", fontSize: "0.85rem", color: "#3d6678", margin: "1rem 0" }} className="dark:text-[#a8c8e0]">
              <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}><Calendar size={14} /> Created {fmt(idea.createdAt)}</span>
              <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}><Flag size={14} /> Priority: {idea.priority}</span>
              <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}><Clock size={14} /> Updated {fmt(idea.updatedAt)}</span>
            </div>

            <div style={{ marginBottom: "0.9rem", maxWidth: 340 }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#4f7891", display: "block", marginBottom: "0.4rem" }}>Collection</label>
              <Select value={idea.collectionId ?? "none"} onValueChange={(v) => void onCollectionChange(v)}>
                <SelectTrigger style={{ ...inputBase, height: 40 }} disabled={updatingCollection}>
                  <SelectValue placeholder="No collection" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No collection</SelectItem>
                  {collections.map((collection) => (
                    <SelectItem key={collection._id} value={collection._id}>
                      {collection.emoji} {collection.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tags */}
            {idea.tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.5rem" }}>
                {idea.tags.map((t, i) => <span key={i} style={{ padding: "0.35rem 0.9rem", borderRadius: 50, fontSize: "0.8rem", fontWeight: 500, background: "rgba(96,160,196,0.24)", border: "1px solid rgba(82,148,186,0.55)", boxShadow: "0 2px 8px rgba(14,165,233,0.08)", color: "#1c415c" }}>{t}</span>)}
              </div>
            )}

            {/* Image */}
            {idea.imageUrl && (
              <div style={{ position: "relative", display: "inline-block", width: "100%", margin: "1rem 0" }}>
                <img 
                  src={idea.imageUrl} 
                  alt="idea" 
                  style={{ width: "100%", maxHeight: 350, objectFit: "cover", borderRadius: 18, border: "2px solid rgba(125,211,252,0.5)", boxShadow: "0 8px 24px rgba(0,0,0,0.15)", display: "block" }} 
                  className="dark:[border-color:rgba(56,189,248,0.4)]" 
                />
                <button
                  onClick={() => void onDeleteImage()}
                  disabled={deletingImage}
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    border: "none",
                    background: "rgba(239, 68, 68, 0.9)",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: deletingImage ? "not-allowed" : "pointer",
                    opacity: deletingImage ? 0.6 : 1,
                    transition: "all 0.2s ease",
                    boxShadow: "0 4px 12px rgba(239, 68, 68, 0.4)",
                  }}
                  onMouseEnter={(e) => {
                    if (!deletingImage) {
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(239, 68, 68, 1)";
                      (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.1)";
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 16px rgba(239, 68, 68, 0.5)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(239, 68, 68, 0.9)";
                    (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 12px rgba(239, 68, 68, 0.4)";
                  }}
                  title="Delete image"
                  aria-label="Delete image"
                >
                  {deletingImage ? <span style={{ fontSize: "12px" }}>…</span> : <span style={{ fontSize: "18px" }}>✕</span>}
                </button>
              </div>
            )}

            {/* Summary */}
            {idea.summary && (
              <div style={{ margin: "1rem 0 0", padding: "0.9rem 1.1rem", borderRadius: 14, background: "rgba(126,176,209,0.24)", border: "1px solid rgba(102,159,196,0.52)", boxShadow: "inset 0 0 0 1px rgba(102,159,196,0.12)" }}>
                <p style={{ margin: 0, fontSize: "0.8rem", fontWeight: 600, color: "#3d6678", marginBottom: "0.3rem", textTransform: "uppercase", letterSpacing: "0.5px" }} className="dark:text-[#96b5cb]">Summary</p>
                <p style={{ margin: 0, lineHeight: 1.6, fontSize: "0.95rem", color: "#1a3a44" }}>{idea.summary}</p>
              </div>
            )}

            {/* Description */}
            {idea.description && <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: "0.95rem", marginTop: "1rem", color: "#1a3a44" }}>{idea.description}</p>}

            {/* Tasks */}
            <div style={{ borderTop: "2px solid rgba(116,164,194,0.58)", marginTop: "1.8rem", paddingTop: "1.5rem" }}>
              <TaskList ideaId={idea.id} initialTasks={idea.tasks} />
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: "0.8rem", marginTop: "2rem", flexWrap: "wrap" }}>
              <button onClick={() => {
                reset({ title: idea.title, summary: idea.summary, description: idea.description ?? "", tags: idea.tags ?? [], status: idea.status as FormData["status"], priority: idea.priority as FormData["priority"] });
                setTagInput("");
                setEditing(true);
              }} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.75rem 1.6rem", borderRadius: 50, border: "none", fontWeight: 600, cursor: "pointer", color: "#ffffff", background: "linear-gradient(135deg,#0ea5e9,#0284c7)", boxShadow: "0 8px 24px rgba(14,165,233,0.15)", transition: "all 0.2s ease" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 12px 32px rgba(14,165,233,0.3)";
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 24px rgba(14,165,233,0.15)";
                  (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
                }}
              >
                <Edit2 size={15} /> Edit
              </button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.75rem 1.6rem", borderRadius: 50, fontWeight: 600, cursor: "pointer", color: "#ef4444", background: "rgba(239,68,68,0.1)", border: "2px solid #ef4444", transition: "all 0.2s ease" }}
                    className="hover:![background:rgba(239,68,68,0.2)] dark:[color:#ff6b6b] dark:[background:rgba(239,68,68,0.15)]">
                    <Trash2 size={15} /> Delete
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this idea?</AlertDialogTitle>
                    <AlertDialogDescription>This action cannot be undone. This will permanently delete this idea from your vault.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={onDelete} disabled={deleting} style={{ background: "#ef4444", color: "#ffffff" }}>
                      {deleting ? "Deleting…" : "Delete"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
            {apiErr && <p style={{ fontSize: "0.8rem", color: "#FF6B6B", marginTop: "0.5rem" }}>{apiErr}</p>}
          </>
        ) : (
          /* ── Edit mode ── */
          <form onSubmit={handleSubmit(onSave)} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 700, margin: "0.5rem 0 0" }} className="logo-text">✏️ Edit Idea</h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3d6678" }}>Title *</label>
              <input {...register("title")} style={inputBase} className="[color:#0f2f47] dark:[color:#f8f9ff] dark:[background:rgba(26,35,50,0.8)] dark:[border-color:rgba(56,189,248,0.4)] focus:dark:[border-color:#38bdf8]" />
              {errors.title && <span style={{ fontSize: "0.75rem", color: "#ef4444" }}>{errors.title.message}</span>}
            </div>

            {/* Summary — embedded for RAG/semantic search */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3d6678" }}>Summary * (used for AI search)</label>
              {(() => {
                const summaryValue = watch("summary") ?? "";
                const wordCount = countWords(summaryValue);
                const atLimit = wordCount >= SUMMARY_MAX_WORDS;
                return (
                  <>
                    <textarea
                      {...register("summary")}
                      onKeyDown={(e) => handleSummaryKeyDown(e, summaryValue)}
                      rows={3}
                      style={{ ...inputBase, minHeight: 90, resize: "vertical" }}
                      className="[color:#0f2f47] dark:[color:#f8f9ff] dark:[background:rgba(26,35,50,0.8)] dark:[border-color:rgba(56,189,248,0.4)] focus:dark:[border-color:#38bdf8]"
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "0.7rem", color: atLimit ? "#ef4444" : "#6b8fa0" }}>
                        {atLimit ? "Word limit reached — add more detail in the description below." : "Concise summary for AI-powered search"}
                      </span>
                      <span style={{ fontSize: "0.72rem", fontWeight: 600, color: atLimit ? "#ef4444" : wordCount > 170 ? "#f5a623" : "#6b8fa0" }}>
                        {wordCount} / {SUMMARY_MAX_WORDS}
                      </span>
                    </div>
                    {errors.summary && <span style={{ fontSize: "0.75rem", color: "#ef4444" }}>{errors.summary.message}</span>}
                  </>
                );
              })()}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3d6678" }}>Description</label>
              <textarea {...register("description")} rows={5} style={{ ...inputBase, minHeight: 120, resize: "vertical" }} className="[color:#0f2f47] dark:[color:#f8f9ff] dark:[background:rgba(26,35,50,0.8)] dark:[border-color:rgba(56,189,248,0.4)] focus:dark:[border-color:#38bdf8]" />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3d6678" }}>Tags</label>
              <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === "," || e.key === "Enter") { e.preventDefault(); const v = tagInput.trim().replace(/,$/, ""); if (v) { setValue("tags", [...tags, v]); setTagInput(""); } } }}
                placeholder="Press comma to add tag" style={inputBase} className="[color:#0f2f47] dark:[color:#f8f9ff] dark:[background:rgba(26,35,50,0.8)] dark:[border-color:rgba(56,189,248,0.4)] focus:dark:[border-color:#38bdf8]" />
              {tags.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>{tags.map((t, i) => <span key={i} onClick={() => setValue("tags", tags.filter((_, idx) => idx !== i))} style={{ padding: "0.2rem 0.7rem", borderRadius: 50, fontSize: "0.78rem", background: "linear-gradient(135deg,#A8E6CF,#7ecbf0)", color: "#1a3a44", cursor: "pointer" }}>{t} ×</span>)}</div>}
            </div>

            {/* Image */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3d6678" }}>Image</label>
              <div onClick={() => document.getElementById("edit-img-input")?.click()} style={{ border: "2px dashed rgba(170,200,215,0.5)", borderRadius: 16, padding: "1.2rem", textAlign: "center", cursor: "pointer" }} className="hover:[border-color:#8FD3F4]">
                <CloudUpload size={26} color="#6b8fa0" style={{ margin: "0 auto 0.3rem" }} />
                <p style={{ margin: 0, fontSize: "0.82rem", color: "#6b8fa0" }}>Click to change image</p>
              </div>
              <input id="edit-img-input" type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                const f = e.target.files?.[0];
                if (!f) return;
                // Frontend validation — quick UX check before backend validates magic bytes
                const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
                if (!allowed.includes(f.type)) { setApiErr("Only JPEG, PNG, WebP, and GIF images are allowed."); return; }
                if (f.size > 5 * 1024 * 1024) { setApiErr("File too large. Maximum size is 5 MB."); return; }
                setApiErr("");
                setImageFile(f); // store for upload on save
                const r = new FileReader(); r.onload = () => setPreview(r.result as string); r.readAsDataURL(f);
              }} />
              {preview && (
                <div style={{ position: "relative", display: "inline-block", width: "100%" }}>
                  <img 
                    src={preview} 
                    alt="preview" 
                    style={{ maxHeight: 180, width: "100%", objectFit: "cover", borderRadius: 14, boxShadow: "0 4px 16px rgba(0,0,0,0.15)", display: "block" }} 
                  />
                  <button
                    onClick={() => {
                      setPreview(null);
                      setImageFile(null);
                      const input = document.getElementById("edit-img-input") as HTMLInputElement;
                      if (input) input.value = "";
                    }}
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      border: "none",
                      background: "rgba(239, 68, 68, 0.9)",
                      color: "#fff",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                      boxShadow: "0 4px 12px rgba(239, 68, 68, 0.4)",
                      fontSize: "16px",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(239, 68, 68, 1)";
                      (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.1)";
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 6px 16px rgba(239, 68, 68, 0.5)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(239, 68, 68, 0.9)";
                      (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
                      (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 4px 12px rgba(239, 68, 68, 0.4)";
                    }}
                    title="Remove preview"
                    aria-label="Remove preview"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }} className="max-[500px]:!grid-cols-1">
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3d6678" }}>Status</label>
                <Controller name="status" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger style={{ ...inputBase, display: "flex", alignItems: "center", justifyContent: "space-between" }}><SelectValue /></SelectTrigger>
                    <SelectContent>{["Raw","Exploring","Validated","Building","Shipped","Abandoned"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3d6678" }}>Priority</label>
                <Controller name="priority" control={control} render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger style={{ ...inputBase, display: "flex", alignItems: "center", justifyContent: "space-between" }}><SelectValue /></SelectTrigger>
                    <SelectContent>{["Low","Medium","High"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                )} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3d6678" }}>Collection</label>
                <Controller name="collectionId" control={control} render={({ field }) => (
                  <Select value={field.value ?? "none"} onValueChange={field.onChange}>
                    <SelectTrigger style={{ ...inputBase, display: "flex", alignItems: "center", justifyContent: "space-between" }}><SelectValue placeholder="No collection" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No collection</SelectItem>
                      {collections.map((collection) => <SelectItem key={collection._id} value={collection._id}>{collection.emoji} {collection.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )} />
              </div>
            </div>

            {apiErr && <p style={{ fontSize: "0.8rem", color: "#FF6B6B", margin: 0 }}>{apiErr}</p>}

            <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
              <button type="submit" disabled={saving} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.75rem 1.6rem", borderRadius: 50, border: "none", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", color: "#ffffff", background: "linear-gradient(135deg,#0ea5e9,#0284c7)", opacity: saving ? 0.7 : 1, transition: "all 0.2s ease", boxShadow: "0 8px 24px rgba(14,165,233,0.15)" }}
                onMouseEnter={(e) => !saving && (e.currentTarget.style.boxShadow = "0 12px 32px rgba(14,165,233,0.3)")}
                onMouseLeave={(e) => !saving && (e.currentTarget.style.boxShadow = "0 8px 24px rgba(14,165,233,0.15)")}
              >
                {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <><Save size={15} /> Save Changes</>}
              </button>
              <button type="button" onClick={() => { setEditing(false); setApiErr(""); }} style={{ padding: "0.75rem 1.6rem", borderRadius: 50, fontWeight: 600, cursor: "pointer", color: "#6b8fa0", background: "rgba(255,255,255,0.75)", border: "1px solid rgba(170,200,215,0.5)" }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      <div style={{ textAlign: "center", padding: "1.8rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
        <div style={{ width: 20, height: 20, borderRadius: 6, background: "linear-gradient(135deg,#7dd3fc,#38bdf8,#0284c7)", boxShadow: "0 2px 8px rgba(14,165,233,0.2)", flexShrink: 0 }} />
        <span style={{ fontSize: "0.78rem", color: "#6b8fa0", opacity: 0.7, fontWeight: 500 }}>Built by The ML Guppy</span>
      </div>
    </div>
  );
}
