"""
LLM provider abstraction layer.

Switch providers by setting LLM_PROVIDER in .env — no code changes required.

    LLM_PROVIDER=ollama       → local Ollama (dev/testing)
    LLM_PROVIDER=openrouter   → OpenRouter free/paid tier (deployed)
    LLM_PROVIDER=openai       → OpenAI direct (future)
    LLM_PROVIDER=anthropic    → Anthropic direct (future)

All providers expose an OpenAI-compatible /v1 REST interface, so the same
AsyncOpenAI client works everywhere — only base_url + api_key + model change.
"""

from enum import Enum

from app.core.config import settings


class LLMProvider(str, Enum):
    ollama = "ollama"
    openrouter = "openrouter"
    openai = "openai"        # ready for future use
    anthropic = "anthropic"  # ready for future use


class ModelTier(str, Enum):
    """Controls which model size is used for generation.

    FAST     — trivial responses (greetings, listing, counts).
               Small model: low latency, low cost.
    STANDARD — semantic reasoning over idea content.
               Larger model: better comprehension and synthesis.

    The intent classifier ALWAYS uses the classifier_model (never this tier map)
    because classification is a separate, always-cheap task.
    """
    FAST     = "fast"
    STANDARD = "standard"


class LLMConfig:
    """
    Resolves provider-specific connection details from environment settings.

    Usage
    -----
    from app.core.llm_config import llm_config

    client = AsyncOpenAI(
        base_url=llm_config.base_url,
        api_key=llm_config.api_key,
        default_headers=llm_config.extra_headers,
    )
    response = await client.chat.completions.create(
        model=llm_config.model,
        messages=[...],
    )
    """

    def __init__(self) -> None:
        try:
            self.provider = LLMProvider(settings.LLM_PROVIDER.lower())
        except ValueError:
            valid = [p.value for p in LLMProvider]
            raise ValueError(
                f"Invalid LLM_PROVIDER '{settings.LLM_PROVIDER}'. "
                f"Must be one of: {valid}"
            )

    @property
    def base_url(self) -> str:
        """Base URL for the OpenAI-compatible /v1 REST API."""
        return {
            LLMProvider.ollama: settings.LLM_OLLAMA_BASE_URL,
            LLMProvider.openrouter: "https://openrouter.ai/api/v1",
            LLMProvider.openai: "https://api.openai.com/v1",
            LLMProvider.anthropic: "https://api.anthropic.com/v1",
        }[self.provider]

    @property
    def model(self) -> str:
        """Primary model identifier as expected by the provider."""
        return {
            LLMProvider.ollama: settings.LLM_OLLAMA_MODEL,
            LLMProvider.openrouter: settings.LLM_OPENROUTER_MODEL,
            LLMProvider.openai: settings.LLM_OPENAI_MODEL,
            LLMProvider.anthropic: settings.LLM_ANTHROPIC_MODEL,
        }[self.provider]

    @property
    def classifier_model(self) -> str:
        """
        Small/fast model used only for intent classification.
        Kept separate from the main model so classification stays cheap and
        low-latency regardless of which heavy model is configured for generation.
        """
        return {
            LLMProvider.ollama: settings.LLM_CLASSIFIER_MODEL_OLLAMA,
            LLMProvider.openrouter: settings.LLM_CLASSIFIER_MODEL_OPENROUTER,
            LLMProvider.openai: settings.LLM_CLASSIFIER_MODEL_OLLAMA,      # reuse field as sane default
            LLMProvider.anthropic: settings.LLM_CLASSIFIER_MODEL_OLLAMA,   # reuse field as sane default
        }[self.provider]

    def model_for_tier(self, tier: ModelTier) -> str:
        """
        Return the model string for the given tier and active provider.

        Falls back to the configured primary model for providers not in the
        tier map (openai, anthropic) so they degrade gracefully.
        """
        provider_map = _MODEL_TIER_MAP.get(self.provider)
        if provider_map is None:
            # Provider not in tier map — use the primary model for everything.
            return self.model
        return provider_map[tier]

    @property
    def fallback_model(self) -> str | None:
        """
        Fallback model used when the primary is rate-limited (429).
        Only defined for OpenRouter — other providers handle fallback differently.
        None means no fallback is configured for this provider.
        """
        if self.provider == LLMProvider.openrouter:
            return settings.LLM_OPENROUTER_FALLBACK_MODEL
        return None

    @property
    def api_key(self) -> str:
        """
        API key for the provider.
        Ollama accepts any non-empty string — "ollama" is conventional.
        Never log or expose this value.
        """
        return {
            LLMProvider.ollama: "ollama",
            LLMProvider.openrouter: settings.OPENROUTER_API_KEY,
            LLMProvider.openai: settings.OPENAI_API_KEY,
            LLMProvider.anthropic: settings.ANTHROPIC_API_KEY,
        }[self.provider]

    @property
    def extra_headers(self) -> dict[str, str]:
        """
        Provider-specific headers injected into every request.
        OpenRouter requires HTTP-Referer and X-Title for rate-limit tracking.
        """
        if self.provider == LLMProvider.openrouter:
            return {
                "HTTP-Referer": settings.FRONTEND_URL,
                "X-Title": settings.APP_NAME,
            }
        return {}

    def __repr__(self) -> str:
        return f"LLMConfig(provider={self.provider.value}, model={self.model})"


# Singleton — import this everywhere instead of constructing LLMConfig() directly.
# Constructed once at import time; invalid LLM_PROVIDER fails fast at startup.
llm_config = LLMConfig()


# ── Tier → model map ──────────────────────────────────────────────────────────
#
# Maps (provider, tier) → model string.
# FAST:     smallest model sufficient for the task (formatting, simple answers).
# STANDARD: larger model needed to reason over idea content.

_MODEL_TIER_MAP: dict[LLMProvider, dict[ModelTier, str]] = {
    LLMProvider.openrouter: {
        ModelTier.FAST:     "meta-llama/llama-3.2-3b-instruct:free",
        ModelTier.STANDARD: "mistralai/mistral-7b-instruct:free",
    },
    LLMProvider.ollama: {
        ModelTier.FAST:     "qwen3:4b",   # already pulled; thinking overhead is negligible for simple tasks
        ModelTier.STANDARD: "qwen3:14b",
    },
}


def select_tier_for_intent(intent: str) -> ModelTier:
    """
    Map a QueryIntent value to a ModelTier for generation.

    Accepts the intent as a plain string (matching QueryIntent.value) so this
    function has no import dependency on intent_classifier — avoiding a circular
    import (intent_classifier already imports llm_config).

    FAST     → CONVERSATIONAL, LISTING, COUNT  (no reasoning needed)
    STANDARD → SEMANTIC_SEARCH                 (must reason over idea content)
    """
    if intent in ("CONVERSATIONAL", "LISTING", "COUNT"):
        return ModelTier.FAST
    return ModelTier.STANDARD  # SEMANTIC_SEARCH — default for any unknown intent
