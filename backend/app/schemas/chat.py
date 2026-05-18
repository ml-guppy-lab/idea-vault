"""
Pydantic schemas for the chat / RAG endpoint.

ChatRequest  — validated request body from the frontend
ChatMessage  — a single message in conversation history (for UI display)
"""

from typing import Literal

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


class ChatMessage(BaseModel):
    """
    A single turn in the conversation history.
    Used to hydrate the chat UI with past messages on page load.
    """

    role: Literal["user", "assistant"]
    content: str
