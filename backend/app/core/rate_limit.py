"""
Shared per-user message rate limiter for the AI endpoints.

Both the legacy /api/chat endpoint and the unified /api/ai/chat endpoint use
this single limiter so a user's total AI usage is capped consistently and the
limit cannot be bypassed by switching endpoints (they share the same Redis key).
"""

import logging

from fastapi import HTTPException
import redis.asyncio as aioredis

logger = logging.getLogger("app.chat")

# Messages allowed per user per rolling window.
RATE_LIMIT_MAX = 20
# Window size in seconds (1 hour).
RATE_LIMIT_WINDOW = 3600


async def check_message_rate_limit(user_id: str, redis: aioredis.Redis) -> None:
    """
    Sliding-window rate limiter: max RATE_LIMIT_MAX messages per user per window.

    Key: "chat_rl:{user_id}"  (namespaced to avoid collisions with other keys)
    - INCR atomically creates-or-increments the counter.
    - EXPIRE is set only on the first message so the window resets naturally
      after RATE_LIMIT_WINDOW seconds without any background job.
    - Raises HTTP 429 before any LLM call so over-limit requests consume no
      tokens.

    `user_id` always comes from the verified JWT — never from the request body.
    """
    key = f"chat_rl:{user_id}"
    count = await redis.incr(key)
    if count == 1:
        # First message in this window — start the expiry clock.
        await redis.expire(key, RATE_LIMIT_WINDOW)
    if count > RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=429,
            detail=f"Chat limit reached. You can send {RATE_LIMIT_MAX} messages per hour.",
        )
