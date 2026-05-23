"""
Intent classifier — stateless, query-only.

Classifies a raw query string into one of four intents so the chat pipeline
can route it to the right handler (vector search, LLM-only, DB count, etc.).

Security notes:
  - user_id is intentionally NEVER accepted here; isolation is the retrieval
    layer's responsibility, not the classifier's.
  - User input is stripped and hard-truncated before it reaches the LLM to
    prevent prompt injection via oversized inputs.
  - The LLM response is validated against the enum; anything unrecognised
    falls back to SEMANTIC_SEARCH (never exposes raw model output to callers).
"""

import re
from enum import Enum

from openai import AsyncOpenAI

from app.core.llm_config import LLMProvider, llm_config

# Hard cap on characters sent to the classifier.
# Classification only needs the gist of the query — 200 chars is more than enough.
# This also limits the blast radius of any prompt-injection attempt.
_MAX_QUERY_CHARS = 200

_INTENT_SYSTEM_PROMPT = """You are an intent classifier. Classify the user's query into exactly one of these intents:
- CONVERSATIONAL: greetings, thanks, small talk, general questions not about ideas
- LISTING: wants to see or list ideas without specifying a topic
- SEMANTIC_SEARCH: wants ideas about a specific topic or concept
- COUNT: wants to know how many ideas exist

Respond with ONLY the intent label. No explanation. No punctuation. Just the label."""


class QueryIntent(str, Enum):
    CONVERSATIONAL = "CONVERSATIONAL"
    LISTING = "LISTING"
    SEMANTIC_SEARCH = "SEMANTIC_SEARCH"
    COUNT = "COUNT"


async def classify_intent(query: str) -> QueryIntent:
    """
    Classify *query* into a QueryIntent using the configured fast/small model.

    Parameters
    ----------
    query:
        Raw user message. Will be stripped and truncated internally — callers
        do NOT need to sanitise it first.

    Returns
    -------
    QueryIntent
        One of CONVERSATIONAL | LISTING | SEMANTIC_SEARCH | COUNT.
        Defaults to SEMANTIC_SEARCH if the model returns an unrecognised label.
    """
    safe_query = query.strip()[:_MAX_QUERY_CHARS]

    client = AsyncOpenAI(
        base_url=llm_config.base_url,
        api_key=llm_config.api_key,
        default_headers=llm_config.extra_headers,
    )

    # Ollama's OpenAI-compat layer counts thinking tokens against max_tokens.
    # For qwen3 and other thinking models, the entire budget is consumed by
    # <think> blocks, leaving nothing for the actual label.
    # Fix: omit max_tokens for Ollama (no limit = think freely then respond).
    # Non-Ollama providers (OpenRouter, OpenAI) don't have thinking mode, so
    # max_tokens=10 is safe and keeps classification fast and cheap.
    max_tokens: int | None = None if llm_config.provider == LLMProvider.ollama else 10

    response = await client.chat.completions.create(
        model=llm_config.classifier_model,
        messages=[
            {"role": "system", "content": _INTENT_SYSTEM_PROMPT},
            {"role": "user", "content": safe_query},
        ],
        max_tokens=max_tokens,
        temperature=0,  # deterministic — classification is not creative
        stream=False,
    )

    raw = (response.choices[0].message.content or "")

    # Strip any residual <think>...</think> blocks (defense-in-depth).
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)

    # Search for the first valid label anywhere in the response (handles models
    # that wrap the label in punctuation or add brief commentary).
    valid_labels = "|".join(intent.value for intent in QueryIntent)
    match = re.search(rf"\b({valid_labels})\b", raw.upper())
    if match:
        return QueryIntent(match.group(1))

    # SEMANTIC_SEARCH is the safest fallback: it will at least attempt retrieval.
    return QueryIntent.SEMANTIC_SEARCH