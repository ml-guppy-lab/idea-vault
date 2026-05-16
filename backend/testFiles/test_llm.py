"""
Manual smoke-test for the LLM abstraction layer.

Usage (from backend/):
    python testFiles/test_llm.py

Switch providers by changing LLM_PROVIDER in .env before running:
    LLM_PROVIDER=ollama       → requires Ollama running (ollama serve)
    LLM_PROVIDER=openrouter   → requires OPENROUTER_API_KEY in .env
"""

import asyncio
import os
import sys

# Allow imports from backend/ root without installing the package
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from openai import AsyncOpenAI, RateLimitError

from app.core.llm_config import llm_config  # singleton — same object used in production


async def _call_with_retry(fn, *args, retries: int = 3, **kwargs):
    """Retry an async OpenAI call on 429 with exponential backoff + model fallback.

    Free-tier OpenRouter models (Gemma via Google AI Studio) are aggressively
    rate-limited upstream. On 429, we:
      1. Retry up to `retries` times with 2/4/8s backoff.
      2. If still failing and a fallback_model is configured, switch to it.
    Production code uses the same pattern so spikes don't crash the API.
    """
    last_exc: RateLimitError | None = None
    for attempt in range(1, retries + 1):
        try:
            return await fn(*args, **kwargs)
        except RateLimitError as e:
            last_exc = e
            if attempt == retries:
                break
            wait = 2 ** attempt  # 2s, 4s, 8s
            print(f"\n  [retry {attempt}/{retries}] rate-limited — waiting {wait}s...", flush=True)
            await asyncio.sleep(wait)

    # All retries exhausted — try fallback model if available
    fallback = llm_config.fallback_model
    if fallback and kwargs.get("model") != fallback:
        print(f"\n  [fallback] primary rate-limited, switching to {fallback}...", flush=True)
        kwargs["model"] = fallback
        return await fn(*args, **kwargs)

    raise last_exc  # type: ignore[misc]


async def test() -> None:
    print("=" * 50)
    print(f"Provider : {llm_config.provider.value}")
    print(f"Model    : {llm_config.model}")
    print(f"Base URL : {llm_config.base_url}")
    print("=" * 50)

    client = AsyncOpenAI(
        base_url=llm_config.base_url,
        api_key=llm_config.api_key,
        default_headers=llm_config.extra_headers,
    )

    # ── Test 1: Basic (non-streaming) response ────────────────────────────────
    # qwen3 (Ollama) puts thinking in message.reasoning, reply in message.content.
    # We read both so the test is valid regardless of how much thinking the model does.
    # In production, use streaming — non-streaming blocks until the full response is ready.
    print("\n[1] Basic response — calling LLM...")
    response = await _call_with_retry(
        client.chat.completions.create,
        model=llm_config.model,
        messages=[
            {"role": "user", "content": "Say exactly: Hello from Idea Vault!"},
        ],
        max_tokens=800,  # enough for thinking tokens + reply
    )
    msg = response.choices[0].message
    thinking = getattr(msg, "reasoning", None) or ""
    reply = msg.content or ""
    if thinking:
        print(f"    [thinking] {thinking[:80]}{'...' if len(thinking) > 80 else ''}")
    print(f"    [reply]    {reply}")
    assert (reply or thinking).strip(), "Empty response from LLM (both content and reasoning are empty)"

    # ── Test 2: Streaming response ────────────────────────────────────────────
    # Thinking tokens arrive in DIFFERENT fields depending on provider:
    #   Ollama  → delta.reasoning          (Ollama-specific extension)
    #   OpenRouter → delta.reasoning_content  (OpenRouter extension)
    # Actual reply always arrives in delta.content for both.
    # In production the frontend will render these as separate UI sections.
    print("\n[2] Streaming response (with thinking) —")
    stream = await _call_with_retry(
        client.chat.completions.create,
        model=llm_config.model,
        messages=[
            {"role": "user", "content": "Count from 1 to 5, one number per word."},
        ],
        stream=True,
        max_tokens=600,
    )
    thinking_text = ""
    reply_text = ""
    in_thinking = False

    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta

        # Thinking tokens (provider-specific field)
        thinking = getattr(delta, "reasoning", None) or getattr(delta, "reasoning_content", None)
        if thinking:
            if not in_thinking:
                print("\n  [thinking] ", end="", flush=True)
                in_thinking = True
            print(thinking, end="", flush=True)
            thinking_text += thinking

        # Actual reply
        if delta.content:
            if in_thinking:
                print("\n  [reply] ", end="", flush=True)
                in_thinking = False
            print(delta.content, end="", flush=True)
            reply_text += delta.content

    print()  # newline after stream
    assert reply_text.strip(), "No reply text received in streaming response"

    # ── Test 3: Provider field mapping audit ──────────────────────────────────
    # Documents where thinking tokens actually live per provider.
    # Run once with LLM_PROVIDER=ollama, once with LLM_PROVIDER=openrouter.
    # This output is the ground truth for the production streaming endpoint.
    #
    # Field map (confirmed):
    #   Provider     | thinking field          | reply field
    #   -------------|-------------------------|------------
    #   ollama       | delta.reasoning         | delta.content
    #   openrouter   | delta.reasoning_content | delta.content
    #
    # Gemma 4 31B on OpenRouter requires include_reasoning=True param (see below).
    # Without it, OpenRouter does NOT stream reasoning_content at all.
    print("\n[3] Provider field mapping audit —")
    from app.core.llm_config import LLMProvider  # noqa: PLC0415

    extra_params: dict = {}
    if llm_config.provider == LLMProvider.openrouter:
        # OpenRouter: opt-in to reasoning stream per request
        extra_params["extra_body"] = {"include_reasoning": True}

    stream2 = await _call_with_retry(
        client.chat.completions.create,
        model=llm_config.model,
        messages=[{"role": "user", "content": "What is 2+2? Think step by step."}],
        stream=True,
        max_tokens=400,
        **extra_params,
    )

    found_reasoning_field: str | None = None
    audit_reply = ""

    async for chunk in stream2:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta

        for field in ("reasoning", "reasoning_content"):
            val = getattr(delta, field, None)
            if val and not found_reasoning_field:
                found_reasoning_field = field
                print(f"  ✓ thinking field: delta.{field}", flush=True)

        if delta.content:
            audit_reply += delta.content

    print(f"  ✓ reply field:   delta.content  ('{audit_reply.strip()[:60]}')")

    if found_reasoning_field:
        print(f"  ✓ thinking confirmed on delta.{found_reasoning_field} for provider '{llm_config.provider.value}'")
    else:
        print(f"  ⚠ no thinking field detected — model may have thinking disabled or provider doesn't expose it")

    assert audit_reply.strip(), "No reply in field audit stream"

    print("\n" + "=" * 50)
    print("All tests passed!")
    print("=" * 50)


asyncio.run(test())
