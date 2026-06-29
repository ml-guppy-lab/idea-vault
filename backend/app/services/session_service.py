"""
Conversation session storage (Redis-backed).

A "session" is one continuous conversation. Every message is appended to a
per-user Redis key so follow-up questions ("which of these relate to weight
loss?") can be answered with the earlier turns as context.

Why Redis (not MongoDB):
    - Reads/writes happen on every single message, and Redis is in-memory
      (microsecond latency) so it never becomes the bottleneck.
    - Built-in TTL expires idle sessions automatically — no cleanup job, no
      stale rows. Sessions are ephemeral working memory, not permanent data.

Context-window management:
    LLMs have a finite context window, so we cannot feed an unbounded history.
    We keep a *sliding window* of the most recent messages (MAX_MESSAGES_IN_WINDOW)
    and fold everything older into a short *rolling summary* (à la LangChain's
    ConversationSummaryBufferMemory). The summary is regenerated lazily on the
    SAVE path (after the reply is sent) only once a conversation gets long, so
    reads stay fast and the extra LLM call is rare. Stored as
    ``{"summary": str|None, "messages": [...]}``; older bare-list sessions are
    still read transparently.

Security:
    The Redis key is ALWAYS namespaced with the user_id taken from the verified
    JWT — never from the request body. A guessed/forged session_id therefore can
    never reach another user's history.
"""

import json
import logging
import uuid
from typing import Optional

import redis.asyncio as aioredis

logger = logging.getLogger("app.chat")

# Idle sessions expire after this many seconds. The TTL is refreshed on every
# write, so an active conversation never expires mid-use; 3 hours comfortably
# covers a working session without lingering forever.
SESSION_TTL_SECONDS = 3 * 60 * 60

# How many of the most recent messages to feed the LLM as context (sliding
# window). Older turns are folded into a running summary (see below) to respect
# the model's context limit and keep token cost predictable.
MAX_MESSAGES_IN_WINDOW = 10

# Once the stored message list grows past this, the oldest messages (everything
# beyond the recent window) are folded into a short rolling summary. Set well
# above the window so summarisation stays RARE — it is an extra (cheap) LLM call,
# and most conversations in this app never reach it.
_SUMMARY_TRIGGER_MESSAGES = 20

# Hard fallback cap on messages retained in Redis per session. Only reached if
# summarisation keeps failing (e.g. provider rate-limited) — bounds memory by
# dropping the oldest messages so the session can never grow without limit.
_MAX_STORED_MESSAGES = 40

# Label prepended to the rolling summary when it is injected into the prompt.
_SUMMARY_PREFIX = "Earlier conversation summary: "

# Defensive per-message cap so a hostile/oversized payload cannot bloat Redis.
_MAX_CONTENT_CHARS = 4000


def generate_session_id() -> str:
    """Create a new, unguessable session identifier."""
    return str(uuid.uuid4())


def _key(user_id: str, session_id: str) -> str:
    # user_id ALWAYS comes from the JWT — see the module docstring.
    return f"chat_session:{user_id}:{session_id}"


def history_window(history: list[dict]) -> list[dict]:
    """Return the last MAX_MESSAGES_IN_WINDOW messages — the slice fed to the LLM."""
    return history[-MAX_MESSAGES_IN_WINDOW:]


async def _load(
    redis: aioredis.Redis, user_id: str, session_id: str
) -> tuple[Optional[str], list[dict]]:
    """
    Load (summary, messages) for a session. Never raises.

    Accepts both the structured format ``{"summary", "messages"}`` and the legacy
    bare-list format (older sessions), degrading to ``(None, [])`` on any error.
    """
    if not session_id:
        return None, []
    try:
        raw = await redis.get(_key(user_id, session_id))
    except Exception:
        logger.exception("[session] redis GET failed user=%s", user_id)
        return None, []
    if not raw:
        return None, []
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.warning("[session] corrupt history discarded user=%s", user_id)
        return None, []
    if isinstance(data, list):  # legacy format: just a message list
        return None, data
    if isinstance(data, dict):
        summary = data.get("summary")
        messages = data.get("messages")
        return (
            summary if isinstance(summary, str) else None,
            messages if isinstance(messages, list) else [],
        )
    return None, []


