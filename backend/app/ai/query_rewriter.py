"""
Query rewriting for multi-turn RAG.

The problem this solves:
    Semantic search embeds the user's message into a vector and finds ideas with
    similar vectors. A follow-up like "which of these relate to weight loss?" has
    almost no topical content on its own — embedding it produces a meaningless
    vector and retrieval returns nothing useful.

The fix:
    Before retrieval, use the conversation history to rewrite the follow-up into
    a *standalone* query that carries the real topic, e.g.
        "which of these relate to weight loss?"
            → "health and fitness ideas about weight loss and diet"
    The rewritten query is used ONLY for retrieval (embedding + search). The
    original message is still what the answer model sees, so the reply stays
    natural and conversational.

This module is stateless and never touches user data directly (same contract as
the intent classifier): it only sees prior messages already produced for this
user. It uses the fast `classifier_model` to keep the extra call cheap, and
falls back to the original message on any failure — a slightly worse query is
always better than a broken request.
"""

import logging
import re

from openai import AsyncOpenAI, RateLimitError

from app.core.llm_config import LLMProvider, llm_config

logger = logging.getLogger("app.chat")

_MAX_QUERY_CHARS = 200
# Only the most recent turns are needed to resolve references; keeps tokens low.
_MAX_HISTORY_MESSAGES = 6

# Referential words that signal the message LEANS ON earlier context ("which of
# these", "the second one", "expand on it"). Only such messages need rewriting;
# a self-contained question ("do I have any fitness ideas?") is already a good
# search query, so matching here is what lets us skip a wasted LLM call. The
# pattern is deliberately inclusive: a false positive costs one cheap call, a
# false negative costs a broken search.
_CONTEXT_WORDS_RE = re.compile(
    r"""\b(
        these | those | them | they | their |
        it | its | this | that |
        which\s+(?:of|one|ones) |
        the\s+(?:first|second|third|fourth|last|next|other|same|one|ones|former|latter) |
        above | previous | earlier | aforementioned
    )\b""",
    re.IGNORECASE | re.VERBOSE,
)


def _is_context_dependent(message: str) -> bool:
    """True when the message references earlier turns and so needs rewriting."""
    return bool(_CONTEXT_WORDS_RE.search(message))

_REWRITE_SYSTEM_PROMPT = """You rewrite the user's latest message into a single standalone search query for their personal idea database.

Use the conversation so far to resolve references like "these", "it", "that one", or "the second idea" into the explicit topic they refer to.

Rules:
- Output ONLY the rewritten query — no preamble, no quotes, no explanation.
- Keep it short (a few keywords or one sentence) and focused on the TOPIC to search for.
- If the latest message is already self-contained, return it unchanged.
- Never invent topics that were not mentioned in the conversation."""


async def rewrite_query(history: list[dict], message: str) -> str:
    """
    Rewrite *message* into a standalone search query using recent *history*.

    Returns the original message unchanged when there is no history, when the
    message is already self-contained (no referential words — a free regex check
    that avoids a wasted LLM call), or on any error — so retrieval always has
    something usable.
    """
    if not history:
        return message

    # Cheap gate: skip the LLM rewrite when the message does not lean on prior
    # context. "do I have any fitness ideas?" is already a good query; only
    # follow-ups like "which of these relate to weight loss?" are rewritten.
    if not _is_context_dependent(message):
        return message

    recent = [
        m
        for m in history
        if m.get("role") in ("user", "assistant") and m.get("content")
    ][-_MAX_HISTORY_MESSAGES:]
    if not recent:
        return message

    convo = "\n".join(f"{m['role']}: {m['content']}" for m in recent)
    user_block = (
        f"Conversation so far:\n{convo}\n\n"
        f"Latest message: {message.strip()[:_MAX_QUERY_CHARS]}\n\n"
        "Standalone search query:"
    )

    client = AsyncOpenAI(
        base_url=llm_config.base_url,
        api_key=llm_config.api_key,
        default_headers=llm_config.extra_headers,
    )

    kwargs: dict = {
        "model": llm_config.classifier_model,
        "messages": [
            {"role": "system", "content": _REWRITE_SYSTEM_PROMPT},
            {"role": "user", "content": user_block},
        ],
        # None for Ollama (let think=False short-circuit), small cap elsewhere.
        "max_tokens": None if llm_config.provider == LLMProvider.ollama else 60,
        "temperature": 0,
        "stream": False,
    }
    if llm_config.provider == LLMProvider.ollama:
        kwargs["extra_body"] = {"think": False}

    try:
        response = await client.chat.completions.create(**kwargs)
    except RateLimitError:
        logger.warning("[rewrite] classifier rate-limited; using original message")
        return message
    except Exception:
        logger.exception("[rewrite] failed; using original message")
        return message

    choices = getattr(response, "choices", None)
    if not choices:
        return message

    raw = (choices[0].message.content or "").strip()
    # Strip any stray <think>…</think> block (Ollama reasoning models).
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()
    # Models sometimes wrap the query in quotes — remove them.
    raw = raw.strip("\"'").strip()
    if not raw:
        return message
    return raw[:_MAX_QUERY_CHARS]
