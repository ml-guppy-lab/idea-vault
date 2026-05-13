"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { ArrowLeft, Save, Loader2, CloudUpload } from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// ── Schema ────────────────────────────────────────────────────────────────────

const ideaSchema = z.object({
  title:       z.string().min(1, "Title is required").max(100),
  description: z.string().optional(),
  tags:        z.array(z.string()).optional(),
  status:      z.enum(["Raw","Exploring","Validated","Building","Shipped","Abandoned"]),
  priority:    z.enum(["Low","Medium","High"]),
});
type IdeaForm = z.infer<typeof ideaSchema>;

// ── Shared input style ────────────────────────────────────────────────────────

const inputBase: React.CSSProperties = {
  width: "100%", padding: "0.8rem 1.1rem", borderRadius: 16,
  border: "2px solid rgba(170,200,215,0.5)", background: "rgba(255,255,255,0.6)",
  backdropFilter: "blur(8px)", fontSize: "0.9rem", outline: "none",
  boxSizing: "border-box", fontFamily: "inherit",
};

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
      <label style={{ fontSize: "0.85rem", fontWeight: 600, color: "#3d6678" }}>{label}</label>
      {children}
      {error && <span style={{ fontSize: "0.75rem", color: "#FF6B6B" }}>{error}</span>}
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
  const fileRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, control, setValue, watch, formState: { errors } } =
    useForm<IdeaForm>({
      resolver: zodResolver(ideaSchema),
      defaultValues: { status: "Raw", priority: "Medium", tags: [] },
    });

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
          fontSize: "0.9rem", fontWeight: 500, color: "#6b8fa0",
          padding: "0.5rem 1rem", borderRadius: 50,
          background: "rgba(255,255,255,0.75)", border: "1px solid rgba(170,200,215,0.5)",
          boxShadow: "0 4px 12px rgba(80,120,140,0.08)", cursor: "pointer",
          transition: "all 0.2s ease",
        }}>
          <ArrowLeft size={15} /> Back to Vault
        </span>
      </Link>

      {/* Form card */}
      <div style={{
        marginTop: "1.5rem", borderRadius: 28, padding: "2.2rem",
        background: "rgba(255,255,255,0.75)", backdropFilter: "blur(18px)",
        border: "1px solid rgba(255,255,255,0.7)", position: "relative", overflow: "hidden",
        boxShadow: "0 12px 32px rgba(80,120,140,0.12), 0 0 30px rgba(168,230,207,0.2)",
      }} className="dark:[background:rgba(20,28,45,0.7)!important] dark:[border-color:rgba(180,160,240,0.25)!important] max-[500px]:!p-6">

        {/* Gradient top strip */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5,
          background: "linear-gradient(135deg,#A8E6CF,#7ecbf0,#C7CEEA)" }}
          className="dark:[background:linear-gradient(135deg,#B980F0,#38bdf8,#FF6B6B)!important]" />

        {/* Heading */}
        <h1 style={{ fontSize: "1.4rem", fontWeight: 700, marginBottom: "1.8rem", marginTop: "0.5rem" }}
          className="logo-text">
          ✨ New Idea
        </h1>

        <form onSubmit={handleSubmit(onSubmit)} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>

          {/* Title */}
          <Field label="Title *" error={errors.title?.message}>
            <input {...register("title")} placeholder="Give your idea a memorable name..."
              style={inputBase} className="[color:#1a3a44] dark:[color:#e8eef8] focus:[border-color:#8FD3F4] focus:[box-shadow:0_0_0_4px_rgba(143,211,244,0.2)]" />
          </Field>

          {/* Description */}
          <Field label="Description / Brain Dump" error={errors.description?.message}>
            <textarea {...register("description")} placeholder="Pour all your thoughts here — no filter needed..."
              rows={5} style={{ ...inputBase, minHeight: 140, resize: "vertical" }}
              className="[color:#1a3a44] dark:[color:#e8eef8] focus:[border-color:#8FD3F4] focus:[box-shadow:0_0_0_4px_rgba(143,211,244,0.2)]" />
          </Field>

          {/* Tags */}
          <Field label="Tags" error={errors.tags?.message as string | undefined}>
            <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={handleTagKey}
              placeholder="e.g. ai, design, side-project (comma separated)"
              style={inputBase} className="[color:#1a3a44] dark:[color:#e8eef8] focus:[border-color:#8FD3F4] focus:[box-shadow:0_0_0_4px_rgba(143,211,244,0.2)]" />
            {tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.25rem" }}>
                {tags.map((t, i) => (
                  <span key={i} onClick={() => setValue("tags", tags.filter((_, idx) => idx !== i))}
                    style={{ padding: "0.2rem 0.7rem", borderRadius: 50, fontSize: "0.78rem", fontWeight: 500,
                      background: "linear-gradient(135deg,#A8E6CF,#7ecbf0)", color: "#1a3a44", cursor: "pointer" }}>
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
              border: "2px dashed rgba(170,200,215,0.5)", borderRadius: 16, padding: "1.8rem",
              textAlign: "center", cursor: "pointer", transition: "all 0.2s ease",
            }} className="hover:[border-color:#8FD3F4] hover:[background:rgba(143,211,244,0.08)]">
              <CloudUpload size={32} color="#6b8fa0" style={{ margin: "0 auto 0.5rem" }} />
              <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: 500, color: "#3d6678" }}>Click to upload an image</p>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#6b8fa0" }}>or drag &amp; drop</p>
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
          </div>

          {/* API error */}
          {apiErr && <p style={{ fontSize: "0.8rem", color: "#FF6B6B", margin: 0 }}>{apiErr}</p>}

          {/* Submit */}
          <button type="submit" disabled={saving} style={{
            width: "100%", padding: "0.95rem", borderRadius: 50, border: "none", fontWeight: 700,
            fontSize: "1rem", cursor: saving ? "not-allowed" : "pointer", color: "#fff",
            opacity: saving ? 0.7 : 1, marginTop: "0.5rem", display: "flex", alignItems: "center",
            justifyContent: "center", gap: "0.5rem", transition: "all 0.25s ease",
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
          }}
            className="[background:linear-gradient(135deg,#3d7a8c,#1e4d5c)] dark:[background:linear-gradient(135deg,#9b7cf0,#5db8fe)] dark:[color:#0a0f1a] hover:![transform:translateY(-3px)] hover:![box-shadow:0_14px_32px_rgba(0,0,0,0.25)]">
            {saving ? <><Loader2 size={17} className="animate-spin" /> Saving...</> : <><Save size={17} /> Save Idea</>}
          </button>

          {/* Cancel */}
          <div style={{ textAlign: "center", marginTop: "0.4rem" }}>
            <Link href="/dashboard" style={{ textDecoration: "none" }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: "0.4rem",
                fontSize: "0.9rem", fontWeight: 500, color: "#6b8fa0",
                padding: "0.5rem 1.2rem", borderRadius: 50,
                background: "rgba(255,255,255,0.75)", border: "1px solid rgba(170,200,215,0.5)",
                boxShadow: "0 4px 12px rgba(80,120,140,0.08)", cursor: "pointer",
              }}>Cancel</span>
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
