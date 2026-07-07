"""
Vector search service — semantic similarity search over the ideas collection.

Uses MongoDB Atlas $vectorSearch with the `idea_embeddings` index (HNSW,
cosine similarity, 384 dimensions). The index was created in the Atlas UI
with a `userId` filter field so user isolation is enforced at the DB engine
level, not just in application code.

Embeddings are generated using HuggingFace's sentence-transformers model
(all-MiniLM-L6-v2), which produces 384-dimensional vectors.
"""

import asyncio
import re

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.embedding_service import generate_query_embedding


# ── Status-aware result ranking (metadata-aware, NOT cross-encoder reranking) ──
#
# A rule-based post-processing step that nudges completed work (shipped /
# abandoned) below active ideas using a field we already store — `status` — so
# a default query like "do I have any fitness ideas?" surfaces ideas the user
# can still act on instead of burying them under finished ones. This adds ZERO
# extra model calls; it is deliberately NOT the cross-encoder reranking
# (Cohere / BGE) discussed elsewhere. Refer to it as "metadata-aware result
# ranking" in docs to stay accurate.
_STATUS_MULTIPLIER: dict[str, float] = {
    "raw": 1.0,
    "exploring": 1.0,
    "validated": 1.0,
    "building": 1.0,
    "shipped": 0.6,
    "abandoned": 0.5,
}

# Signals that the user is EXPLICITLY asking about completed / shipped / past
# ideas. When any of these match, the status penalty is skipped so queries like
# "what fitness ideas did I ship?" or "have I ever had a fitness idea?" return
# completed ideas prominently instead of demoting them. High-precision by
# design — it must not fire on ordinary active-idea queries.
_COMPLETED_QUERY_PATTERN = re.compile(
    r"\b("
    r"ship(?:ped|ping)?|launch(?:ed|ing)?|complet(?:e|ed|ing)|finish(?:ed|ing)?|"
    r"abandon(?:ed|ing)?|dropped|killed|"
    r"already\s+(?:built|made|done|shipped|launched)|"
    r"have\s+i\s+ever|ever\s+(?:had|made|created|built|thought)|"
    r"in\s+the\s+past|previously|past\s+ideas?|"
    r"did\s+i\s+(?:ship|build|make|launch|complete|finish)"
    r")\b",
    re.IGNORECASE,
)


def query_targets_completed(query: str) -> bool:
    """
    True if the query is explicitly about completed / shipped / past ideas.

    Used to decide whether to apply the status penalty. Pure regex — no LLM
    call — matching the project's layered fast-path guard pattern.
    """
    return bool(_COMPLETED_QUERY_PATTERN.search(query or ""))


def rerank_by_status(ideas: list[dict]) -> list[dict]:
    """
    Demote completed ideas (shipped / abandoned) below active ones by scaling
    each idea's similarity `score` with a per-status multiplier, then sort by
    the adjusted score (descending).

    Pure and side-effect-light: writes an `adjusted_score` field on each dict
    for observability but does not touch the original `score`. Ideas missing a
    `status` or `score` fall back to neutral (multiplier 1.0, score 1.0).
    """
    for idea in ideas:
        original_score = idea.get("score", 1.0)
        multiplier = _STATUS_MULTIPLIER.get(idea.get("status", "raw"), 1.0)
        idea["adjusted_score"] = original_score * multiplier
    return sorted(ideas, key=lambda x: x["adjusted_score"], reverse=True)


async def search_similar_ideas(
    query: str,
    user_id: str,
    db: AsyncIOMotorDatabase,
    limit: int = 5,
    tag: str | None = None,
    min_score: float = 0.60,
) -> list[dict]:
    """
    Return the top-N ideas most semantically similar to `query`.

    Flow:
        query string
          -> generate_query_embedding()  (HuggingFace Inference API)
          -> $vectorSearch against `idea_embeddings` Atlas index
          -> filter: userId + optional tag  (applied at index level)
          -> project: drop raw `embedding` array from results
          -> return list of serialised idea dicts with a `score` field (0-1)

    Security:
        The `userId` filter is NEVER omitted. MongoDB's index enforces this at
        the engine level — User A physically cannot receive User B's ideas even
        if application code had a bug.

    Args:
        query:    Natural-language search string from the user.
        user_id:  Authenticated user's ID (string). Injected by the route from
                  the JWT — never accepted from the client directly.
        db:       Motor database instance (injected via FastAPI dependency).
        limit:     Max results to return (default 5, max enforced by the route).
        tag:       Optional tag pre-filter. Narrows the candidate set to ideas
                   whose `tags` array contains this value before vector scoring.
        min_score: Minimum cosine similarity (0–1) a result must reach to be
                   returned. Prevents returning irrelevant ideas just because
                   they are the closest match in a small dataset. 0.60 is the
                   practical floor for sentence-transformers on short summaries
                   — below this the model has insufficient signal to discriminate.
                   Summaries of 3–5 dense sentences will naturally push relevant
                   scores above 0.80 and irrelevant ones below 0.55.
    """
    # Embed the query using HuggingFace's API with the same model used for documents.
    # This is a network call to HuggingFace's servers, not CPU-bound.
    query_embedding: list[float] = await asyncio.to_thread(generate_query_embedding, query)

    # Build the userId + optional tag filter.
    # $vectorSearch applies this filter before cosine scoring —
    # only matching documents are even considered as candidates.
    vector_filter: dict = {"userId": user_id}
    if tag:
        # MongoDB matches array fields directly: {"tags": "mobile"} returns
        # every document whose tags array contains "mobile".
        vector_filter["tags"] = tag

    pipeline = [
        {
            "$vectorSearch": {
                # Name of the Atlas Vector Search index created in the UI.
                "index": "idea_embeddings",
                # Field that holds the 384-dim float vector on each document.
                "path": "embedding",
                # The query converted to the same vector space.
                "queryVector": query_embedding,
                # numCandidates: how many docs the HNSW index pre-selects
                # before scoring. Must be >= limit. Higher = better recall,
                # slower query. 10× limit is the standard starting point.
                "numCandidates": max(limit * 10, 50),
                "limit": limit,
                # User isolation — enforced at the DB index level.
                "filter": vector_filter,
            }
        },
        {
            "$project": {
                "title": 1,
                "summary": 1,
                "description": 1,
                "tags": 1,
                "status": 1,
                "priority": 1,
                "imageUrl": 1,
                "createdAt": 1,
                "updatedAt": 1,
                # Cosine similarity score (0 = unrelated, 1 = identical).
                # Exposed so the frontend can optionally show relevance.
                "score": {"$meta": "vectorSearchScore"},
                # `embedding` is not listed here so MongoDB excludes it
                # automatically — inclusion projections drop all unlisted fields.
                # (Mixing embedding:0 with other field:1 causes a MongoDB error.)
            }
        },
        # Drop results below the minimum similarity threshold.
        # Without this, $vectorSearch always returns `limit` results even when
        # the best match is irrelevant — e.g. returning a health app for a
        # "machine learning" query just because it's the only document.
        # 0.70 is a reasonable cutoff for MiniLM cosine similarity on short text.
        {"$match": {"score": {"$gte": min_score}}},
    ]

    docs = await db.ideas.aggregate(pipeline).to_list(limit)

    # Convert BSON ObjectId → plain string for JSON serialisation.
    for doc in docs:
        doc["_id"] = str(doc["_id"])

    return docs
