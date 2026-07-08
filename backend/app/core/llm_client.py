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
    RateLimitError,
)
from openai import AsyncOpenAI as _OpenAIAsyncClient

from app.core.config import settings
from app.core.langfuse_client import LANGFUSE_ENABLED
from app.core.llm_config import LLMProvider, ModelTier, llm_config

# When Langfuse is enabled, every LLM call is traced automatically by swapping in
# Langfuse's OpenAI drop-in (identical constructor + API to the stock client).
# When disabled, the stock client is used and nothing is sent.
if LANGFUSE_ENABLED:
    from langfuse.openai import AsyncOpenAI as _AsyncClient  # traced drop-in
else:
    _AsyncClient = _OpenAIAsyncClient

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

    Ordering is tier-aware:
      - STANDARD (generation + agent): Cerebras → Groq → OpenRouter. Cerebras'
        gpt-oss-120b leads for its low-latency, tool-capable inference.
      - FAST (classify / rewrite / summarise): Groq → Cerebras → OpenRouter.
        Groq's llama-3.1-8b-instant is a small NON-reasoning model, so it emits
        its one-word answer instantly. The gpt-oss models are reasoning models
        that "think" before answering, so on this hot path they sit behind it as
        backups (and get reasoning_effort=low from the classifier when reached).
    """
    standard = tier is ModelTier.STANDARD

    cerebras = (
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
        if settings.CEREBRAS_API_KEY
        else None
    )
    groq = (
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
        if settings.GROQ_API_KEY
        else None
    )
    openrouter = (
        LLMEndpoint(
            provider="openrouter",
            base_url="https://openrouter.ai/api/v1",
            api_key=settings.OPENROUTER_API_KEY,
            model=llm_config.model_for_tier(tier),  # existing OpenRouter tier map
            extra_headers=_openrouter_headers(),
        )
        if settings.OPENROUTER_API_KEY
        else None
    )

    # FAST prefers Groq's non-reasoning llama first; STANDARD keeps Cerebras first.
    ordered = (
        [cerebras, groq, openrouter]
        if standard
        else [groq, cerebras, openrouter]
    )
    return [ep for ep in ordered if ep is not None]


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


def _client_for(endpoint: LLMEndpoint) -> Any:
    return _AsyncClient(
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


def _filter_unsupported_params(kwargs: dict[str, Any], endpoint: LLMEndpoint) -> dict[str, Any]:
    """Drop call params the target model would reject.

    ``reasoning_effort`` is only meaningful for gpt-oss reasoning models. A
    non-reasoning model such as Groq's llama-3.1-8b-instant would 400 on the
    unknown param, so it is stripped for any endpoint whose model isn't gpt-oss.
    This lets the classifier pass ``reasoning_effort="low"`` unconditionally: it
    applies to gpt-oss backups and is silently removed for the llama primary.
    """
    if "reasoning_effort" in kwargs and "gpt-oss" not in endpoint.model.lower():
        filtered = dict(kwargs)
        filtered.pop("reasoning_effort", None)
        return filtered
    return kwargs


def _langfuse_kwargs(
    endpoint: LLMEndpoint,
    tier: ModelTier,
    *,
    trace_id: str | None,
    session_id: str | None,
    user_id: str | None,
    generation_name: str | None,
) -> dict[str, Any]:
    """Extra kwargs the Langfuse drop-in strips before calling the provider.

    Added ONLY when Langfuse is enabled, so the stock client never receives them.
    We pass ONLY keys the drop-in recognises (``name``, ``metadata``, ``trace_id``)
    — session_id/user_id ride inside ``metadata`` because passing them as top-level
    kwargs would leak to the provider API and 400 the request.
    """
    if not LANGFUSE_ENABLED:
        return {}
    metadata: dict[str, Any] = {
        "provider": endpoint.provider,
        "tier": tier.value,
        "model": endpoint.model,
    }
    if session_id:
        metadata["session_id"] = session_id
    if user_id:
        metadata["user_id"] = user_id
    kw: dict[str, Any] = {
        "name": generation_name or f"llm-{tier.value}",
        "metadata": metadata,
    }
    if trace_id:
        kw["trace_id"] = trace_id
    return kw


async def create_chat_completion(
    messages: list[dict[str, Any]],
    *,
    tier: ModelTier,
    trace_id: str | None = None,
    session_id: str | None = None,
    user_id: str | None = None,
    generation_name: str | None = None,
    **kwargs: Any,
) -> Any:
    """Non-streaming completion with cross-provider failover.

    Walks the tier chain; on a failover error or an empty ``choices`` payload,
    advances to the next provider. Extra kwargs (``tools``, ``tool_choice``,
    ``max_tokens``, ``temperature``, …) are forwarded unchanged. The optional
    ``trace_id``/``session_id``/``user_id``/``generation_name`` are used only for
    Langfuse tracing and never reach the provider. Raises the last error only
    when every endpoint is exhausted.
    """
    chain = _resolve_chain(tier)
    last_exc: Exception | None = None

    for endpoint in chain:
        client = _client_for(endpoint)
        call_kwargs = dict(_merge_extra_body(kwargs, endpoint))
        call_kwargs = _filter_unsupported_params(call_kwargs, endpoint)
        call_kwargs.update(
            _langfuse_kwargs(
                endpoint,
                tier,
                trace_id=trace_id,
                session_id=session_id,
                user_id=user_id,
                generation_name=generation_name,
            )
        )
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
    trace_id: str | None = None,
    session_id: str | None = None,
    user_id: str | None = None,
    generation_name: str | None = None,
    **kwargs: Any,
) -> Any:
    """Streaming completion with connect-time cross-provider failover.

    Returns an OpenAI streaming iterator from the first endpoint that accepts
    the request. Failover happens only at stream-creation time (where 429s
    occur); a mid-stream drop is not retried. The optional Langfuse fields are
    used only for tracing and never reach the provider. Raises the last error
    when every endpoint is exhausted.
    """
    chain = _resolve_chain(tier)
    last_exc: Exception | None = None

    for endpoint in chain:
        client = _client_for(endpoint)
        call_kwargs = dict(_merge_extra_body(kwargs, endpoint))
        call_kwargs = _filter_unsupported_params(call_kwargs, endpoint)
        call_kwargs.update(
            _langfuse_kwargs(
                endpoint,
                tier,
                trace_id=trace_id,
                session_id=session_id,
                user_id=user_id,
                generation_name=generation_name,
            )
        )
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
