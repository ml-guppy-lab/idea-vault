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
  todo:        { background: "rgba(170,200,215,0.2)", color: "#6b8fa0" },
  in_progress: { background: "rgba(255,230,109,0.2)", color: "#8a6f00" },
  done:        { background: "rgba(168,230,207,0.2)", color: "#1b4d3e" },
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
          border: `2px solid ${isDone ? "#A8E6CF" : "rgba(107,143,160,0.5)"}`,
          background: isDone ? "#A8E6CF" : "transparent",
          cursor: busy ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.15s ease",
        }}
      >
        {isDone && (
          <span style={{ fontSize: "0.62rem", color: "#1b4d3e", fontWeight: 800, lineHeight: 1 }}>
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
          }}
          className={isDone ? "text-slate-400" : "text-[#1a3a44] dark:text-[#e8eef8]"}
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
              color: "#6b8fa0",
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
              color: "#6b8fa0",
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

      {/* Delete — appears on row hover via Tailwind group */}
      <button
        onClick={handleDelete}
        disabled={busy}
        aria-label="Delete task"
        className="opacity-0 group-hover:opacity-100 transition-opacity"
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
