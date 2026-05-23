"""
Intent handlers — one function per QueryIntent.

Each handler is responsible for exactly one thing: fetching the right data
from MongoDB and returning it in a normalised context dict. The LLM prompt
builder (rag_service) consumes this dict — it never touches the DB directly.

Security contract (enforced in every handler):
  - Every MongoDB query includes {"userId": user_id} — no exceptions.
  - user_id is always supplied by the caller from the verified JWT; it is
    never derived from user input inside these functions.
  - The `embedding` field is always excluded from results to prevent
    accidental leakage of large float arrays to the LLM context / client.

Return shape (all handlers):
  {
    "ideas":     list[dict],   # 0-N idea documents (embedding excluded)
    "intent":    str,          # matches QueryIntent.value
    "raw_query": str,          # original query (empty string where irrelevant)
    "count":     int | None,   # only set by handle_count
  }
"""

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.vector_search import search_similar_ideas

# Fields projected for listing/fallback queries.
# Explicit inclusion keeps the payload small and predictable.
# `embedding` is intentionally absent — it is a large float array with no
# value for the LLM and must never be forwarded downstream.
_IDEA_PROJECTION = {
    "title": 1,
    "summary": 1,
    "description": 1,
    "tags": 1,
    "status": 1,
    "priority": 1,
    "imageUrl": 1,
    "createdAt": 1,
    "updatedAt": 1,
    "embedding": 0,   # explicit exclusion — belt-and-suspenders
}

_LISTING_LIMIT = 10
_SEARCH_LIMIT = 5


# ── Handler: CONVERSATIONAL ────────────────────────────────────────────────────

async def handle_conversational(query: str) -> dict:
    """
    No database access needed. Greetings and small talk don't require idea
    context — the LLM answers directly from its own knowledge.
    """
    return {
        "ideas": [],
        "intent": "CONVERSATIONAL",
        "raw_query": query,
        "count": None,
    }


# ── Handler: LISTING ──────────────────────────────────────────────────────────

async def handle_listing(user_id: str, db: AsyncIOMotorDatabase) -> dict:
    """
    Return the N most recent ideas for this user.
    Used when the query asks to "show" or "list" ideas without a specific topic.
    """
    cursor = db.ideas.find(
        {"userId": user_id},      # ← user isolation: mandatory, never omitted
        _IDEA_PROJECTION,
    ).sort("createdAt", -1).limit(_LISTING_LIMIT)

    ideas = [_serialise(doc) async for doc in cursor]

    return {
        "ideas": ideas,
        "intent": "LISTING",
        "raw_query": "",
        "count": None,
    }


# ── Handler: COUNT ────────────────────────────────────────────────────────────

async def handle_count(user_id: str, db: AsyncIOMotorDatabase) -> dict:
    """
    Return the total number of ideas belonging to this user.
    MongoDB count_documents with a userId filter — O(1) for indexed fields.
    """
    count = await db.ideas.count_documents({"userId": user_id})  # ← mandatory filter

    return {
        "ideas": [],
        "intent": "COUNT",
        "raw_query": "",
        "count": count,
    }


# ── Handler: SEMANTIC_SEARCH ──────────────────────────────────────────────────

async def handle_semantic_search(
    query: str,
    user_id: str,
    db: AsyncIOMotorDatabase,
) -> dict:
    """
    Run vector similarity search against this user's idea embeddings.

    Falls back to the N most recent ideas if the vector index returns nothing
    (e.g. new user with few ideas, or query too generic to score above threshold).
    This mirrors the fallback logic already present in rag_service — kept here
    so the router is self-contained and rag_service can be simplified later.
    """
    ideas = await search_similar_ideas(
        query=query,
        user_id=user_id,   # ← user isolation enforced inside search_similar_ideas
        db=db,
        limit=_SEARCH_LIMIT,
    )

    # Fallback: generic queries (e.g. "what are my ideas?") score low against
    # specific idea content. Serve recent ideas so the LLM always has context.
    if not ideas:
        cursor = db.ideas.find(
            {"userId": user_id},   # ← mandatory filter even in fallback path
            _IDEA_PROJECTION,
        ).sort("createdAt", -1).limit(_SEARCH_LIMIT)
        ideas = [_serialise(doc) async for doc in cursor]

    return {
        "ideas": ideas,
        "intent": "SEMANTIC_SEARCH",
        "raw_query": query,
        "count": None,
    }


# ── Internal helpers ──────────────────────────────────────────────────────────

def _serialise(doc: dict) -> dict:
    """Convert BSON ObjectId → str so the dict is JSON-serialisable."""
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc
