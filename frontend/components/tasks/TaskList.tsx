"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { Task, TaskStatus, CreateTaskPayload } from "@/types/task";
import TaskItem from "./TaskItem";
import AddTaskForm from "./AddTaskForm";

interface TaskListProps {
  ideaId: string;
  initialTasks: Task[];
}

export default function TaskList({ ideaId, initialTasks }: TaskListProps) {
  const [tasks,    setTasks]    = useState<Task[]>(initialTasks);
  const [showForm, setShowForm] = useState(false);
  const [error,    setError]    = useState("");

  const done = tasks.filter(t => t.status === "done").length;

  async function handleCreate(payload: CreateTaskPayload) {
    setError("");
    const res = await fetch(`/api/ideas/${ideaId}/tasks`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body?.detail ?? "Failed to create task");
      return;
    }
    const newTask: Task = await res.json();
    setTasks(prev => [...prev, newTask]);
    setShowForm(false);
  }

  async function handleStatusChange(taskId: string, status: TaskStatus) {
    // Capture snapshot before optimistic update for rollback
    const snapshot = tasks;
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));

    const res = await fetch(`/api/ideas/${ideaId}/tasks/${taskId}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status }),
    });
    if (!res.ok) {
      setTasks(snapshot);
      setError("Failed to update task");
    }
  }

  async function handleDelete(taskId: string) {
    const snapshot = tasks;
    setTasks(prev => prev.filter(t => t.id !== taskId)); // optimistic remove

    const res = await fetch(`/api/ideas/${ideaId}/tasks/${taskId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setTasks(snapshot);
      setError("Failed to delete task");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3
          style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}
          className="text-[#1a3a44] dark:text-[#e8eef8]"
        >
          Tasks
          {tasks.length > 0 && (
            <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "#6b8fa0", marginLeft: "0.5rem" }}>
              {done}/{tasks.length} done
            </span>
          )}
        </h3>

        {!showForm && (
          <button
            onClick={() => { setShowForm(true); setError(""); }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              padding: "0.35rem 0.9rem",
              borderRadius: 50,
              border: "1px solid rgba(170,200,215,0.4)",
              background: "rgba(255,255,255,0.75)",
              fontWeight: 600,
              fontSize: "0.8rem",
              cursor: "pointer",
              color: "#6b8fa0",
            }}
            className="dark:bg-white/10 dark:border-white/20 dark:text-[#b4c8e0]"
          >
            <Plus size={13} /> Add task
          </button>
        )}
      </div>

      {/* Progress bar — only shown when there are tasks */}
      {tasks.length > 0 && (
        <div
          style={{
            height: 4,
            borderRadius: 4,
            background: "rgba(170,200,215,0.2)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              borderRadius: 4,
              background: "linear-gradient(90deg,#A8E6CF,#7ecbf0)",
              width: `${(done / tasks.length) * 100}%`,
              transition: "width 0.3s ease",
            }}
          />
        </div>
      )}

      {/* Task items */}
      {tasks.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          {tasks.map(task => (
            <TaskItem
              key={task.id}
              task={task}
              onStatusChange={handleStatusChange}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Inline add form */}
      {showForm && (
        <AddTaskForm
          onSubmit={handleCreate}
          onCancel={() => { setShowForm(false); setError(""); }}
        />
      )}

      {/* Empty state */}
      {tasks.length === 0 && !showForm && (
        <p
          style={{
            margin: 0,
            fontSize: "0.85rem",
            color: "#6b8fa0",
            textAlign: "center",
            padding: "0.5rem 0",
          }}
        >
          No tasks yet — add one to start tracking progress.
        </p>
      )}

      {error && (
        <p style={{ margin: 0, fontSize: "0.75rem", color: "#ff6b6b" }}>{error}</p>
      )}
    </div>
  );
}
