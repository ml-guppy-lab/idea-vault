"""
Cross-provider LLM failover.

Every configured cloud provider (Cerebras, Groq, OpenRouter) exposes an
OpenAI-compatible ``/v1`` API, so the same ``AsyncOpenAI`` client works for each
— only ``base_url`` + ``api_key`` + ``model`` differ. This module builds an
ordered failover CHAIN of endpoints per model tier and walks it until one
succeeds, so a 429 / 5xx on one free provider transparently spills over to the
next.

Ordering (Cerebras → Groq → OpenRouter) puts the fastest, most generous free
tiers first and keeps OpenRouter as the broad backstop. Because each provider is
a separate account, their rate limits are independent buckets — so total free
capacity stacks instead of sharing one ceiling.

Design notes
------------
- **Fail fast, don't sleep.** With multiple independent providers, immediately
  trying the next endpoint on a 429 beats backing off on a single one — another
  provider almost certainly has capacity right now.
- **Streaming fails over at connect time only.** 429s surface when the stream is
  created (before the first token), which is exactly where we can safely switch
  providers. A mid-stream drop is not retried.
- **Empty ``choices`` counts as a failure** and advances to the next provider
  (some free endpoints occasionally return a null/empty payload under load).
- **Local dev (LLM_PROVIDER=ollama)** bypasses the chain entirely and uses the
  single local Ollama endpoint, preserving its ``think=False`` behaviour.
- Provider-specific quirks (e.g. Ollama's ``extra_body={"think": False}``) live
  on the endpoint, so cloud providers never receive params they'd reject.
"""

import logging
from dataclasses import dataclass, field
from typing import Any

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AsyncOpenAI,
    RateLimitError,
)

from app.core.config import settings
from app.core.llm_config import LLMProvider, ModelTier, llm_config

logger = logging.getLogger(__name__)

# Errors that should trigger failover to the next endpoint in the chain.
# Anything else (e.g. a 400 from a malformed request) is a real bug and is
# allowed to propagate rather than being silently masked by the next provider.
_FAILOVER_ERRORS = (
    RateLimitError,      # 429 — provider/account/model rate limit
    APITimeoutError,     # request timed out
    APIConnectionError,  # network/DNS/connection reset
    APIStatusError,      # 5xx and other upstream HTTP errors
)


@dataclass(frozen=True)
class LLMEndpoint:
    """A single OpenAI-compatible endpoint in a failover chain."""

    provider: str
    base_url: str
    api_key: str
    model: str
    extra_headers: dict[str, str] = field(default_factory=dict)
    extra_body: dict[str, Any] | None = None


def _openrouter_headers() -> dict[str, str]:
    # OpenRouter uses these for attribution / rate-limit tracking.
    return {
        "HTTP-Referer": settings.FRONTEND_URL,
        "X-Title": settings.APP_NAME,
    }


def _cloud_chain(tier: ModelTier) -> list[LLMEndpoint]:
    """Ordered failover chain across the free cloud providers.

    Only providers whose API key is configured are included, so the chain
    degrades gracefully (set one key or all three).
    """
    standard = tier is ModelTier.STANDARD
    endpoints: list[LLMEndpoint] = []

    if settings.CEREBRAS_API_KEY:
        endpoints.append(
            LLMEndpoint(
                provider="cerebras",
                base_url="https://api.cerebras.ai/v1",
                api_key=settings.CEREBRAS_API_KEY,
                model=(
                    settings.LLM_CEREBRAS_MODEL_STANDARD
                    if standard
                    else settings.LLM_CEREBRAS_MODEL_FAST
                ),
            )
        )
    if settings.GROQ_API_KEY:
        endpoints.append(
            LLMEndpoint(
                provider="groq",
                base_url="https://api.groq.com/openai/v1",
                api_key=settings.GROQ_API_KEY,
                model=(
                    settings.LLM_GROQ_MODEL_STANDARD
                    if standard
                    else settings.LLM_GROQ_MODEL_FAST
                ),
            )
        )
    if settings.OPENROUTER_API_KEY:
        endpoints.append(
            LLMEndpoint(
                provider="openrouter",
                base_url="https://openrouter.ai/api/v1",
                api_key=settings.OPENROUTER_API_KEY,
                model=llm_config.model_for_tier(tier),  # existing OpenRouter tier map
                extra_headers=_openrouter_headers(),
            )
        )
    return endpoints


