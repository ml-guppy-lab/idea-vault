# to test, run from backend/: python testFiles/test_rag.py

"""
End-to-end smoke-test for the RAG pipeline.

Tests the full flow:
    user question -> vector search -> context build -> LLM stream -> printed output

Usage (from backend/):
    python testFiles/test_rag.py

Requirements:
    - Ollama running with qwen3:14b  (or LLM_PROVIDER=openrouter in .env)
    - MongoDB Atlas reachable (MONGO_URI in .env)
    - At least one idea saved for the test user (with an embedding)

To find your USER_ID:
    Run the app, log in, then check the PostgreSQL users table:
        docker exec -it <postgres_container> psql -U idea_user -d idea_vault_auth
        SELECT id, email FROM users LIMIT 10;
    Or check the MongoDB ideas collection — userId field on any document.
"""

import asyncio
import json
import os
import sys

# Allow imports from backend/ root without installing the package
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.mongodb import close_mongo_connection, connect_to_mongo, get_mongo_db
from app.services.rag_service import stream_rag_response

# ── Configure test ─────────────────────────────────────────────────────────────

# Replace with your actual PostgreSQL user ID (UUID string).
# The test will auto-detect a valid user ID from MongoDB if left as None.
USER_ID: str | None = None

TEST_QUESTIONS = [
    "What ideas do I have saved?",
    "Which of my ideas seems most promising?",
    "Do I have any ideas related to mobile apps or technology?",
    "What should I work on next?",
]


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _resolve_user_id(db) -> str:
    """
    If USER_ID is not set, pick the first userId found in the ideas collection.
    Useful for quick local testing without hardcoding a UUID.
    """
    if USER_ID:
        return USER_ID

    doc = await db.ideas.find_one({"embedding": {"$exists": True}}, {"userId": 1})
    if not doc:
        print("\n  ✗ No ideas with embeddings found in MongoDB.")
        print("    Fix: save at least one idea through the app, or run the backfill script:")
        print("         python -m scripts.backfill_embeddings")
        sys.exit(1)

    resolved = doc["userId"]
    print(f"  [auto] Using userId from MongoDB: {resolved}\n")
    return resolved


def _print_error(label: str, exc: BaseException) -> None:
    """Clean error output — no raw Python traceback."""
    print(f"\n{'=' * 50}")
    print(f"  FAILED: {label}")
    print(f"{'=' * 50}")
    print(f"  {type(exc).__name__}: {exc}")
    print("=" * 50)
    sys.exit(1)


# ── Main test ──────────────────────────────────────────────────────────────────

async def test() -> None:
    print("=" * 50)
    print("  RAG Pipeline End-to-End Test")
    print("=" * 50)

    # Connect to MongoDB
    print("\nConnecting to MongoDB...")
    await connect_to_mongo()
    db = get_mongo_db()
    print("  ✓ Connected")

    user_id = await _resolve_user_id(db)

    # Run each test question through the full RAG pipeline
    for question in TEST_QUESTIONS:
        print(f"\n{'─' * 50}")
        print(f"  Q: {question}")
        print(f"{'─' * 50}")

        thinking_shown = False
        reply_started = False

        async for event in stream_rag_response(question, user_id, db):
            etype = event.get("type")
            content = event.get("content", "")

            if etype == "thinking":
                if not thinking_shown:
                    print("  [thinking] ", end="", flush=True)
                    thinking_shown = True
                print(content, end="", flush=True)

            elif etype == "text":
                if not reply_started:
                    if thinking_shown:
                        print()  # newline after thinking block
                    print("  [reply]    ", end="", flush=True)
                    reply_started = True
                print(content, end="", flush=True)

            elif etype == "error":
                print(f"\n  ✗ Error: {content}")
                break

            elif etype == "done":
                print()  # newline after reply

        if not reply_started:
            print("  ⚠ No reply received for this question.")

    print(f"\n{'=' * 50}")
    print("  All questions answered.")
    print("=" * 50)

    await close_mongo_connection()


if __name__ == "__main__":
    try:
        asyncio.run(test())
    except KeyboardInterrupt:
        print("\n\nInterrupted.")
        sys.exit(0)
    except BaseException as exc:
        _print_error(type(exc).__name__, exc)
