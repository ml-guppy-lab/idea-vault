"""
Ideas API — CRUD routes for the `ideas` collection in MongoDB.

All routes are protected by `get_current_user`, which validates the JWT from
the Authorization: Bearer header and returns the authenticated User row from
PostgreSQL. The `userId` stored on every idea document is that user's id string.
"""

from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import get_current_user
from app.db.mongodb import get_mongo_db
from app.models.user import User
from app.schemas.idea import IdeaCreate, IdeaListResponse, IdeaResponse

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


# ---------------------------------------------------------------------------
# Allowed values for sort_by and order query parameters.
# Defined as constants here so the validation logic and the MongoDB sort
# direction map are in one place — no magic strings scattered around.
# ---------------------------------------------------------------------------

_SORTABLE_FIELDS = {"createdAt", "updatedAt", "priority"}

# MongoDB uses 1 for ascending, -1 for descending.
_SORT_DIRECTION = {"asc": 1, "desc": -1}

# Priority has a custom sort order — it is a string enum, so alphabetical
# order (high < low < medium) is wrong. We use a computed field trick:
# add a temporary numeric weight in the aggregation pipeline instead.
_PRIORITY_WEIGHT = {"low": 1, "medium": 2, "high": 3}


@router.get(
    "",
    status_code=status.HTTP_200_OK,
    response_model=IdeaListResponse,
    summary="List the logged-in user's ideas (paginated)",
)
async def list_ideas(
    # --- pagination params ---
    page: int = Query(default=1, ge=1, description="Page number, 1-based"),
    limit: int = Query(default=10, ge=1, le=100, description="Items per page (max 100)"),

    # --- sorting params ---
    sort_by: str = Query(
        default="createdAt",
        description="Field to sort by: createdAt | updatedAt | priority",
    ),
    order: str = Query(
        default="desc",
        description="Sort direction: asc | desc",
    ),

    # --- auth + db dependencies ---
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),
) -> IdeaListResponse:
    """
    Return a paginated, sorted list of ideas owned by the authenticated user.

    - Only ideas where `userId == current_user.id` are returned.
    - `page` and `limit` control which slice of results to return.
    - `sort_by` accepts: createdAt, updatedAt, priority.
    - `order` accepts: asc, desc.
    - Priority sorting uses a numeric weight (low=1, medium=2, high=3)
      because alphabetical order of the enum strings is incorrect.
    """

    # --- validate sort_by and order before touching the DB ---
    # Reject unknown values with a clear 400 instead of a silent MongoDB error.
    if sort_by not in _SORTABLE_FIELDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid sort_by '{sort_by}'. Must be one of: {', '.join(sorted(_SORTABLE_FIELDS))}",
        )
    if order not in _SORT_DIRECTION:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid order. Must be 'asc' or 'desc'",
        )

    # --- base filter: only this user's ideas ---
    query_filter = {"userId": current_user.id}

    # --- calculate how many documents to skip for the requested page ---
    # e.g. page=2, limit=10 → skip 10 documents, return documents 11-20
    skip = (page - 1) * limit

    # --- count total matching documents for the pagination metadata ---
    # count_documents is an indexed operation (userId has an index) — fast.
    total = await db.ideas.count_documents(query_filter)

    # --- build the sort specification ---
    if sort_by == "priority":
        # Priority is a string enum — MongoDB would sort alphabetically which
        # gives wrong order (high < low < medium). Instead we add a temporary
        # numeric `_priorityWeight` field in an aggregation pipeline, sort by
        # that, then remove it before returning.
        direction = _SORT_DIRECTION[order]
        pipeline = [
            # Stage 1: filter to this user's ideas only
            {"$match": query_filter},

            # Stage 2: add a numeric weight field so we can sort correctly
            {"$addFields": {
                "_priorityWeight": {
                    "$switch": {
                        "branches": [
                            {"case": {"$eq": ["$priority", "low"]},    "then": 1},
                            {"case": {"$eq": ["$priority", "medium"]}, "then": 2},
                            {"case": {"$eq": ["$priority", "high"]},   "then": 3},
                        ],
                        "default": 0,
                    }
                }
            }},

            # Stage 3: sort by weight
            {"$sort": {"_priorityWeight": direction}},

            # Stage 4: remove the temporary weight field before returning
            {"$unset": "_priorityWeight"},

            # Stage 5: pagination — skip and limit
            {"$skip": skip},
            {"$limit": limit},
        ]
        cursor = db.ideas.aggregate(pipeline)
        docs = await cursor.to_list(length=limit)

    else:
        # For createdAt and updatedAt: straightforward find + sort
        direction = _SORT_DIRECTION[order]
        cursor = (
            db.ideas.find(query_filter)
            .sort(sort_by, direction)
            .skip(skip)
            .limit(limit)
        )
        docs = await cursor.to_list(length=limit)

    # --- serialize each document: ObjectId → string ---
    items = [IdeaResponse(**_serialize_idea(doc)) for doc in docs]

    return IdeaListResponse(
        items=items,
        total=total,
        page=page,
        limit=limit,
    )


def _parse_object_id(idea_id: str) -> ObjectId:
    """
    Safely convert a string to a BSON ObjectId.

    MongoDB's ObjectId has a specific 24-hex-character format. If the caller
    passes a string that doesn't match (e.g. "abc" or a UUID), bson raises
    InvalidId. We catch that and raise a clean 404 so the caller gets the
    same response as for a valid-but-nonexistent id — preventing format-based
    information leakage.
    """
    try:
        return ObjectId(idea_id)
    except Exception:
        # Treat an unparseable id the same as a genuinely missing document.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Idea not found",
        )


@router.get(
    "/{idea_id}",
    status_code=status.HTTP_200_OK,
    response_model=IdeaResponse,
    summary="Get a single idea by ID",
)
async def get_idea(
    idea_id: str,
    current_user: User = Depends(get_current_user),    # JWT auth gate
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),  # Motor DB dependency
) -> IdeaResponse:
    """
    Fetch a single idea by its MongoDB _id.

    Security rules (order matters):
    1. If `idea_id` is not a valid ObjectId format → 404 (no format leakage)
    2. If no document with that _id exists → 404
    3. If the document exists but belongs to a different user → 403 Forbidden
       (NOT 404 — returning 404 would let attackers confirm an id exists by
        toggling between 403 and 404 for different users)
    4. If the document belongs to the current user → 200 with the idea

    This order ensures that an attacker who guesses another user's idea id
    always gets 403, never any confirmation the id is valid.
    """

    # --- convert string id → ObjectId (raises 404 if format is wrong) ---
    oid = _parse_object_id(idea_id)

    # --- fetch the document from MongoDB by its primary key ---
    doc = await db.ideas.find_one({"_id": oid})

    # --- 404 if the idea doesn't exist at all ---
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Idea not found",
        )

    # --- 403 if the idea exists but belongs to someone else ---
    # This check MUST come after the existence check so we return 403
    # (not 404) for cross-user access attempts on real documents.
    # 403 is intentional: it tells the caller "you're authenticated but
    # not allowed", which is more accurate than pretending the resource
    # doesn't exist — and it prevents ID-enumeration via 404 vs 403 diff.
    if doc["userId"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access this idea",
        )

    # --- convert ObjectId → string and return ---
    return IdeaResponse(**_serialize_idea(doc))

