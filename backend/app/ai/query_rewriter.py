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

_REWRITE_SYSTEM_PROMPT = """You rewrite the user's latest message into a single standalone search query for their personal idea database.

Use the conversation so far to resolve anything that depends on it into an explicit query that names the topic or idea under discussion. This includes:
- pronouns and references ("these", "it", "that one", "the second idea")
- elliptical follow-ups that omit the subject ("what about crocodiles?", "and cats?", "how about productivity?")

Example: if the conversation is about the user's "Dog Categorizer App" idea and they ask "what about crocodiles?", rewrite it to something like "Does the Dog Categorizer App idea involve crocodiles?".

Rules:
- Output ONLY the rewritten query — no preamble, no quotes, no explanation.
- Keep it short (a few keywords or one sentence) and focused on the TOPIC to search for.
- Keep the query grounded in the user's saved ideas — never turn it into a general-knowledge question.
- If the latest message is already self-contained, return it unchanged.
- Never invent topics that were not mentioned in the conversation."""


async def rewrite_query(history: list[dict], message: str) -> str:
    """
    Rewrite *message* into a standalone search query using recent *history*.

    Whenever there is history we run the reformulation (the model returns the
    message unchanged if it is already self-contained). This is the standard
    history-aware-retriever pattern: a keyword pre-filter cannot reliably catch
    elliptical follow-ups like "what about crocodiles?", which carry no pronoun
    yet depend entirely on context.

    Returns the original message unchanged when there is no history, or on any
    error — so retrieval always has something usable.
    """
    if not history:
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
