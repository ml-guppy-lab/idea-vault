"""
Pydantic schemas for the chat / RAG endpoint.

ChatRequest  — validated request body from the frontend
ChatMessage  — a single message in conversation history (for UI display)
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

# Must match _MAX_USER_MSG_CHARS in rag_service.py — enforced at both the
# HTTP boundary (here) and inside the service (defence in depth).
_MAX_MESSAGE_CHARS = 500


class ChatRequest(BaseModel):
    """Body sent by the frontend when the user submits a chat message."""

    message: str = Field(
        ...,
        min_length=1,
        max_length=_MAX_MESSAGE_CHARS,
        description="The user's question or message to the AI assistant.",
    )
    # Conversation session id. Omit/null to start a fresh session — the backend
    # then generates one and returns it so follow-up messages can continue the
    # thread. Capped to bound the Redis key; the user_id in the key always comes
    # from the JWT, so a forged session_id can never reach another user's data.
    session_id: Optional[str] = Field(
        default=None,
        max_length=64,
        description="Conversation session id. Omit to start a new session.",
    )


class FeedbackRequest(BaseModel):
    """Thumbs-up/down feedback on a generated AI reply, scored in Langfuse."""

    trace_id: str = Field(
        ...,
        min_length=8,
        max_length=64,
        description="Langfuse trace id returned with the AI reply.",
    )
    value: bool = Field(..., description="True = thumbs up, False = thumbs down.")
    comment: Optional[str] = Field(
        default=None,
        max_length=500,
        description="Optional free-text note accompanying the rating.",
    )


class ChatMessage(BaseModel):
    """
    A single turn in the conversation history.
    Used to hydrate the chat UI with past messages on page load.
    """

    role: Literal["user", "assistant"]
    content: str
