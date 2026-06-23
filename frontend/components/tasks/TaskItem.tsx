"use client";

import { useState } from "react";
import { Trash2, Calendar } from "lucide-react";
import type { Task, TaskStatus } from "@/types/task";

interface TaskItemProps {
  task: Task;
  onStatusChange: (id: string, status: TaskStatus) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

// Clicking the checkbox: todo / in_progress → done; done → todo
const STATUS_NEXT: Record<TaskStatus, TaskStatus> = {
  todo:        "done",
  in_progress: "done",
  done:        "todo",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo:        "To Do",
  in_progress: "In Progress",
  done:        "Done",
};

const STATUS_BADGE: Record<TaskStatus, { background: string; color: string }> = {
  todo:        { background: "rgba(125,211,252,0.15)", color: "#0ea5e9" },
  in_progress: { background: "rgba(255,230,109,0.2)", color: "#8a6f00" },
  done:        { background: "rgba(34,211,238,0.15)", color: "#0ea5e9" },
};

export default function TaskItem({ task, onStatusChange, onDelete }: TaskItemProps) {
  const [busy, setBusy] = useState(false);
  const isDone = task.status === "done";

  async function handleToggle() {
    if (busy) return;
    setBusy(true);
    await onStatusChange(task.id, STATUS_NEXT[task.status]);
    setBusy(false);
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    await onDelete(task.id);
    // Component will unmount after deletion, so no setBusy(false)
  }

  return (
    <div
      className="group flex items-start gap-3 rounded-xl border transition-colors
                 bg-white/50 border-slate-200/50
                 dark:bg-white/5 dark:border-white/10
                 hover:bg-white/75 dark:hover:bg-white/10"
      style={{ padding: "0.65rem 0.85rem" }}
    >
      {/* Toggle checkbox */}
      <button
        onClick={handleToggle}
        disabled={busy}
        aria-label={isDone ? "Mark as to-do" : "Mark as done"}
        style={{
          flexShrink: 0,
          marginTop: 3,
          width: 18,
          height: 18,
          borderRadius: 5,
          border: `2px solid ${isDone ? "#0ea5e9" : "rgba(56,189,248,0.4)"}`,
          background: isDone ? "#0ea5e9" : "transparent",
          cursor: busy ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.15s ease",
        }}
      >
        {isDone && (
          <span style={{ fontSize: "0.62rem", color: "#ffffff", fontWeight: 800, lineHeight: 1 }}>
            ✓
          </span>
        )}
      </button>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            margin: 0,
            fontSize: "0.88rem",
            fontWeight: 500,
            textDecoration: isDone ? "line-through" : "none",
            wordBreak: "break-word",
            color: isDone ? "#3f5f75" : "#18384f",
          }}
        >
          {task.title}
        </p>

        {task.dueDate && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.2rem",
              fontSize: "0.7rem",
              color: "#466d86",
              marginTop: "0.15rem",
            }}
          >
            <Calendar size={10} />
            {new Date(task.dueDate).toLocaleDateString("en-US", {
              month: "short",
              day:   "numeric",
            })}
          </span>
        )}

        {task.notes && (
          <p
            style={{
              margin: "0.25rem 0 0",
              fontSize: "0.75rem",
              color: "#547990",
              fontStyle: "italic",
            }}
          >
            {task.notes}
          </p>
        )}
      </div>

      {/* Status badge */}
      <span
        style={{
          flexShrink: 0,
          padding: "0.15rem 0.55rem",
          borderRadius: 50,
          fontSize: "0.62rem",
          fontWeight: 700,
          letterSpacing: "0.3px",
          ...STATUS_BADGE[task.status],
        }}
      >
        {STATUS_LABEL[task.status]}
      </span>

      {/* Delete — always visible on mobile, hover-only on md+ screens */}
      <button
        onClick={handleDelete}
        disabled={busy}
        aria-label="Delete task"
        className="opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
        style={{
          flexShrink: 0,
          background: "transparent",
          border: "none",
          cursor: busy ? "not-allowed" : "pointer",
          color: "#ff6b6b",
          padding: "0.1rem",
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