async def _store(
    redis: aioredis.Redis,
    user_id: str,
    session_id: str,
    summary: Optional[str],
    messages: list[dict],
) -> None:
    """Persist (summary, messages) and refresh the TTL. Never raises."""
    blob = json.dumps({"summary": summary, "messages": messages})
    try:
        await redis.setex(_key(user_id, session_id), SESSION_TTL_SECONDS, blob)
    except Exception:
        logger.exception("[session] redis SETEX failed user=%s", user_id)


async def get_session_history(
    redis: aioredis.Redis, user_id: str, session_id: str
) -> list[dict]:
    """
    Return the stored messages for a session (oldest → newest), or [].

    Does NOT include the rolling summary — use get_managed_history() to build the
    list fed to the LLM. Never raises.
    """
    _, messages = await _load(redis, user_id, session_id)
    return messages


async def get_managed_history(
    redis: aioredis.Redis, user_id: str, session_id: str
) -> list[dict]:
    """
    Build the context fed to the LLM: the rolling summary (if any) as a leading
    system message, followed by the most recent MAX_MESSAGES_IN_WINDOW messages.

    This is a pure read — it never calls the LLM. Summarisation happens lazily on
    the save path (save_exchange), so reads stay fast and add no token cost.
    """
    summary, messages = await _load(redis, user_id, session_id)
    window = messages[-MAX_MESSAGES_IN_WINDOW:]
    if summary:
        return [{"role": "system", "content": _SUMMARY_PREFIX + summary}] + window
    return window


async def save_exchange(
    redis: aioredis.Redis,
    user_id: str,
    session_id: str,
    user_message: str,
    assistant_message: str,
) -> None:
    """
    Append one user→assistant exchange, fold old turns into the rolling summary
    when the conversation gets long, and (re)set the TTL.

    Runs on the SAVE path (after the reply has been sent), so the occasional
    summarisation call never delays what the user sees. The TTL is refreshed on
    every write so an active conversation never expires while in use. Never
    raises — a persistence failure must not break the user's reply.
    """
    if not session_id:
        return
    user_message = (user_message or "").strip()
    assistant_message = (assistant_message or "").strip()
    if not user_message or not assistant_message:
        return

    summary, messages = await _load(redis, user_id, session_id)
    messages.append({"role": "user", "content": user_message[:_MAX_CONTENT_CHARS]})
    messages.append({"role": "assistant", "content": assistant_message[:_MAX_CONTENT_CHARS]})

    # ── Rolling summary: fold the oldest turns once the history gets long ──────
    if len(messages) > _SUMMARY_TRIGGER_MESSAGES:
        to_fold = messages[:-MAX_MESSAGES_IN_WINDOW]
        recent = messages[-MAX_MESSAGES_IN_WINDOW:]
        # Local import keeps session_service free of any LLM import at load time.
        from app.ai.history_summarizer import summarize_history

        new_summary = await summarize_history(summary, to_fold)
        if new_summary:
            summary = new_summary
            messages = recent
        else:
            # Summarisation failed (e.g. rate-limited) — keep the messages rather
            # than lose them, but stay bounded by the hard cap.
            messages = messages[-_MAX_STORED_MESSAGES:]

    await _store(redis, user_id, session_id, summary, messages)


async def clear_session(redis: aioredis.Redis, user_id: str, session_id: str) -> None:
    """Delete a session's history (used when the user clears the chat)."""
    if not session_id:
        return
    try:
        await redis.delete(_key(user_id, session_id))
    except Exception:
        logger.exception("[session] redis DELETE failed user=%s", user_id)
