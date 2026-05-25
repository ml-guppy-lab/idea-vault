"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { CreateTaskPayload } from "@/types/task";

interface AddTaskFormProps {
  onSubmit: (payload: CreateTaskPayload) => Promise<void>;
  onCancel: () => void;
}

const inputBase: React.CSSProperties = {
  width: "100%",
  padding: "0.55rem 0.85rem",
  borderRadius: 10,
  border: "1.5px solid rgba(170,200,215,0.5)",
  background: "rgba(255,255,255,0.7)",
  fontSize: "0.875rem",
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export default function AddTaskForm({ onSubmit, onCancel }: AddTaskFormProps) {
  const [title,      setTitle]      = useState("");
  const [dueDate,    setDueDate]    = useState("");
  const [notes,      setNotes]      = useState("");
  const [error,      setError]      = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed)             { setError("Title is required"); return; }
    if (trimmed.length > 200) { setError("Title must be 200 characters or fewer"); return; }

    setError("");
    setSubmitting(true);
    try {
      await onSubmit({
        title: trimmed,
        dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        notes:   notes.trim() || null,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.55rem",
        padding: "0.85rem 0.9rem",
        borderRadius: 12,
        background: "rgba(143,211,244,0.07)",
        border: "1.5px solid rgba(143,211,244,0.25)",
      }}
    >
      {/* Title — autoFocus so user can type immediately */}
      <input
        autoFocus
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Task title…"
        maxLength={200}
        style={inputBase}
        className="[color:#1a3a44] dark:[color:#e8eef8] focus:[border-color:#8FD3F4]"
      />

      {/* Optional due date */}
      <input
        type="date"
        value={dueDate}
        onChange={e => setDueDate(e.target.value)}
        style={inputBase}
        className="[color:#3d6678] dark:[color:#b4c8e0] focus:[border-color:#8FD3F4]"
      />

      {/* Optional notes — backend enforces max_length=600 (~100 words) */}
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional)…"
        maxLength={600}
        rows={2}
        style={{ ...inputBase, resize: "vertical", minHeight: 56 }}
        className="[color:#3d6678] dark:[color:#b4c8e0] focus:[border-color:#8FD3F4]"
      />

      {error && (
        <p style={{ margin: 0, fontSize: "0.75rem", color: "#ff6b6b" }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button
          type="submit"
          disabled={submitting}
          style={{
            padding: "0.5rem 1.2rem",
            borderRadius: 50,
            border: "none",
            fontWeight: 700,
            fontSize: "0.82rem",
            cursor: submitting ? "not-allowed" : "pointer",
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.35rem",
            opacity: submitting ? 0.7 : 1,
            transition: "opacity 0.15s",
          }}
          className="[background:linear-gradient(135deg,#3d7a8c,#1e4d5c)] dark:[background:linear-gradient(135deg,#9b7cf0,#5db8fe)] dark:[color:#0a0f1a]"
        >
          {submitting ? (
            <><Loader2 size={13} className="animate-spin" /> Adding…</>
          ) : (
            "Add task"
          )}
        </button>

        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "0.5rem 1.1rem",
            borderRadius: 50,
            fontWeight: 600,
            fontSize: "0.82rem",
            cursor: "pointer",
            color: "#6b8fa0",
            background: "rgba(255,255,255,0.75)",
            border: "1px solid rgba(170,200,215,0.5)",
          }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
