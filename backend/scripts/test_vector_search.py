# Run it from backend: python -m scripts.test_vector_search

"""
Manual test script for the MongoDB Atlas vector search pipeline.

Connects directly to Atlas (using the same MONGO_URI as the app) and runs
a $vectorSearch query so you can verify the index is active and results look
sensible BEFORE wiring this into the API.

Usage (from backend/):
    python -m scripts.test_vector_search

The script will:
  1. Connect to MongoDB Atlas.
  2. Pick the first idea it finds and use its userId (so results are guaranteed).
  3. Run three different queries and print titles + similarity scores.
  4. Exit cleanly.

If you get OperationFailure / index not found → the Atlas index is not yet Active.
Wait until the Atlas UI shows the idea_embeddings index as "Active".
"""

import asyncio
import sys

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import Settings
from app.services.vector_search import search_similar_ideas


async def main() -> None:
    settings = Settings()

    client = AsyncIOMotorClient(settings.MONGO_URI)
    db = client[settings.MONGO_DB_NAME]

    try:
        # ── Pick a real userId from the DB so filter returns real results ──────
        # Prefer an idea that has a non-trivial summary so semantic scores are
        # meaningful. Falls back to the first document if none found.
        sample = await db.ideas.find_one(
            {"summary": {"$exists": True, "$not": {"$in": [None, ""]}}},
            {"userId": 1, "title": 1, "summary": 1},
        ) or await db.ideas.find_one({}, {"userId": 1, "title": 1, "summary": 1})
        if sample is None:
            print("No ideas found in the database. Create some ideas first.")
            return

        user_id = sample["userId"]
        print(f"Testing with userId: {user_id}")
        print(f"Sample idea: \"{sample.get('title', '(no title)')}\"")
        print(f"Summary: \"{sample.get('summary', '(none)')}\"")
        print("-" * 60)

        # ── Run queries relevant to the actual content in Atlas ───────────────
        test_queries = [
            "health and fitness tracking",
            "calorie and water intake",
            "machine learning website",
        ]

        for query in test_queries:
            print(f"\nQuery: \"{query}\"")
            try:
                results = await search_similar_ideas(
                    query=query,
                    user_id=user_id,
                    db=db,
                    limit=3,
                )
                if not results:
                    print(" [{score:.3f}] No results returned (index may still be building, "
                          "or no ideas match this user).")
                for r in results:
                    score = r.get("score", 0)
                    title = r.get("title", "(no title)")
                    print(f"  [{score:.3f}] {title}")
            except Exception as exc:
                # Most likely cause: index not yet Active in Atlas
                print(f"  ERROR: {exc}", file=sys.stderr)
                print("  → Is the idea_embeddings index Active in MongoDB Atlas?",
                      file=sys.stderr)

        print("\n" + "-" * 60)
        print("Done. If scores are between 0 and 1 and titles look relevant, "
              "the index is working correctly.")

    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
