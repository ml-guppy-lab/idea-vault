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
    when building the prompt, and cap what we retain in Redis (_MAX_STORED_MESSAGES)
    so even very long conversations stay bounded. (A rolling LLM summary of older
    turns could be layered on later if deeper recall is ever needed.)

Security:
    The Redis key is ALWAYS namespaced with the user_id taken from the verified
    JWT — never from the request body. A guessed/forged session_id therefore can
    never reach another user's history.
"""

import json
import logging
import uuid

import redis.asyncio as aioredis

logger = logging.getLogger("app.chat")

# Idle sessions expire after this many seconds. The TTL is refreshed on every
# write, so an active conversation never expires mid-use; 3 hours comfortably
# covers a working session without lingering forever.
SESSION_TTL_SECONDS = 3 * 60 * 60

# How many of the most recent messages to feed the LLM as context (sliding
# window). Older turns are dropped from the prompt to respect the model's
# context limit and keep token cost predictable.
MAX_MESSAGES_IN_WINDOW = 10

# Hard cap on messages retained in Redis per session. Bounds memory even for
# very long conversations — only the most recent are kept.
_MAX_STORED_MESSAGES = 40

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


async def get_session_history(
    redis: aioredis.Redis, user_id: str, session_id: str
) -> list[dict]:
    """
    Return the stored messages for a session (oldest → newest), or [].

    Never raises: any Redis/parse failure degrades to an empty history so the
    chat still works (just without prior context).
    """
    if not session_id:
        return []
    try:
        raw = await redis.get(_key(user_id, session_id))
    except Exception:
        logger.exception("[session] redis GET failed user=%s", user_id)
        return []
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.warning("[session] corrupt history discarded user=%s", user_id)
        return []
    return data if isinstance(data, list) else []


async def save_exchange(
    redis: aioredis.Redis,
    user_id: str,
    session_id: str,
    user_message: str,
    assistant_message: str,
) -> None:
    """
    Append one user→assistant exchange and (re)set the TTL.

    Stored oldest-first and trimmed to _MAX_STORED_MESSAGES. The TTL is refreshed
    on every write so an active conversation never expires while in use. Never
    raises — a persistence failure must not break the user's reply.
    """
    if not session_id:
        return
    user_message = (user_message or "").strip()
    assistant_message = (assistant_message or "").strip()
    if not user_message or not assistant_message:
        return

    history = await get_session_history(redis, user_id, session_id)
    history.append({"role": "user", "content": user_message[:_MAX_CONTENT_CHARS]})
    history.append({"role": "assistant", "content": assistant_message[:_MAX_CONTENT_CHARS]})
    history = history[-_MAX_STORED_MESSAGES:]

    try:
        await redis.setex(
            _key(user_id, session_id), SESSION_TTL_SECONDS, json.dumps(history)
        )
    except Exception:
        logger.exception("[session] redis SETEX failed user=%s", user_id)


async def clear_session(redis: aioredis.Redis, user_id: str, session_id: str) -> None:
    """Delete a session's history (used when the user clears the chat)."""
    if not session_id:
        return
    try:
        await redis.delete(_key(user_id, session_id))
    except Exception:
        logger.exception("[session] redis DELETE failed user=%s", user_id)
