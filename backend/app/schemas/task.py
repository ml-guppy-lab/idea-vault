"""
Task sub-document schema — embedded inside MongoDB idea documents.

Design decision: tasks are stored as an embedded list inside each idea document,
not in a separate collection. Rationale:
  - Tasks have no meaning without their parent idea.
  - You always fetch tasks together with the idea (no second query needed).
  - This is the correct MongoDB pattern for owned sub-documents.

Security invariant (enforced at the API layer, not here):
  Before reading or writing any task, the calling endpoint MUST verify that the
  parent idea belongs to the requesting user:

      idea = await db.ideas.find_one({"_id": idea_id, "userId": user_id})
      if idea is None:
          raise HTTPException(403)   # 403 — never 404, which would leak existence

  A 404 would tell an attacker that the idea exists but they can't access it.
  A 403 is deliberately ambiguous: the idea may or may not exist.
"""

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    TODO        = "todo"
    IN_PROGRESS = "in_progress"
    DONE        = "done"


# ── Request schema — what the client sends when creating a task ───────────────

class TaskCreate(BaseModel):
    title:    str          = Field(..., min_length=1, max_length=200)
    status:   TaskStatus   = TaskStatus.TODO
    dueDate:  Optional[datetime] = None
    # Free-text context for the agent or user — capped at ~100 words
    notes:    Optional[str] = Field(None, max_length=600)


# ── Request schema — all fields optional (PATCH semantics) ───────────────────

class TaskUpdate(BaseModel):
    title:   Optional[str]        = Field(None, min_length=1, max_length=200)
    status:  Optional[TaskStatus] = None
    dueDate: Optional[datetime]   = None
    notes:   Optional[str]        = Field(None, max_length=600)


# ── Internal schema — the shape stored inside the MongoDB idea document ───────
#
# Field-name convention: camelCase, matching the surrounding idea document
# (createdAt, updatedAt, dueDate) so the embedded array is visually consistent.

class TaskInDB(BaseModel):
    # UUID string — not MongoDB ObjectId; tasks share the document with their idea.
    id:        str          = Field(default_factory=lambda: str(uuid.uuid4()))
    title:     str
    status:    TaskStatus   = TaskStatus.TODO
    dueDate:   Optional[datetime] = None
    notes:     Optional[str] = None
    createdAt: datetime     = Field(default_factory=lambda: datetime.now(timezone.utc))
    updatedAt: datetime     = Field(default_factory=lambda: datetime.now(timezone.utc))


# ── Response schema — what the API returns to the frontend ────────────────────
#
# Same shape as TaskInDB. Defined as a separate class so the API layer can
# evolve the response (e.g. add computed fields) without touching the storage model.

class TaskResponse(BaseModel):
    id:        str
    title:     str
    status:    TaskStatus
    dueDate:   Optional[datetime] = None
    notes:     Optional[str] = None
    createdAt: datetime
    updatedAt: datetime
