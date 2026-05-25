// Task types — mirror backend/app/schemas/task.py
// Fields are camelCase to match what FastAPI serialises to JSON.

export type TaskStatus = "todo" | "in_progress" | "done";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  /** ISO 8601 string from the backend. Convert to Date only at display time. */
  dueDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskPayload {
  title: string;
  /** ISO 8601 string, or null to clear. */
  dueDate?: string | null;
  notes?: string | null;
}

export interface UpdateTaskPayload {
  title?: string;
  status?: TaskStatus;
  dueDate?: string | null;
  notes?: string | null;
}
