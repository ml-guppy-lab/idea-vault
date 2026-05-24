"""
Streaming chat endpoint — RAG pipeline over SSE.

POST /api/chat
    Body: ChatRequest {"message": "..."}
    Auth: JWT Bearer token (same as all other protected routes)
    Response: text/event-stream (Server-Sent Events)

Each SSE event is a JSON-encoded dict:
    data: {"type": "thinking", "content": "..."}\n\n   — model reasoning
    data: {"type": "text",     "content": "..."}\n\n   — actual reply token
    data: {"type": "done",     "content": ""}\n\n      — stream finished
    data: {"type": "error",    "content": "..."}\n\n   — unrecoverable error

The frontend reads these events and routes by `type` to render thinking and
reply in separate UI sections, and to know when to hide the loading spinner.
"""

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
import redis.asyncio as aioredis

from app.ai.query_decomposer import decompose_and_route
from app.core.security import get_current_user
from app.db.mongodb import get_mongo_db
from app.db.redis import get_redis
from app.models.user import User
from app.schemas.chat import ChatRequest
from app.services.rag_service import stream_rag_response

router = APIRouter(prefix="/chat", tags=["chat"])

# ── Rate-limit constants ───────────────────────────────────────────────────────
_RATE_LIMIT_MAX = 20        # messages allowed per window
_RATE_LIMIT_WINDOW = 3600   # window size in seconds (1 hour)


async def _check_rate_limit(user_id: str, redis: aioredis.Redis) -> None:
    """
    Sliding-window rate limiter: max 20 chat messages per user per hour.

    Key: "chat_rl:{user_id}"  (namespaced to avoid collisions with other keys)
    - INCR atomically creates-or-increments the counter.
    - EXPIRE is set only on the first message so the window resets naturally
      after 1 hour without any background job.
    - Raises HTTP 429 before the RAG pipeline starts, so no LLM tokens are
      consumed for over-limit requests.
    """
    key = f"chat_rl:{user_id}"
    count = await redis.incr(key)
    if count == 1:
        # First message in this window — start the 1-hour expiry clock.
        await redis.expire(key, _RATE_LIMIT_WINDOW)
    if count > _RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail=f"Chat limit reached. You can send {_RATE_LIMIT_MAX} messages per hour.",
        )


@router.post(
    "",
    summary="Ask the AI assistant a question about your ideas",
    # No response_model — StreamingResponse is returned, not a JSON body.
)
async def chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),    # JWT auth gate
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),  # Motor DB dependency
    redis: aioredis.Redis = Depends(get_redis),        # Redis for rate limiting
) -> StreamingResponse:
    """
    Run the full RAG pipeline and stream the response as Server-Sent Events.

    - `user_id` is taken from the authenticated JWT — never from the request body.
      This ensures a user can only query their own ideas.
    - The message is validated by ChatRequest (max 500 chars) before reaching
      the RAG service, providing defence-in-depth against prompt injection.
    - Rate limit is checked before touching the LLM — over-limit requests are
      rejected immediately without consuming any LLM tokens.
    - If the LLM is rate-limited, the service retries with backoff and falls
      back to the configured secondary model — the client sees an `error` event
      only if all retries are exhausted.
    """
    user_id = str(current_user.id)

    # Reject before starting the stream — 429 is a plain JSON response.
    await _check_rate_limit(user_id, redis)

    async def _event_generator():
        """
        Full pipeline as an SSE generator:
            1. Classify intent   → emit status event
            2. Route to handler  → fetch context from DB
            3. Stream LLM        → emit thinking / text / done events

        Every step is wrapped in try/except so any failure yields a typed
        error event instead of silently dropping the connection (which causes
        the client to hang indefinitely waiting for data that never arrives).
        """
        # String keys match the .value returned by handlers (e.g. "LISTING").
        # Compound queries use the dominant intent to pick the status label.
        _status_map = {
            "CONVERSATIONAL":  "Just a moment...",
            "LISTING":         "Fetching your ideas...",
            "SEMANTIC_SEARCH": "Searching your ideas...",
            "COUNT":           "Counting your ideas...",
        }

        def _sse(event: dict) -> str:
            return f"data: {json.dumps(event)}\n\n"

        # ── Step 1 + 2: Decompose → classify each part → route ─────────────────
        # For simple queries this is identical to the old classify + route flow.
        # For compound queries (e.g. "hi, do I have any fitness ideas?") each
        # sub-query is classified and routed independently, then results merged.
        yield _sse({"type": "status", "content": "Analysing your request..."})
        try:
            # user_id always comes from the verified JWT — never from the request body.
            context = await decompose_and_route(
                query=request.message,
                user_id=user_id,
                db=db,
            )
        except Exception as exc:
            yield _sse({"type": "error", "content": f"Failed to process your request: {exc}"})
            return

        # Show intent-specific status while the LLM generates the response
        dominant_intent = context.get("intent", "SEMANTIC_SEARCH")
        yield _sse({"type": "status", "content": _status_map.get(dominant_intent, "Processing...")})

        # ── Step 3: Stream LLM response ───────────────────────────────────────
        async for event in stream_rag_response(
            user_message=request.message,
            context=context,
        ):
            yield _sse(event)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Prevents Nginx / proxies from buffering the stream.
            # Without this, the client receives the entire response at once
            # instead of token-by-token, defeating the purpose of streaming.
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
