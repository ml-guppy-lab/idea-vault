"""
Ideas API — CRUD routes for the `ideas` collection in MongoDB.

All routes are protected by `get_current_user`, which validates the JWT from
the Authorization: Bearer header and returns the authenticated User row from
PostgreSQL. The `userId` stored on every idea document is that user's id string.
"""

from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import get_current_user
from app.db.mongodb import get_mongo_db
from app.models.user import User
from app.schemas.idea import IdeaCreate, IdeaResponse

router = APIRouter(prefix="/ideas", tags=["ideas"])


def _serialize_idea(doc: dict) -> dict:
    """
    Convert a raw MongoDB document to a dict that IdeaResponse can parse.

    MongoDB stores the primary key as `_id` (a BSON ObjectId). IdeaResponse
    expects it as a plain string. This helper converts _id → string in-place
    so Pydantic's `alias="_id"` mapping works correctly.
    """
    doc["_id"] = str(doc["_id"])
    return doc


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=IdeaResponse,
    summary="Create a new idea",
)
async def create_idea(
    payload: IdeaCreate,
    current_user: User = Depends(get_current_user),      # JWT auth gate
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),    # Motor DB dependency
) -> IdeaResponse:
    """
    Create a new idea and save it to MongoDB.

    - Requires a valid JWT in `Authorization: Bearer <token>`.
    - `userId` on the document is taken from the authenticated user — the
      client never sends it, so it cannot be spoofed.
    - `createdAt` and `updatedAt` are set server-side to the current UTC time.
    - Returns the saved document with its MongoDB-generated `_id` as `id`.
    """
    now = datetime.now(timezone.utc)  # single timestamp for both fields

    # Build the document to insert into MongoDB.
    # We use model_dump() to get a plain dict from the validated Pydantic model,
    # then inject server-controlled fields that the client must not provide.
    document = {
        **payload.model_dump(),   # title, description, tags, status, priority
        "userId": current_user.id,
        "createdAt": now,
        "updatedAt": now,
    }

    # Motor's insert_one returns an InsertOneResult with the generated _id.
    result = await db.ideas.insert_one(document)

    # Fetch the saved document back from MongoDB so we return exactly what was
    # stored (including the _id MongoDB generated) rather than reconstructing it.
    saved = await db.ideas.find_one({"_id": result.inserted_id})

    if saved is None:
        # Should never happen — insert_one succeeded immediately above.
        # Guard here so we never silently return None.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Idea was inserted but could not be retrieved",
        )

    # Convert ObjectId → str so IdeaResponse (alias="_id") can parse it.
    return IdeaResponse(**_serialize_idea(saved))

