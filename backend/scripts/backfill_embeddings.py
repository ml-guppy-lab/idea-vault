# cd backend
# for dry run without write operation: python -m scripts.backfill_embeddings --dry-run
# to actually run the script to embedd unembedded ideas: python -m scripts.backfill_embeddings

"""
Backfill embeddings for existing ideas that pre-date the embedding feature.

Usage (from the backend/ directory):
    python -m scripts.backfill_embeddings

What it does:
    1. Connects to MongoDB using the same settings as the main app.
    2. Finds every idea document that has no `embedding` field.
    3. Generates a 384-dim embedding from `title + summary` for each.
    4. Writes the embedding back with a targeted $set — no other fields touched.

Safe to run multiple times: the query filter `{"embedding": {"$exists": False}}`
means already-embedded ideas are never touched.
"""

import asyncio
import sys

from motor.motor_asyncio import AsyncIOMotorClient

# Import settings and embedding service from the app package.
# Run this script from backend/ so `app` is on the Python path:
#   cd backend && python -m scripts.backfill_embeddings
from app.core.config import Settings
from app.services.embedding_service import generate_idea_embedding


async def backfill(dry_run: bool = False) -> None:
    settings = Settings()

    client = AsyncIOMotorClient(settings.MONGO_URI)
    db = client[settings.MONGO_DB_NAME]

    try:
        # Only process ideas that have no embedding yet.
        # This makes the script idempotent — safe to re-run at any time.
        query = {"embedding": {"$exists": False}}
        total = await db.ideas.count_documents(query)

        if total == 0:
            print("All ideas already have embeddings. Nothing to do.")
            return

        print(f"Found {total} idea(s) without embeddings.")
        if dry_run:
            print("[dry-run] No writes performed.")
            return

        ok = 0
        failed = 0

        # Process one at a time to keep memory flat and avoid overwhelming
        # the CPU. For thousands of ideas, batch processing would be faster,
        # but at portfolio scale this is clearer and safe to interrupt/resume.
        async for doc in db.ideas.find(query, {"_id": 1, "title": 1, "summary": 1}):
            idea_id = doc["_id"]
            title   = doc.get("title", "")
            summary = doc.get("summary", "")

            if not title and not summary:
                print(f"  SKIP  {idea_id} — no title or summary to embed")
                continue

            try:
                # model.encode() is CPU-bound; offload to thread pool so the
                # event loop stays free for other coroutines if any run alongside.
                embedding = await asyncio.to_thread(generate_idea_embedding, title, summary)

                # Targeted $set — only writes the embedding field.
                # All other fields (title, description, tags, etc.) are untouched.
                await db.ideas.update_one(
                    {"_id": idea_id},
                    {"$set": {"embedding": embedding}},
                )
                print(f"  OK    {idea_id}  \"{title[:60]}\"")
                ok += 1

            except Exception as exc:
                # Log and continue — don't let one bad document abort the run.
                print(f"  FAIL  {idea_id}  \"{title[:60]}\" — {exc}", file=sys.stderr)
                failed += 1

        print(f"\nDone. {ok} embedded, {failed} failed.")

    finally:
        client.close()


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    asyncio.run(backfill(dry_run=dry_run))