def _configured_endpoint(tier: ModelTier) -> LLMEndpoint:
    """Single endpoint for the provider named by LLM_PROVIDER (no failover).

    Used for local Ollama and the future openai/anthropic providers.
    """
    extra_body = {"think": False} if llm_config.provider is LLMProvider.ollama else None
    return LLMEndpoint(
        provider=llm_config.provider.value,
        base_url=llm_config.base_url,
        api_key=llm_config.api_key,
        model=llm_config.model_for_tier(tier),
        extra_headers=llm_config.extra_headers,
        extra_body=extra_body,
    )


def _resolve_chain(tier: ModelTier) -> list[LLMEndpoint]:
    """Return the ordered endpoint chain to try for this tier."""
    provider = llm_config.provider

    if provider is LLMProvider.ollama:
        # Local dev — single endpoint, preserve think=False.
        return [_configured_endpoint(tier)]

    if provider is LLMProvider.openrouter:
        # Deployed free-tier setup — multi-provider failover.
        chain = _cloud_chain(tier)
        if chain:
            return chain

    # openai / anthropic (future), or openrouter with no keys — single endpoint.
    return [_configured_endpoint(tier)]


def _client_for(endpoint: LLMEndpoint) -> AsyncOpenAI:
    return AsyncOpenAI(
        base_url=endpoint.base_url,
        api_key=endpoint.api_key,
        default_headers=endpoint.extra_headers or None,
    )


def _merge_extra_body(kwargs: dict[str, Any], endpoint: LLMEndpoint) -> dict[str, Any]:
    """Layer the endpoint's provider-specific extra_body onto the call kwargs."""
    if not endpoint.extra_body:
        return kwargs
    merged = dict(kwargs)
    body = dict(merged.get("extra_body") or {})
    body.update(endpoint.extra_body)
    merged["extra_body"] = body
    return merged


async def create_chat_completion(
    messages: list[dict[str, Any]],
    *,
    tier: ModelTier,
    **kwargs: Any,
) -> Any:
    """Non-streaming completion with cross-provider failover.

    Walks the tier chain; on a failover error or an empty ``choices`` payload,
    advances to the next provider. Extra kwargs (``tools``, ``tool_choice``,
    ``max_tokens``, ``temperature``, …) are forwarded unchanged. Raises the last
    error only when every endpoint is exhausted.
    """
    chain = _resolve_chain(tier)
    last_exc: Exception | None = None

    for endpoint in chain:
        client = _client_for(endpoint)
        call_kwargs = _merge_extra_body(kwargs, endpoint)
        try:
            response = await client.chat.completions.create(
                model=endpoint.model,
                messages=messages,
                **call_kwargs,
            )
            if not getattr(response, "choices", None):
                logger.warning(
                    "[llm] %s/%s returned no choices — trying next provider",
                    endpoint.provider,
                    endpoint.model,
                )
                continue
            logger.info("[llm] served by %s/%s", endpoint.provider, endpoint.model)
            return response
        except _FAILOVER_ERRORS as exc:
            last_exc = exc
            logger.warning(
                "[llm] %s/%s failed (%s) — trying next provider",
                endpoint.provider,
                endpoint.model,
                type(exc).__name__,
            )
            continue

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("No LLM endpoints available (check provider API keys).")


async def create_chat_stream(
    messages: list[dict[str, Any]],
    *,
    tier: ModelTier,
    **kwargs: Any,
) -> Any:
    """Streaming completion with connect-time cross-provider failover.

    Returns an OpenAI streaming iterator from the first endpoint that accepts
    the request. Failover happens only at stream-creation time (where 429s
    occur); a mid-stream drop is not retried. Raises the last error when every
    endpoint is exhausted.
    """
    chain = _resolve_chain(tier)
    last_exc: Exception | None = None

    for endpoint in chain:
        client = _client_for(endpoint)
        call_kwargs = _merge_extra_body(kwargs, endpoint)
        try:
            stream = await client.chat.completions.create(
                model=endpoint.model,
                messages=messages,
                stream=True,
                **call_kwargs,
            )
            logger.info(
                "[llm] stream served by %s/%s", endpoint.provider, endpoint.model
            )
            return stream
        except _FAILOVER_ERRORS as exc:
            last_exc = exc
            logger.warning(
                "[llm] stream %s/%s failed (%s) — trying next provider",
                endpoint.provider,
                endpoint.model,
                type(exc).__name__,
            )
            continue

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("No LLM endpoints available (check provider API keys).")
