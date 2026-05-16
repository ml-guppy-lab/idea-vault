"""
Vector search service — semantic similarity search over the ideas collection.

Uses MongoDB Atlas $vectorSearch with the `idea_embeddings` index (HNSW,
cosine similarity, 384 dimensions). The index was created in the Atlas UI
with a `userId` filter field so user isolation is enforced at the DB engine
level, not just in application code.
"""

import asyncio

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.services.embedding_service import generate_embedding


async def search_similar_ideas(
    query: str,
    user_id: str,
    db: AsyncIOMotorDatabase,
    limit: int = 5,
    tag: str | None = None,
    min_score: float = 0.70,
) -> list[dict]:
    """
    Return the top-N ideas most semantically similar to `query`.

    Flow:
        query string
          -> generate_embedding()  (same model used at write time)
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
                   they are the closest match in a small dataset. Default 0.70
                   is calibrated for MiniLM on short English summaries.
    """
    # Embed the query in the same vector space as the stored idea embeddings.
    # model.encode() is CPU-bound; offload to thread pool so the event loop
    # isn't blocked while waiting for it.
    query_embedding: list[float] = await asyncio.to_thread(generate_embedding, query)

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
