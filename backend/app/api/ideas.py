"""
Ideas API — CRUD routes for the `ideas` collection in MongoDB.

All routes are protected by `get_current_user`, which validates the JWT from
the Authorization: Bearer header and returns the authenticated User row from
PostgreSQL. The `userId` stored on every idea document is that user's id string.
"""

import asyncio
import re
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, status, UploadFile, File
from motor.motor_asyncio import AsyncIOMotorDatabase
from app.services.image_service import validate_and_upload_image

from app.core.security import get_current_user
from app.db.mongodb import get_mongo_db
from app.models.user import User
from app.schemas.idea import IdeaCreate, IdeaListResponse, IdeaResponse, IdeaStatus, IdeaUpdate
from app.services.embedding_service import generate_idea_embedding

router = APIRouter(prefix="/ideas", tags=["ideas"])


async def _embed_and_store(db: AsyncIOMotorDatabase, idea_id: ObjectId, title: str, summary: str) -> None:
    """
    Background task: generate the embedding and write it to MongoDB.

    Runs AFTER the HTTP response is already sent to the client, so it never
    adds latency to the save operation. model.encode() is CPU-bound, so we
    offload it to a thread pool via asyncio.to_thread to avoid blocking the
    event loop while it runs.
    """
    embedding = await asyncio.to_thread(generate_idea_embedding, title, summary)
    await db.ideas.update_one({"_id": idea_id}, {"$set": {"embedding": embedding}})


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
    "/create",
    status_code=status.HTTP_201_CREATED,
    response_model=IdeaResponse,
    summary="Create a new idea",
)
async def create_idea(
    payload: IdeaCreate,
    background_tasks: BackgroundTasks,
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

    # Build the document WITHOUT the embedding — it is generated in a
    # background task after this response is returned, so the user sees
    # an instant save. The embedding field is added async moments later.
    document = {
        **payload.model_dump(),   # title, summary, description, tags, status, priority
        "userId": current_user.id,
        "createdAt": now,
        "updatedAt": now,
    }

    # Motor's insert_one returns an InsertOneResult with the generated _id.
    result = await db.ideas.insert_one(document)

    # Queue embedding generation — runs after response is sent, zero UX impact.
    background_tasks.add_task(
        _embed_and_store, db, result.inserted_id, payload.title, payload.summary
    )

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

@router.post(
    "/image",
    summary="Upload an image for an idea"
)
async def upload_image(
    file: UploadFile = File(...),
    current_user = Depends(get_current_user)
):
    image_url = await validate_and_upload_image(
        file=file,
        user_id=str(current_user.id)
    )
    return {"url": image_url}

@router.get(
    "/list",
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

    # --- filter params ---
    # Both are optional — omitting them returns all ideas for this user.
    # They can be combined freely with each other and with pagination/sorting.
    status: IdeaStatus | None = Query(
        default=None,
        description="Filter by status: raw | exploring | validated | building | shipped | abandoned",
    ),
    tag: str | None = Query(
        default=None,
        max_length=50,
        description="Filter by tag — returns ideas whose tags array contains this exact value",
    ),

    # --- auth + db dependencies ---
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),
) -> IdeaListResponse:
    """
    Return a paginated, sorted, optionally filtered list of ideas owned by the
    authenticated user.

    - Only ideas where `userId == current_user.id` are returned.
    - `page` and `limit` control which slice of results to return.
    - `sort_by` accepts: createdAt, updatedAt, priority.
    - `order` accepts: asc, desc.
    - `status` filters to ideas with that exact status value (optional).
    - `tag` filters to ideas whose tags array contains that string (optional).
    - All filters combine: ?status=raw&tag=AI returns raw ideas tagged AI.
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
    query_filter: dict = {"userId": current_user.id}

    # --- apply optional filters ---
    # Each filter is only added to the query when the param was actually
    # provided (not None). This means omitting a param has no effect on
    # the results — it is not treated as "match None".

    if status is not None:
        # IdeaStatus is a str enum, so `status` is already the plain string
        # value (e.g. "raw"). We store it directly — no .value needed.
        query_filter["status"] = status

    if tag is not None:
        # MongoDB automatically matches array fields: {"tags": "mobile"}
        # returns every document where the tags array contains "mobile".
        # No special operator ($in, $elemMatch) is needed for a single value.
        query_filter["tags"] = tag

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


@router.get(
    "/search",
    status_code=status.HTTP_200_OK,
    response_model=IdeaListResponse,
    summary="Search ideas by keyword",
)
async def search_ideas(
    # --- required search query ---
    q: str = Query(
        ...,
        min_length=1,
        max_length=200,
        description="Keyword to search in title and description (case-insensitive)",
    ),

    # --- pagination params (same defaults as /list) ---
    page: int = Query(default=1, ge=1, description="Page number, 1-based"),
    limit: int = Query(default=10, ge=1, le=100, description="Items per page (max 100)"),

    # --- auth + db dependencies ---
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),
) -> IdeaListResponse:
    """
    Search the authenticated user's ideas by keyword.

    - `q` is matched against both `title` and `description` using a
      case-insensitive regex (MongoDB `$regex` with `$options: "i"`).
    - Only ideas owned by the authenticated user are searched — users can
      never see each other's results.
    - Results are paginated with `page` and `limit` the same way as /list.
    - The query string is regex-escaped before use to prevent ReDoS attacks.
    """

    # --- sanitise the query: strip leading/trailing whitespace ---
    q = q.strip()

    # --- escape special regex characters to prevent ReDoS ---
    # e.g. a query of "(" or ".+" would otherwise be interpreted as regex
    # syntax and could cause catastrophic backtracking or unexpected matches.
    # re.escape() turns every non-alphanumeric character into a literal match.
    escaped_q = re.escape(q)

    # --- build the case-insensitive regex pattern ---
    # $options: "i" makes MongoDB perform case-insensitive matching.
    # This is a substring match — "AI" will match "Building an AI tool".
    regex_pattern = {"$regex": escaped_q, "$options": "i"}

    # --- filter: this user's ideas WHERE title OR description matches ---
    # The userId check always runs first (it is an indexed field) so MongoDB
    # can narrow down the candidate set before applying the more expensive
    # regex scan on title/description.
    query_filter = {
        "userId": current_user.id,
        "$or": [
            {"title": regex_pattern},
            {"description": regex_pattern},
        ],
    }

    # --- count total matching documents for pagination metadata ---
    total = await db.ideas.count_documents(query_filter)

    # --- calculate skip offset for the requested page ---
    skip = (page - 1) * limit

    # --- fetch the matching page, sorted newest first ---
    # We default to createdAt descending so the most recent ideas appear first.
    # A future improvement could expose sort_by/order params here too.
    cursor = (
        db.ideas.find(query_filter)
        .sort("createdAt", -1)
        .skip(skip)
        .limit(limit)
    )
    docs = await cursor.to_list(length=limit)

    # --- serialize ObjectId → string for each document ---
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
    "/get/{idea_id}",
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


@router.put(
    "/update/{idea_id}",
    status_code=status.HTTP_200_OK,
    response_model=IdeaResponse,
    summary="Partially update an idea by ID",
)
async def update_idea(
    idea_id: str,
    payload: IdeaUpdate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),    # JWT auth gate
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),  # Motor DB dependency
) -> IdeaResponse:
    """
    Partially update an idea owned by the authenticated user.

    - Only fields that are explicitly provided in the request body are updated.
      Omitted fields are left unchanged in MongoDB (true partial update via $set).
    - Ownership is verified before any write — 403 if the idea belongs to
      another user (same rule as GET /ideas/{id} — never 404 for existing ideas).
    - `updatedAt` is always overwritten with the current UTC timestamp on any
      successful update, even if no other fields actually changed.
    - Returns the full updated document after the write.
    """

    # --- convert string id → ObjectId (raises 404 if format is invalid) ---
    oid = _parse_object_id(idea_id)

    # --- fetch the existing document to check it exists and is owned by caller ---
    doc = await db.ideas.find_one({"_id": oid})

    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Idea not found",
        )

    # --- ownership check: 403 if the idea belongs to someone else ---
    # Returning 403 (not 404) is intentional — see GET /ideas/{id} for rationale.
    if doc["userId"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to update this idea",
        )

    # --- build the $set payload from only the fields the client sent ---
    # model_dump(exclude_unset=True) returns only fields that were explicitly
    # included in the request JSON — omitted Optional fields are NOT included.
    # We additionally filter out None values because Swagger UI pre-fills the
    # request body with null for every optional field. Without this filter,
    # sending {"status": "exploring"} via Swagger would also write null to
    # title, description, tags, and priority — overwriting existing data.
    # Result: only fields with a real (non-None) value are written to MongoDB.
    updates = {
        k: v
        for k, v in payload.model_dump(exclude_unset=True).items()
        if v is not None
    }

    # Re-embed in background whenever title or summary changes.
    #
    # Embedding input = title + summary (design decision: description and tags
    # are not embedded — tags are used as $vectorSearch pre-filters, description
    # is retrieved post-search for display only).
    #
    # We compare new vs stored values so a no-op edit (sending the same title/
    # summary that's already saved) doesn't trigger an unnecessary background task.
    new_title   = updates.get("title",   doc.get("title",   ""))
    new_summary = updates.get("summary", doc.get("summary", ""))
    title_changed   = "title"   in updates and updates["title"]   != doc.get("title")
    summary_changed = "summary" in updates and updates["summary"] != doc.get("summary")

    if title_changed or summary_changed:
        background_tasks.add_task(_embed_and_store, db, oid, new_title, new_summary)

    # --- always stamp updatedAt, even if no other field changed ---
    updates["updatedAt"] = datetime.now(timezone.utc)

    # --- apply the update with $set — only the specified fields are written ---
    # $set never deletes other fields; it is a true partial update.
    await db.ideas.update_one({"_id": oid}, {"$set": updates})

    # --- fetch the updated document and return it ---
    # We re-fetch rather than merge locally so the response reflects exactly
    # what MongoDB persisted (consistent with POST /ideas behaviour).
    updated = await db.ideas.find_one({"_id": oid})

    return IdeaResponse(**_serialize_idea(updated))


@router.delete(
    "/delete/{idea_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an idea by ID",
)
async def delete_idea(
    idea_id: str,
    current_user: User = Depends(get_current_user),    # JWT auth gate
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),  # Motor DB dependency
) -> Response:
    """
    Permanently delete an idea owned by the authenticated user.

    - Only the owner can delete their own idea (403 for another user's idea).
    - Returns 204 No Content on success — no response body.
    - Returns 404 if the idea id is invalid or doesn't exist.
    - Returns 403 if the idea exists but belongs to a different user.
      (We intentionally distinguish 403 from 404 for authenticated owners.
       See GET /ideas/{id} for the full rationale.)
    """

    # --- convert string id → ObjectId (raises 404 if format is invalid) ---
    oid = _parse_object_id(idea_id)

    # --- fetch the existing document to verify it exists and is owned by caller ---
    # We must load the document first so we can check userId before deleting.
    # Deleting blindly with a combined filter (userId + _id) would return
    # deleted_count=0 for both "not found" and "wrong owner" — we can't tell
    # which case it is, so we can't return the correct status code (404 vs 403).
    doc = await db.ideas.find_one({"_id": oid})

    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Idea not found",
        )

    # --- ownership check: 403 if the idea belongs to someone else ---
    if doc["userId"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to delete this idea",
        )

    # --- delete the document from MongoDB ---
    await db.ideas.delete_one({"_id": oid})

    # --- return 204 No Content ---
    # FastAPI sends an empty body automatically when Response(status_code=204)
    # is returned and the route declares status_code=204. Returning Response
    # directly (rather than None) avoids FastAPI trying to serialise a body.
    return Response(status_code=status.HTTP_204_NO_CONTENT)

