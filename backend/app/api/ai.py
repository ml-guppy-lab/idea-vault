"""
Unified AI chat endpoint.

POST /api/ai/chat
    Body: ChatRequest {"message": "..."}
    Auth: JWT Bearer token (user_id always taken from the token, never the body)

This single endpoint classifies the message and routes it to one of two
pipelines, replacing the separate POST /api/chat and POST /api/agent calls:

    AGENT_WRITE → agentic-AI service. Returns a JSON body:
        {"mode": "agent", "message": "...", "proposals": [ ... ]}
        Proposals are pending suggestions — NOTHING is written to the database
        here. The user approves/rejects each one via POST /api/agent/decide.

    AGENT_READ  → RAG read pipeline. Returns text/event-stream (SSE). The first
        event is {"type": "mode", "content": "rag"} so the client can branch on
        the streaming response, followed by the usual status/thinking/text/done
        events.

The client distinguishes the two modes by Content-Type:
    application/json       → agent (write) response
    text/event-stream      → RAG (read) stream
"""

import logging

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
import redis.asyncio as aioredis

from app.ai.chat_pipeline import format_sse, refusal_stream, stream_rag_sse
from app.core.rate_limit import check_message_rate_limit
from app.core.security import get_current_user
from app.db.mongodb import get_mongo_db
from app.db.redis import get_redis
from app.models.user import User
from app.schemas.chat import ChatRequest
from app.services.agentic_ai.agent_service import run_agent
from app.services.intent_classifier import (
    CODE_REFUSAL,
    ChatRoute,
    classify_chat_route,
    is_code_generation_request,
)
from app.services.session_service import (
    generate_session_id,
    get_managed_history,
    save_exchange,
)

router = APIRouter(prefix="/ai", tags=["ai"])
logger = logging.getLogger("app.chat")


@router.post(
    "/chat",
    summary="Unified AI chat — routes to the agent (write) or RAG (read) pipeline",
    # No response_model: the response is either a JSON body (agent mode) or an
    # SSE StreamingResponse (RAG mode), decided at request time.
)
async def unified_chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),    # JWT auth gate
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),  # Motor DB dependency
    redis: aioredis.Redis = Depends(get_redis),        # Redis for rate limiting
):
    """
    Classify the message, then route it:
      - AGENT_WRITE → run_agent → JSON {"mode": "agent", ...}
      - AGENT_READ  → RAG streaming SSE

    The rate limit is checked before any classification or LLM call so
    over-limit requests consume no tokens. It shares the same Redis budget as
    the legacy /api/chat endpoint, so users cannot bypass it by switching
    endpoints.
    """
    user_id = str(current_user.id)

    # Reject before any LLM work — 429 is a plain JSON response.
    await check_message_rate_limit(user_id, redis)

    # ── Conversation session ──────────────────────────────────────────────────
    # A missing/blank session_id starts a fresh conversation. We ALWAYS build the
    # Redis key from the JWT user_id (never trust the body to identify a user),
    # so a forged session_id can only ever touch this user's own history.
    session_id = request.session_id or generate_session_id()
    # Managed history = the rolling summary (if any) + the recent message window,
    # ready to drop straight into the prompt.
    window = await get_managed_history(redis, user_id, session_id)

    # ── Hard guardrail (zero LLM): explicit "write code" requests ──────────────
    # A high-precision detector catches the clearest code-generation requests
    # and refuses them WITHOUT any classifier or generation call. Anything it
    # does not catch is still handled by the OUT_OF_SCOPE classifier and the
    # system-prompt guardrails downstream.
    if is_code_generation_request(request.message):
        logger.info("[ai] code-generation request refused (no LLM) user=%s", user_id)
        await save_exchange(redis, user_id, session_id, request.message, CODE_REFUSAL)
        return StreamingResponse(
            refusal_stream(CODE_REFUSAL, session_id),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    route = await classify_chat_route(request.message)
    logger.info("[ai] route=%s user=%s", route.value, user_id)

    # ── Write path: agent proposals (non-streaming JSON) ──────────────────────
    if route == ChatRoute.AGENT_WRITE:
        # The agent only PROPOSES here — no database write occurs. Approval
        # happens later via POST /api/agent/decide.
        result = await run_agent(
            user_message=request.message, user_id=user_id, history=window
        )
        await save_exchange(redis, user_id, session_id, request.message, result.message)
        return JSONResponse(
            content={
                "mode": "agent",
                "message": result.message,
                # mode="json" converts enums (status/priority) to JSON-safe values.
                "proposals": [p.model_dump(mode="json") for p in result.proposals],
                "session_id": session_id,
            }
        )

    # ── Read path: RAG streaming (SSE) ────────────────────────────────────────
    async def _event_generator():
        # Leading mode event lets the client immediately know it's a RAG stream;
        # the session event lets it persist the id for follow-up messages.
        yield format_sse({"type": "mode", "content": "rag"})
        yield format_sse({"type": "session", "content": session_id})
        async for chunk in stream_rag_sse(
            request.message,
            user_id,
            db,
            history=window,
            redis=redis,
            session_id=session_id,
        ):
            yield chunk

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Prevents Nginx / proxies from buffering the stream so tokens arrive
            # incrementally instead of all at once.
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
