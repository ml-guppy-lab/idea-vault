"""
Streaming chat endpoint — RAG pipeline over SSE.

DEPRECATED: superseded by POST /api/ai/chat, which classifies the message and
routes it to either this RAG read pipeline or the agent (write) pipeline. This
endpoint is kept alive for backward compatibility and will be removed in a
future cleanup pass.

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

import logging

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
import redis.asyncio as aioredis

from app.ai.chat_pipeline import stream_rag_sse
from app.core.rate_limit import check_message_rate_limit
from app.core.security import get_current_user
from app.db.mongodb import get_mongo_db
from app.db.redis import get_redis
from app.models.user import User
from app.schemas.chat import ChatRequest

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger("app.chat")


@router.post(
    "",
    summary="[Deprecated] Ask the AI assistant a question about your ideas",
    deprecated=True,
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
    await check_message_rate_limit(user_id, redis)

    return StreamingResponse(
        stream_rag_sse(request.message, user_id, db),
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
