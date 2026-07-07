"""
Rolling conversation summary (context-window management).

When a conversation grows long, feeding every turn to the LLM wastes tokens and
eventually overflows the context window. Instead we keep a *sliding window* of
the most recent messages and fold everything older into a short running summary
("rolling summary memory", à la LangChain's ConversationSummaryBufferMemory).

This module owns ONLY the summarisation LLM call. It is invoked rarely — on the
SAVE path, after the user's reply has already streamed — so it never adds
latency to a response. It uses the fast `classifier_model` to keep the cost low,
and returns ``None`` on any failure so the caller can keep the un-summarised
messages rather than silently losing them.
"""

import logging
import re
from typing import Optional

import sentry_sdk
from openai import RateLimitError

from app.core.llm_client import create_chat_completion
from app.core.llm_config import LLMProvider, ModelTier, llm_config

logger = logging.getLogger("app.chat")

_MAX_SUMMARY_CHARS = 600  # keep the running summary compact (fits the prompt window)

_SUMMARY_SYSTEM_PROMPT = """You maintain a running summary of a conversation between a user and an assistant about the user's saved ideas in Idea Vault.

Given the summary so far (if any) and the next batch of messages, produce an updated summary in 2-3 short sentences. Focus on which ideas were discussed and what the user was looking for. Be concise and factual.

Output ONLY the summary text — no preamble, no quotes."""


async def summarize_history(
    previous_summary: Optional[str], messages: list[dict]
) -> Optional[str]:
    """
    Fold *messages* into *previous_summary* and return the updated summary.

    Returns ``None`` on empty input or any error — the caller treats that as
    "could not summarise" and keeps the original messages, so nothing is lost.
    """
    folded = [
        m
        for m in messages
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    if not folded:
        return None

    convo = "\n".join(f"{m['role']}: {m['content']}" for m in folded)
    blocks = []
    if previous_summary:
        blocks.append(f"Summary so far:\n{previous_summary}")
    blocks.append(f"New messages to fold in:\n{convo}")
    user_block = "\n\n".join(blocks) + "\n\nUpdated summary:"

    # FAST-tier chain (Cerebras → Groq → OpenRouter) with cross-provider failover.
    try:
        response = await create_chat_completion(
            [
                {"role": "system", "content": _SUMMARY_SYSTEM_PROMPT},
                {"role": "user", "content": user_block},
            ],
            tier=ModelTier.FAST,
            max_tokens=None if llm_config.provider == LLMProvider.ollama else 160,
            temperature=0,
        )
    except RateLimitError:
        logger.warning("[summary] classifier rate-limited; keeping messages unsummarised")
        return None
    except Exception:
        logger.exception("[summary] failed; keeping messages unsummarised")
        sentry_sdk.capture_exception()
        return None

    choices = getattr(response, "choices", None)
    if not choices:
        return None
    text = (choices[0].message.content or "").strip()
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()
    text = text.strip("\"'").strip()
    if not text:
        return None
    return text[:_MAX_SUMMARY_CHARS]
