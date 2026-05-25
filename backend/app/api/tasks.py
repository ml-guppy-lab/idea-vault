"""
Tasks API — CRUD for embedded task sub-documents inside MongoDB idea documents.

Tasks live inside the idea document (embedded array, not a separate collection).
Every mutation uses MongoDB array operators:
    $push — append a new task
    $set  — update specific fields of one task (positional operator $)
    $pull — remove a task by id

Security invariant:
    Every endpoint calls _get_idea_for_user() first, which queries
    {"_id": idea_id, "userId": user_id}. If the idea doesn't exist OR belongs
    to someone else, this raises HTTP 403 — never 404, because a 404 would
    tell an attacker that the idea exists but they can't access it.
"""

import logging
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Response, status
from motor.motor_asyncio import AsyncIOMotorDatabase
import redis.asyncio as aioredis

from app.core.security import get_current_user
from app.db.mongodb import get_mongo_db
from app.db.redis import get_redis
from app.models.user import User
from app.schemas.task import TaskCreate, TaskInDB, TaskResponse, TaskUpdate

router = APIRouter(tags=["tasks"])
_log = logging.getLogger("app.tasks")

# Task creation rate limit — separate Redis key namespace from chat RL
_TASK_RL_MAX    = 60    # max tasks created per window
_TASK_RL_WINDOW = 3600  # window size in seconds (1 hour)


# ── Shared helpers ────────────────────────────────────────────────────────────

async def _check_task_rate_limit(user_id: str, redis: aioredis.Redis) -> None:
    """Sliding-window rate limiter: max 60 task creates per user per hour."""
    key = f"task_rl:{user_id}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, _TASK_RL_WINDOW)
    if count > _TASK_RL_MAX:
        raise HTTPException(
            status_code=429,
            detail=f"Task creation limit reached. Max {_TASK_RL_MAX} per hour.",
        )


async def _get_idea_for_user(
    idea_id: str,
    user_id: str,
    db: AsyncIOMotorDatabase,
) -> dict:
    """
    Verify the idea exists and belongs to user_id. Return the full document.

    Raises 422 on a malformed idea_id, 403 if not found or not owned.
    403 is used deliberately — 404 would leak that the idea exists to other users.
    """
    try:
        oid = ObjectId(idea_id)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid idea ID")

    idea = await db.ideas.find_one({"_id": oid, "userId": user_id})
    if idea is None:
        raise HTTPException(status_code=403, detail="Not authorised")
    return idea  # idea["_id"] is the ObjectId — reuse it below to avoid double-convert


# ── POST /ideas/{idea_id}/tasks ───────────────────────────────────────────────

@router.post(
    "/ideas/{idea_id}/tasks",
    status_code=status.HTTP_201_CREATED,
    response_model=TaskResponse,
    summary="Add a task to an idea",
)
async def create_task(
    idea_id: str,
    payload: TaskCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),
    redis: aioredis.Redis = Depends(get_redis),
) -> TaskResponse:
    await _check_task_rate_limit(str(current_user.id), redis)

    idea = await _get_idea_for_user(idea_id, str(current_user.id), db)

    # Build the task document — id and timestamps are set server-side
    task = TaskInDB(**payload.model_dump())
    task_doc = task.model_dump()

    await db.ideas.update_one(
        {"_id": idea["_id"]},
        {"$push": {"tasks": task_doc}},
    )

    _log.debug("Task %s created on idea %s by user %s", task.id, idea_id, current_user.id)
    return TaskResponse(**task_doc)


# ── GET /ideas/{idea_id}/tasks ────────────────────────────────────────────────

@router.get(
    "/ideas/{idea_id}/tasks",
    status_code=status.HTTP_200_OK,
    response_model=list[TaskResponse],
    summary="List all tasks for an idea",
)
async def list_tasks(
    idea_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),
) -> list[TaskResponse]:
    idea = await _get_idea_for_user(idea_id, str(current_user.id), db)
    return [TaskResponse(**t) for t in idea.get("tasks", [])]


# ── PATCH /ideas/{idea_id}/tasks/{task_id} ────────────────────────────────────

@router.patch(
    "/ideas/{idea_id}/tasks/{task_id}",
    status_code=status.HTTP_200_OK,
    response_model=TaskResponse,
    summary="Update a task (title, status, dueDate, notes)",
)
async def update_task(
    idea_id: str,
    task_id: str,
    payload: TaskUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),
) -> TaskResponse:
    idea = await _get_idea_for_user(idea_id, str(current_user.id), db)

    # Locate the task inside the embedded array
    task = next((t for t in idea.get("tasks", []) if t["id"] == task_id), None)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    # Only apply fields the client actually sent (exclude_none = PATCH semantics)
    changes = payload.model_dump(exclude_none=True)
    if not changes:
        return TaskResponse(**task)

    now = datetime.now(timezone.utc)

    # Positional operator $ targets the matched array element.
    # {"tasks.id": task_id} in the filter tells MongoDB which element to target.
    set_ops: dict = {"tasks.$.updatedAt": now}
    for field, value in changes.items():
        set_ops[f"tasks.$.{field}"] = value

    await db.ideas.update_one(
        {"_id": idea["_id"], "tasks.id": task_id},
        {"$set": set_ops},
    )

    # Refetch to return the final persisted state, not a client-reconstructed guess
    updated_idea = await db.ideas.find_one({"_id": idea["_id"]})
    updated_task = next(t for t in updated_idea["tasks"] if t["id"] == task_id)
    return TaskResponse(**updated_task)


# ── DELETE /ideas/{idea_id}/tasks/{task_id} ───────────────────────────────────

@router.delete(
    "/ideas/{idea_id}/tasks/{task_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a task",
)
async def delete_task(
    idea_id: str,
    task_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),
) -> Response:
    idea = await _get_idea_for_user(idea_id, str(current_user.id), db)

    result = await db.ideas.update_one(
        {"_id": idea["_id"]},
        {"$pull": {"tasks": {"id": task_id}}},
    )

    # modified_count == 0 means $pull matched nothing — task id doesn't exist
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Task not found")

    return Response(status_code=status.HTTP_204_NO_CONTENT)
