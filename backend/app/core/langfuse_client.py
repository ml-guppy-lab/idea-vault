"""
Langfuse — LLM observability (traces + user feedback).

Inert unless BOTH ``LANGFUSE_PUBLIC_KEY`` and ``LANGFUSE_SECRET_KEY`` are set,
so local dev and tests send nothing. Both keys live server-side; nothing
Langfuse-related is exposed to the browser (feedback scores are written from
the backend on the user's behalf).

Langfuse and Sentry are complementary, not competing:
  - **Sentry** tracks *application errors* (crashes, 5xx) across the whole app.
  - **Langfuse** tracks *LLM quality & cost* — prompt, response, model, provider,
    tokens, latency — plus user feedback (thumbs up/down) on generated answers.

Tracing is switched on by swapping the OpenAI client for Langfuse's drop-in
inside ``llm_client.py``; this module owns the credential wiring, the client
singleton (for feedback scores), and the trace-id / feedback helpers.
"""

import logging
import os

from app.core.config import settings

logger = logging.getLogger("app")

# Enabled only when BOTH keys are present. The public key is not a browser
# secret here — both keys stay in the backend environment.
LANGFUSE_ENABLED: bool = bool(
    settings.LANGFUSE_PUBLIC_KEY and settings.LANGFUSE_SECRET_KEY
)

_client = None

if LANGFUSE_ENABLED:
    # The langfuse.openai drop-in reads credentials from the environment, so
    # mirror settings into os.environ before anything constructs a client.
    os.environ.setdefault("LANGFUSE_PUBLIC_KEY", settings.LANGFUSE_PUBLIC_KEY)
    os.environ.setdefault("LANGFUSE_SECRET_KEY", settings.LANGFUSE_SECRET_KEY)
    os.environ.setdefault("LANGFUSE_HOST", settings.LANGFUSE_HOST)
    try:
        from langfuse import Langfuse

        _client = Langfuse(
            public_key=settings.LANGFUSE_PUBLIC_KEY,
            secret_key=settings.LANGFUSE_SECRET_KEY,
            host=settings.LANGFUSE_HOST,
            environment=settings.SENTRY_ENVIRONMENT or "development",
        )
        logger.info("Langfuse tracing enabled (host=%s)", settings.LANGFUSE_HOST)
    except Exception:
        logger.exception("Langfuse init failed; disabling LLM tracing")
        LANGFUSE_ENABLED = False
        _client = None


def get_langfuse():
    """Return the Langfuse client, or None when disabled."""
    return _client


def new_trace_id() -> str | None:
    """Generate a fresh Langfuse trace id for one chat turn, or None when disabled.

    The id is passed to every LLM generation in the turn (so they group under a
    single trace) and surfaced to the frontend so a thumbs-up/down can be scored
    against it later via ``record_feedback``.
    """
    if _client is None:
        return None
    try:
        return _client.create_trace_id()
    except Exception:
        logger.exception("Langfuse create_trace_id failed")
        return None


def record_feedback(trace_id: str, value: int, comment: str | None = None) -> bool:
    """Attach a user-feedback score (1 = thumbs up, 0 = thumbs down) to a trace.

    Best-effort: returns True if recorded, False if Langfuse is disabled or the
    write failed. Never raises — feedback must never break the request.
    """
    if _client is None:
        return False
    try:
        _client.create_score(
            name="user-feedback",
            value=value,
            trace_id=trace_id,
            data_type="NUMERIC",
            comment=comment,
        )
        return True
    except Exception:
        logger.exception("Langfuse feedback score failed for trace=%s", trace_id)
        return False
