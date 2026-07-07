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
from typing import AsyncGenerator, Awaitable, Callable, Optional

import sentry_sdk
from motor.motor_asyncio import AsyncIOMotorDatabase
import redis.asyncio as aioredis

from app.ai.query_decomposer import decompose_and_route
from app.ai.query_rewriter import rewrite_query
from app.services.intent_classifier import SCOPE_REFUSAL, QueryIntent
from app.services.rag_service import stream_rag_response
from app.services.session_service import save_exchange

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


async def refusal_stream(
    text: str, session_id: Optional[str] = None
) -> AsyncGenerator[str, None]:
    """
    Emit a fixed refusal as a minimal RAG-style SSE stream.

    Used by the deterministic guards (e.g. code-generation requests) so a
    refusal renders as a normal assistant message on the client — with NO LLM
    call at all. When a session_id is supplied it is emitted so the client can
    keep the conversation thread.
    """
    yield format_sse({"type": "mode", "content": "rag"})
    if session_id:
        yield format_sse({"type": "session", "content": session_id})
    yield format_sse({"type": "text", "content": text})
    yield format_sse({"type": "done", "content": ""})


async def stream_rag_sse(
    message: str,
    user_id: str,
    db: AsyncIOMotorDatabase,
    *,
    history: Optional[list[dict]] = None,
    redis: Optional[aioredis.Redis] = None,
    session_id: Optional[str] = None,
    is_disconnected: Optional[Callable[[], Awaitable[bool]]] = None,
) -> AsyncGenerator[str, None]:
    """
    Run the full RAG pipeline for one message and yield SSE record strings.

    - `user_id` must come from the verified JWT — it is passed straight through
      to every DB query so a user can only ever read their own ideas.
    - `message` is validated at the HTTP boundary (ChatRequest, max 500 chars)
      and truncated again inside the RAG service (defence in depth).
    - `history` (already windowed) gives the model prior turns for context and
      lets a follow-up be rewritten into a standalone search query.
    - When `redis` + `session_id` are provided, the completed user→assistant
      exchange is persisted to the session (read endpoint only; the legacy
      /api/chat caller passes neither and so nothing is stored).
    - `is_disconnected` (the request's disconnect check) lets us stop generating
      the moment the user hits Stop / navigates away: we break the token loop,
      which closes the upstream LLM stream so no more tokens are billed, and
      persist whatever partial reply was produced (tagged `interrupted`).
    - Every step is guarded so any failure yields a typed `error` event instead
      of dropping the connection and leaving the client hanging.
    """
    history = history or []

    # ── Step 0: Query rewriting for retrieval (only with prior context) ───────
    # A follow-up like "which of these relate to weight loss?" embeds to noise on
    # its own. With history we rewrite it into a standalone query used ONLY for
    # retrieval; the ORIGINAL message is still what the answer model sees.
    search_query = message
    if history:
        search_query = await rewrite_query(history, message)
        if search_query != message:
            logger.info("[chat] rewrote follow-up into standalone query user=%s", user_id)

    # ── Step 1 + 2: Decompose → classify each part → route ────────────────────
    yield format_sse({"type": "status", "content": "Analysing your request..."})
    try:
        context = await decompose_and_route(query=search_query, user_id=user_id, db=db)
    except Exception:
        logger.exception("[chat] decompose_and_route failed for user=%s", user_id)
        sentry_sdk.capture_exception()
        yield format_sse({"type": "error", "content": "Something went wrong. Please try again."})
        return

    # ── Hard guardrail: off-topic / general-knowledge request ──────────────────
    # The classifier judged this message to be outside Idea Vault's scope.
    # Return the fixed refusal and SKIP generation entirely — no tokens spent.
    dominant_intent = context.get("intent", "SEMANTIC_SEARCH")
    if dominant_intent == QueryIntent.OUT_OF_SCOPE.value:
        yield format_sse({"type": "text", "content": SCOPE_REFUSAL})
        yield format_sse({"type": "done", "content": ""})
        if redis is not None and session_id:
            await save_exchange(redis, user_id, session_id, message, SCOPE_REFUSAL)
        return

    # Intent-specific status while the LLM generates the response.
    yield format_sse({"type": "status", "content": _STATUS_MAP.get(dominant_intent, "Processing...")})

    # ── Step 3: Stream LLM response (history-aware) ───────────────────────────
    assistant_parts: list[str] = []
    saw_error = False
    interrupted = False
    async for event in stream_rag_response(
        user_message=message, context=context, history=history
    ):
        if event.get("type") == "text":
            assistant_parts.append(event.get("content", ""))
        elif event.get("type") == "error":
            saw_error = True
        yield format_sse(event)

        # Client hung up (hit Stop / closed the tab). Stop pulling tokens from
        # the LLM immediately — breaking closes the upstream stream so the rest
        # of the response is never generated or billed.
        if is_disconnected is not None and await is_disconnected():
            interrupted = True
            logger.info("[chat] client disconnected mid-stream; stopping user=%s", user_id)
            break

    # Persist the exchange. A clean, completed reply is saved normally; a partial
    # reply (user hit Stop) is saved tagged `interrupted` so context stays
    # coherent without letting a half-sentence pollute query rewriting. Errors
    # and empty partials are never written.
    if redis is not None and session_id:
        partial = "".join(assistant_parts)
        if interrupted:
            if partial:
                await save_exchange(
                    redis, user_id, session_id, message, partial, interrupted=True
                )
        elif not saw_error:
            await save_exchange(redis, user_id, session_id, message, partial)
