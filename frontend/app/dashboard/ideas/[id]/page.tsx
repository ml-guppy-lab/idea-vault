"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { ArrowLeft, Edit2, Trash2, Save, Loader2, Calendar, Flag, Clock, CloudUpload } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

// ── Types & schema ────────────────────────────────────────────────────────────

interface Idea { id: string; title: string; description?: string; tags: string[]; status: string; priority: string; createdAt: string; updatedAt: string; image?: string; }

const schema = z.object({
  title: z.string().min(1, "Title is required").max(100),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(["Raw","Exploring","Validated","Building","Shipped","Abandoned"]),
  priority: z.enum(["Low","Medium","High"]),
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

const inputBase: React.CSSProperties = { width: "100%", padding: "0.8rem 1.1rem", borderRadius: 16, border: "2px solid rgba(170,200,215,0.5)", background: "rgba(255,255,255,0.6)", backdropFilter: "blur(8px)", fontSize: "0.9rem", outline: "none", boxSizing: "border-box", fontFamily: "inherit" };

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
  const [apiErr, setApiErr]   = useState("");

  const { register, handleSubmit, control, setValue, watch, reset, formState: { errors } } =
    useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { status: "Raw", priority: "Medium", tags: [] } });

  useEffect(() => {
    fetch(`/api/ideas/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: { _id: string; title: string; description?: string; tags: string[]; status: string; priority: string; createdAt: string; updatedAt: string; image?: string }) => {
        const idea: Idea = { ...d, id: d._id, status: cap(d.status), priority: cap(d.priority) };
        setIdea(idea);
        reset({ title: idea.title, description: idea.description ?? "", tags: idea.tags, status: idea.status as FormData["status"], priority: idea.priority as FormData["priority"] });
        if (idea.image) setPreview(idea.image);
      })
      .catch(code => { if (code === 404) setNotFound(true); })
      .finally(() => setLoading(false));
  }, [id, reset]);

  async function onSave(data: FormData) {
    setSaving(true); setApiErr("");
    try {
      const res = await fetch(`/api/ideas/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, status: data.status.toLowerCase(), priority: data.priority.toLowerCase(), tags: data.tags ?? [], ...(preview ? { image: preview } : {}) }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      const updated: Idea = { ...d, id: d._id, status: cap(d.status), priority: cap(d.priority) };
      setIdea(updated);
      setEditing(false);
    } catch { setApiErr("Failed to save. Please try again."); }
    finally { setSaving(false); }
  }

  async function onDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/ideas/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error();
      router.push("/dashboard");
    } catch { setApiErr("Failed to delete. Please try again."); setDeleting(false); }
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
        <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem", fontWeight: 500, color: "#6b8fa0", padding: "0.5rem 1rem", borderRadius: 50, background: "rgba(255,255,255,0.75)", border: "1px solid rgba(170,200,215,0.5)", boxShadow: "0 4px 12px rgba(80,120,140,0.08)", cursor: "pointer" }}>
          <ArrowLeft size={15} /> Back to Vault
        </span>
      </Link>

      {/* Card */}
      <div style={{ marginTop: "1.5rem", borderRadius: 28, padding: "2.2rem", background: "rgba(255,255,255,0.75)", backdropFilter: "blur(18px)", border: "1px solid rgba(255,255,255,0.7)", position: "relative", overflow: "hidden", boxShadow: "0 12px 32px rgba(80,120,140,0.12)" }}
        className="dark:[background:rgba(20,28,45,0.7)!important] dark:[border-color:rgba(180,160,240,0.25)!important] max-[500px]:!p-6">
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: "linear-gradient(135deg,#A8E6CF,#7ecbf0,#C7CEEA)" }} className="dark:[background:linear-gradient(135deg,#B980F0,#38bdf8,#FF6B6B)!important]" />

        {!editing ? (
          /* ── Display mode ── */
          <>
            <span style={{ display: "inline-block", padding: "0.25rem 0.8rem", borderRadius: 50, fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", background: sc.bg, color: sc.color, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}>{idea.status}</span>
            <h1 style={{ fontSize: "1.6rem", fontWeight: 700, margin: "0.5rem 0" }} className="[color:#1a3a44] dark:[color:#e8eef8]">{idea.title}</h1>

            {/* Meta */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", fontSize: "0.85rem", color: "#6b8fa0", margin: "1rem 0" }}>
              <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}><Calendar size={14} /> Created {fmt(idea.createdAt)}</span>
              <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}><Flag size={14} /> Priority: {idea.priority}</span>
              <span style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}><Clock size={14} /> Updated {fmt(idea.updatedAt)}</span>
            </div>

            {/* Tags */}
            {idea.tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginBottom: "0.5rem" }}>
                {idea.tags.map((t, i) => <span key={i} style={{ padding: "0.35rem 0.9rem", borderRadius: 50, fontSize: "0.8rem", fontWeight: 500, background: "rgba(255,255,255,0.6)", border: "1px solid rgba(170,200,215,0.5)", boxShadow: "0 4px 12px rgba(80,120,140,0.08)" }} className="[color:#3d6678] dark:[color:#a8c8e0]">{t}</span>)}
              </div>
            )}

            {/* Image */}
            {idea.image && <img src={idea.image} alt="idea" style={{ width: "100%", maxHeight: 350, objectFit: "cover", borderRadius: 18, margin: "1rem 0", boxShadow: "0 8px 24px rgba(0,0,0,0.15)" }} />}

            {/* Description */}
            {idea.description && <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: "0.95rem", marginTop: "1rem" }} className="[color:#3d6678] dark:[color:#b4c8e0]">{idea.description}</p>}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: "0.8rem", marginTop: "2rem", flexWrap: "wrap" }}>
              <button onClick={() => setEditing(true)} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.75rem 1.6rem", borderRadius: 50, border: "none", fontWeight: 600, cursor: "pointer", color: "#fff", boxShadow: "0 8px 24px rgba(0,0,0,0.15)", transition: "all 0.2s ease" }}
                className="[background:linear-gradient(135deg,#3d7a8c,#1e4d5c)] dark:[background:linear-gradient(135deg,#9b7cf0,#5db8fe)] dark:[color:#0a0f1a] hover:![transform:translateY(-2px)]">
                <Edit2 size={15} /> Edit
              </button>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.75rem 1.6rem", borderRadius: 50, fontWeight: 600, cursor: "pointer", color: "#ff6b6b", background: "rgba(255,107,107,0.08)", border: "2px solid #ff6b6b", transition: "all 0.2s ease" }}
                    className="hover:![background:rgba(255,107,107,0.15)]">
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
                    <AlertDialogAction onClick={onDelete} disabled={deleting} style={{ background: "#ff6b6b", color: "#fff" }}>
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
              <input {...register("title")} style={inputBase} className="[color:#1a3a44] dark:[color:#e8eef8] focus:[border-color:#8FD3F4]" />
              {errors.title && <span style={{ fontSize: "0.75rem", color: "#FF6B6B" }}>{errors.title.message}</span>}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3d6678" }}>Description</label>
              <textarea {...register("description")} rows={5} style={{ ...inputBase, minHeight: 120, resize: "vertical" }} className="[color:#1a3a44] dark:[color:#e8eef8] focus:[border-color:#8FD3F4]" />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3d6678" }}>Tags</label>
              <input value={tagInput} onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === "," || e.key === "Enter") { e.preventDefault(); const v = tagInput.trim().replace(/,$/, ""); if (v) { setValue("tags", [...tags, v]); setTagInput(""); } } }}
                placeholder="Press comma to add tag" style={inputBase} className="[color:#1a3a44] dark:[color:#e8eef8] focus:[border-color:#8FD3F4]" />
              {tags.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>{tags.map((t, i) => <span key={i} onClick={() => setValue("tags", tags.filter((_, idx) => idx !== i))} style={{ padding: "0.2rem 0.7rem", borderRadius: 50, fontSize: "0.78rem", background: "linear-gradient(135deg,#A8E6CF,#7ecbf0)", color: "#1a3a44", cursor: "pointer" }}>{t} ×</span>)}</div>}
            </div>

            {/* Image */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3d6678" }}>Image</label>
              <div onClick={() => document.getElementById("edit-img-input")?.click()} style={{ border: "2px dashed rgba(170,200,215,0.5)", borderRadius: 16, padding: "1.2rem", textAlign: "center", cursor: "pointer" }} className="hover:[border-color:#8FD3F4]">
                <CloudUpload size={26} color="#6b8fa0" style={{ margin: "0 auto 0.3rem" }} />
                <p style={{ margin: 0, fontSize: "0.82rem", color: "#6b8fa0" }}>Click to change image</p>
              </div>
              <input id="edit-img-input" type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setPreview(r.result as string); r.readAsDataURL(f); } }} />
              {preview && <img src={preview} alt="preview" style={{ maxHeight: 180, width: "100%", objectFit: "cover", borderRadius: 14, boxShadow: "0 4px 16px rgba(0,0,0,0.15)" }} />}
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
            </div>

            {apiErr && <p style={{ fontSize: "0.8rem", color: "#FF6B6B", margin: 0 }}>{apiErr}</p>}

            <div style={{ display: "flex", gap: "0.8rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
              <button type="submit" disabled={saving} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.75rem 1.6rem", borderRadius: 50, border: "none", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", color: "#fff", opacity: saving ? 0.7 : 1, transition: "all 0.2s ease" }}
                className="[background:linear-gradient(135deg,#3d7a8c,#1e4d5c)] dark:[background:linear-gradient(135deg,#9b7cf0,#5db8fe)] dark:[color:#0a0f1a]">
                {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <><Save size={15} /> Save Changes</>}
              </button>
              <button type="button" onClick={() => { setEditing(false); setApiErr(""); }} style={{ padding: "0.75rem 1.6rem", borderRadius: 50, fontWeight: 600, cursor: "pointer", color: "#6b8fa0", background: "rgba(255,255,255,0.75)", border: "1px solid rgba(170,200,215,0.5)" }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "1.8rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
        <div style={{ width: 20, height: 20, borderRadius: 6, background: "linear-gradient(135deg,#A8E6CF,#7ecbf0,#C7CEEA)", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", flexShrink: 0 }} />
        <span style={{ fontSize: "0.78rem", color: "#6b8fa0", opacity: 0.7, fontWeight: 500 }}>Built by The ML Guppy</span>
      </div>
    </div>
  );
}
