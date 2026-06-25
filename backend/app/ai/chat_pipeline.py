"""
Shared RAG read pipeline rendered as Server-Sent Events.

This is the single source of truth for the "read" path used by both the legacy
streaming endpoint (POST /api/chat) and the unified endpoint (POST /api/ai/chat).
Keeping it here avoids duplicating the decompose → route → stream → SSE-framing
logic across two route modules.

Each yielded value is a fully-framed SSE record string:
    data: {"type": "text", "content": "Hello"}\n\n

Event `type` values: status | thinking | text | done | error.
"""

import json
import logging
from typing import AsyncGenerator

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.ai.query_decomposer import decompose_and_route
from app.services.rag_service import stream_rag_response

logger = logging.getLogger("app.chat")

# Intent value (string) → user-facing status label shown while the LLM works.
# Keys match QueryIntent.value returned by the handlers; compound queries use
# the dominant intent to pick the label.
_STATUS_MAP = {
    "CONVERSATIONAL": "Just a moment...",
    "LISTING": "Fetching your ideas...",
    "SEMANTIC_SEARCH": "Searching your ideas...",
    "COUNT": "Counting your ideas...",
}


def format_sse(event: dict) -> str:
    """Serialise an event dict into a single SSE record."""
    return f"data: {json.dumps(event)}\n\n"


async def stream_rag_sse(
    message: str,
    user_id: str,
    db: AsyncIOMotorDatabase,
) -> AsyncGenerator[str, None]:
    """
    Run the full RAG pipeline for one message and yield SSE record strings.

    - `user_id` must come from the verified JWT — it is passed straight through
      to every DB query so a user can only ever read their own ideas.
    - `message` is validated at the HTTP boundary (ChatRequest, max 500 chars)
      and truncated again inside the RAG service (defence in depth).
    - Every step is guarded so any failure yields a typed `error` event instead
      of dropping the connection and leaving the client hanging.
    """
    # ── Step 1 + 2: Decompose → classify each part → route ────────────────────
    yield format_sse({"type": "status", "content": "Analysing your request..."})
    try:
        context = await decompose_and_route(query=message, user_id=user_id, db=db)
    except Exception:
        logger.exception("[chat] decompose_and_route failed for user=%s", user_id)
        yield format_sse({"type": "error", "content": "Something went wrong. Please try again."})
        return

    # Intent-specific status while the LLM generates the response.
    dominant_intent = context.get("intent", "SEMANTIC_SEARCH")
    yield format_sse({"type": "status", "content": _STATUS_MAP.get(dominant_intent, "Processing...")})

    # ── Step 3: Stream LLM response ───────────────────────────────────────────
    async for event in stream_rag_response(user_message=message, context=context):
        yield format_sse(event)
