"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, CloudUpload } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { Collection } from "@/types/collection";

// ── Schema ────────────────────────────────────────────────────────────────────

const SUMMARY_MAX_WORDS = 190;

/** Count words the same way the backend will see them. */
function countWords(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

/** Prevent the textarea from accepting input once the word limit is reached.
 *  Allows navigation keys, selection, backspace/delete so the user can edit. */
function handleSummaryKeyDown(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  currentText: string
) {
  const allowed = [
    "Backspace", "Delete", "ArrowLeft", "ArrowRight",
    "ArrowUp", "ArrowDown", "Home", "End", "Tab",
  ];
  if (allowed.includes(e.key) || e.ctrlKey || e.metaKey) return;
  if (countWords(currentText) >= SUMMARY_MAX_WORDS) {
    e.preventDefault();
  }
}

const ideaSchema = z.object({
  title:   z.string().min(1, "Title is required").max(200),
  summary: z
    .string()
    .min(1, "Summary is required")
    .refine((v) => countWords(v) <= SUMMARY_MAX_WORDS, {
      message: `Summary must be ${SUMMARY_MAX_WORDS} words or fewer`,
    }),
  description: z.string().optional(),
  tags:        z.array(z.string()).optional(),
  status:      z.enum(["Raw","Exploring","Validated","Building","Shipped","Abandoned"]),
  priority:    z.enum(["Low","Medium","High"]),
  collectionId: z.string().optional(),
});
type IdeaForm = z.infer<typeof ideaSchema>;

// ── Shared input style ────────────────────────────────────────────────────────

const inputBase: React.CSSProperties = {
  width: "100%", padding: "0.8rem 1.1rem", borderRadius: 16,
  border: "2px solid rgba(125,211,252,0.5)", background: "rgba(255,255,255,0.6)",
  backdropFilter: "blur(8px)", fontSize: "0.9rem", outline: "none",
  boxSizing: "border-box", fontFamily: "inherit", color: "#0f2f47",
};

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3d6678" }} className="dark:text-[#96b5cb]">{label}</label>
      {children}
      {error && <span style={{ fontSize: "0.75rem", color: "#ef4444" }}>{error}</span>}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewIdeaPage() {
  const router = useRouter();
  const [saving, setSaving]     = useState(false);
  const [apiErr, setApiErr]     = useState("");
  const [tagInput, setTagInput] = useState("");
  const [preview, setPreview]   = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null); // actual File for upload
  const [collections, setCollections] = useState<Collection[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, control, setValue, watch, formState: { errors } } =
    useForm<IdeaForm>({
      resolver: zodResolver(ideaSchema),
      defaultValues: { status: "Raw", priority: "Medium", tags: [], collectionId: "none" },
    });

  useEffect(() => {
    fetch("/api/collections", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: Collection[]) => setCollections(data))
      .catch(() => setCollections([]));
  }, []);

  // Convert comma-separated tag input → array on blur/comma
  function handleTagKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "," || e.key === "Enter") {
      e.preventDefault();
      const val = tagInput.trim().replace(/,$/, "");
      if (val) {
        const prev = watch("tags") ?? [];
        setValue("tags", [...prev, val]);
        setTagInput("");
      }
    }
  }

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Frontend validation — quick UX check before backend validates magic bytes
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) { setApiErr("Only JPEG, PNG, WebP, and GIF images are allowed."); return; }
    if (file.size > 5 * 1024 * 1024) { setApiErr("File too large. Maximum size is 5 MB."); return; }
    setApiErr("");
    setImageFile(file);
    // Show a local preview immediately — no upload yet
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function onSubmit(data: IdeaForm) {
    // Flush any tag still typed but not yet committed
    const pendingTag = tagInput.trim().replace(/,$/, "");
    const finalTags = pendingTag
      ? [...(data.tags ?? []), pendingTag]
      : (data.tags ?? []);
    setSaving(true); setApiErr("");
    try {
      // Upload image first if one was selected.
      // The backend validates magic bytes — base64 is never sent to the server.
      let imageUrl: string | undefined;
      if (imageFile) {
        const formData = new FormData();
        formData.append("file", imageFile);
        const uploadRes = await fetch("/api/ideas/image", { method: "POST", body: formData });
        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({})) as { detail?: string };
          throw new Error(err.detail ?? "Image upload failed.");
        }
        const uploadData = await uploadRes.json() as { url: string };
        imageUrl = uploadData.url; // Cloudinary HTTPS URL
      }

      const res = await fetch("/api/ideas/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data,
          status:   data.status.toLowerCase(),
          priority: data.priority.toLowerCase(),
          tags:     finalTags,
          ...(imageUrl ? { imageUrl } : {}), // only set if an image was uploaded
          collectionId: data.collectionId && data.collectionId !== "none" ? data.collectionId : null,
        }),
      });
      if (!res.ok) throw new Error("Failed");
      router.push("/dashboard");
    } catch (err: unknown) {
      setApiErr(err instanceof Error ? err.message : "Failed to save idea. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const tags = watch("tags") ?? [];

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "2rem" }}>

      {/* Back link */}
      <Link href="/dashboard" style={{ textDecoration: "none" }}>
        <span style={{
          display: "inline-flex", alignItems: "center", gap: "0.4rem",
          fontSize: "0.9rem", fontWeight: 600, color: "#ffffff",
          padding: "0.65rem 1.2rem", borderRadius: 50,
          background: "linear-gradient(135deg,#0ea5e9,#0284c7)",
          boxShadow: "0 8px 20px rgba(14,165,233,0.2)", cursor: "pointer",
          transition: "all 0.2s ease",
        }}
          onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 12px 28px rgba(14,165,233,0.3)")}
          onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "0 8px 20px rgba(14,165,233,0.2)")}
        >
          <ArrowLeft size={15} /> Back to Vault
        </span>
      </Link>

      {/* Form card */}
      <div style={{
        marginTop: "1.5rem", borderRadius: 28, padding: "2.2rem",
        background: "rgba(255,255,255,0.75)", backdropFilter: "blur(18px)",
        border: "1px solid rgba(255,255,255,0.7)", position: "relative", overflow: "hidden",
        boxShadow: "0 12px 32px rgba(14,165,233,0.12)",
      }} className="dark:[background:var(--card)] dark:[border-color:hsl(222_47%_15%)] max-[500px]:!p-6">

        {/* Gradient top strip */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5,
          background: "linear-gradient(135deg,#0ea5e9,#0284c7)" }} />

        {/* Heading */}
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "1.8rem", marginTop: "0.5rem", color: "#0f2f47" }}
          className="dark:text-[#f8f9ff]">
          ✨ New Idea
        </h1>

        <form onSubmit={handleSubmit(onSubmit)} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>

          {/* Title */}
          <Field label="Title *" error={errors.title?.message}>
            <input {...register("title")} placeholder="Give your idea a memorable name..."
              style={inputBase} className="[color:#0f2f47] dark:[color:#f8f9ff] dark:[background:rgba(26,35,50,0.8)] dark:[border-color:rgba(56,189,248,0.4)] focus:dark:[border-color:#38bdf8]" />
          </Field>

          {/* Summary — embedded for RAG/semantic search */}
          <Field label="Summary * (used for AI search)" error={errors.summary?.message}>
            {(() => {
              // Inline IIFE so we can compute word count from watched value
              const summaryValue = watch("summary") ?? "";
              const wordCount = countWords(summaryValue);
              const atLimit = wordCount >= SUMMARY_MAX_WORDS;
              return (
                <>
                  <textarea
                    {...register("summary")}
                    onKeyDown={(e) => handleSummaryKeyDown(e, summaryValue)}
                    placeholder={`Distil your idea into a clear, focused summary — max ${SUMMARY_MAX_WORDS} words. This is what the AI reads to find your idea.`}
                    rows={3}
                    style={{ ...inputBase, minHeight: 90, resize: "vertical" }}
                    className="[color:#0f2f47] dark:[color:#f8f9ff] dark:[background:rgba(26,35,50,0.8)] dark:[border-color:rgba(56,189,248,0.4)] focus:dark:[border-color:#38bdf8]"
                  />
                  {/* Word counter */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "0.7rem", color: atLimit ? "#ef4444" : "#6b8fa0" }}>
                      {atLimit
                        ? "Word limit reached — add more detail in the description below."
                        : "Concise summary for AI-powered search"}
                    </span>
                    <span style={{
                      fontSize: "0.72rem", fontWeight: 600,
                      color: atLimit ? "#ef4444" : wordCount > 170 ? "#f5a623" : "#6b8fa0",
                    }}>
                      {wordCount} / {SUMMARY_MAX_WORDS}
                    </span>
                  </div>
                </>
              );
            })()}
          </Field>

          {/* Description */}
          <Field label="Description / Brain Dump" error={errors.description?.message}>
            <textarea {...register("description")} placeholder="Pour all your thoughts here — no filter needed..."
              rows={5} style={{ ...inputBase, minHeight: 140, resize: "vertical" }}
              className="[color:#0f2f47] dark:[color:#f8f9ff] dark:[background:rgba(26,35,50,0.8)] dark:[border-color:rgba(56,189,248,0.4)] focus:dark:[border-color:#38bdf8]" />
          </Field>

          {/* Tags */}
          <Field label="Tags" error={errors.tags?.message as string | undefined}>
            <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={handleTagKey}
              placeholder="e.g. ai, design, side-project (comma separated)"
              style={inputBase} className="[color:#0f2f47] dark:[color:#f8f9ff] dark:[background:rgba(26,35,50,0.8)] dark:[border-color:rgba(56,189,248,0.4)] focus:dark:[border-color:#38bdf8]" />
            {tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.25rem" }}>
                {tags.map((t, i) => (
                  <span key={i} onClick={() => setValue("tags", tags.filter((_, idx) => idx !== i))}
                    style={{ padding: "0.2rem 0.7rem", borderRadius: 50, fontSize: "0.78rem", fontWeight: 500,
                      background: "linear-gradient(135deg,#7dd3fc,#38bdf8,#0284c7)", color: "#ffffff", cursor: "pointer" }}>
                    {t} ×
                  </span>
                ))}
              </div>
            )}
            <span style={{ fontSize: "0.7rem", color: "#6b8fa0" }}>Press comma or Enter to add a tag</span>
          </Field>

          {/* Image upload */}
          <Field label="Image">
            <div onClick={() => fileRef.current?.click()} style={{
              border: "2px dashed rgba(125,211,252,0.5)", borderRadius: 16, padding: "1.8rem",
              textAlign: "center", cursor: "pointer", transition: "all 0.2s ease",
              background: "rgba(255,255,255,0.3)",
            }} className="hover:[border-color:#38bdf8] hover:[background:rgba(143,211,244,0.08)] dark:hover:[background:rgba(56,189,248,0.08)]">
              <CloudUpload size={32} color="#4f7891" style={{ margin: "0 auto 0.5rem" }} />
              <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: 500, color: "#3d6678" }} className="dark:text-[#a8c8e0]">Click to upload an image</p>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#6b8fa0" }} className="dark:text-[#7a95b8]">or drag &amp; drop</p>
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageChange} />
            {preview && (
              <img src={preview} alt="preview" style={{ maxHeight: 180, width: "100%", objectFit: "cover",
                borderRadius: 14, boxShadow: "0 4px 16px rgba(0,0,0,0.15)", marginTop: "0.5rem" }} />
            )}
          </Field>

          {/* Status + Priority */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}
            className="max-[500px]:!grid-cols-1">

            <Field label="Status" error={errors.status?.message}>
              <Controller name="status" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger style={{ ...inputBase, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Raw","Exploring","Validated","Building","Shipped","Abandoned"].map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </Field>

            <Field label="Priority" error={errors.priority?.message}>
              <Controller name="priority" control={control} render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger style={{ ...inputBase, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Low","Medium","High"].map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )} />
            </Field>

            <Field label="Collection" error={errors.collectionId?.message}>
              <Controller name="collectionId" control={control} render={({ field }) => (
                <Select value={field.value ?? "none"} onValueChange={field.onChange}>
                  <SelectTrigger style={{ ...inputBase, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
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
              )} />
            </Field>
          </div>

          {/* API error */}
          {apiErr && <p style={{ fontSize: "0.8rem", color: "#ef4444", margin: 0 }}>{apiErr}</p>}

          {/* Submit */}
          <button type="submit" disabled={saving} style={{
            width: "100%", padding: "0.95rem", borderRadius: 50, border: "none", fontWeight: 700,
            fontSize: "1rem", cursor: saving ? "not-allowed" : "pointer", color: "#ffffff",
            opacity: saving ? 0.7 : 1, marginTop: "0.5rem", display: "flex", alignItems: "center",
            justifyContent: "center", gap: "0.5rem", transition: "all 0.25s ease",
            background: "linear-gradient(135deg,#0ea5e9,#0284c7)",
            boxShadow: "0 8px 24px rgba(14,165,233,0.15)",
          }}
            onMouseEnter={(e) => !saving && ((e.currentTarget as HTMLButtonElement).style.boxShadow = "0 12px 32px rgba(14,165,233,0.3)")}
            onMouseLeave={(e) => !saving && ((e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 24px rgba(14,165,233,0.15)")}
          >
            {saving ? <><Loader2 size={17} className="animate-spin" /> Saving...</> : <><Save size={17} /> Save Idea</>}
          </button>

          {/* Cancel */}
          <div style={{ textAlign: "center", marginTop: "0.4rem" }}>
            <Link href="/dashboard" style={{ textDecoration: "none" }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: "0.4rem",
                fontSize: "0.9rem", fontWeight: 600, color: "#ffffff",
                padding: "0.65rem 1.2rem", borderRadius: 50,
                background: "rgba(255,255,255,0.15)", border: "2px solid rgba(125,211,252,0.4)",
                boxShadow: "0 4px 12px rgba(14,165,233,0.08)", cursor: "pointer",
                transition: "all 0.2s ease",
              }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.15)")}
              >Cancel</span>
            </Link>
          </div>
        </form>
      </div>

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "1.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
        <div style={{ width: 20, height: 20, borderRadius: 6, background: "linear-gradient(135deg,#A8E6CF,#7ecbf0,#C7CEEA)", boxShadow: "0 2px 8px rgba(0,0,0,0.15)", flexShrink: 0 }} />
        <span style={{ fontSize: "0.78rem", color: "#6b8fa0", opacity: 0.7, fontWeight: 500 }}>Built by The ML Guppy</span>
      </div>
    </div>
  );
}
