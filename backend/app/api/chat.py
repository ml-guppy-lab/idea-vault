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

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import get_current_user
from app.db.mongodb import get_mongo_db
from app.models.user import User
from app.schemas.chat import ChatRequest
from app.services.rag_service import stream_rag_response

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post(
    "",
    summary="Ask the AI assistant a question about your ideas",
    # No response_model — StreamingResponse is returned, not a JSON body.
)
async def chat(
    request: ChatRequest,
    current_user: User = Depends(get_current_user),    # JWT auth gate
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),  # Motor DB dependency
) -> StreamingResponse:
    """
    Run the full RAG pipeline and stream the response as Server-Sent Events.

    - `user_id` is taken from the authenticated JWT — never from the request body.
      This ensures a user can only query their own ideas.
    - The message is validated by ChatRequest (max 500 chars) before reaching
      the RAG service, providing defence-in-depth against prompt injection.
    - If the LLM is rate-limited, the service retries with backoff and falls
      back to the configured secondary model — the client sees an `error` event
      only if all retries are exhausted.
    """
    user_id = str(current_user.id)

    async def _event_generator():
        """Serialise typed event dicts from rag_service into SSE format."""
        async for event in stream_rag_response(
            user_message=request.message,
            user_id=user_id,
            db=db,
        ):
            # Each SSE event: "data: <json>\n\n"
            # json.dumps ensures special characters (newlines, quotes) are safe.
            yield f"data: {json.dumps(event)}\n\n"

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
