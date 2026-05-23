# to test, from backend/ run:
#   python testFiles/test_intent_classifier.py
#   python testFiles/test_intent_classifier.py --provider openrouter
#   python testFiles/test_intent_classifier.py --provider ollama "how many ideas do I have?"

"""
Manual smoke-test for the intent classifier.

Usage (from backend/):
    python testFiles/test_intent_classifier.py [--provider ollama|openrouter] [QUERY...]

Examples:
    # Interactive mode — prompts you for queries one at a time
    python testFiles/test_intent_classifier.py

    # Test a single query using the .env provider
    python testFiles/test_intent_classifier.py "show me all my ideas"

    # Override provider without touching .env
    python testFiles/test_intent_classifier.py --provider openrouter "ideas about machine learning"
    python testFiles/test_intent_classifier.py --provider ollama "hey, how are you?"

Switch providers by setting LLM_PROVIDER in .env:
    LLM_PROVIDER=ollama       → requires Ollama running locally (ollama serve)
    LLM_PROVIDER=openrouter   → requires OPENROUTER_API_KEY in .env

The classifier model is separate from the main generation model:
    Ollama:      LLM_CLASSIFIER_MODEL_OLLAMA      (default: qwen3:4b)
    OpenRouter:  LLM_CLASSIFIER_MODEL_OPENROUTER  (default: meta-llama/llama-3.2-3b-instruct:free)
"""

import asyncio
import os
import sys

# Allow imports from backend/ root without installing the package
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.llm_config import llm_config
from app.services.intent_classifier import QueryIntent, classify_intent

# ── Built-in test queries covering all four intents ───────────────────────────
_DEFAULT_QUERIES: list[tuple[str, QueryIntent]] = [
    ("hey, what's up?",                         QueryIntent.CONVERSATIONAL),
    ("thanks for your help!",                   QueryIntent.CONVERSATIONAL),
    ("show me all my ideas",                    QueryIntent.LISTING),
    ("list my ideas",                           QueryIntent.LISTING),
    ("ideas about machine learning",            QueryIntent.SEMANTIC_SEARCH),
    ("what do I have on climate change?",       QueryIntent.SEMANTIC_SEARCH),
    ("find ideas related to product design",    QueryIntent.SEMANTIC_SEARCH),
    ("how many ideas do I have?",               QueryIntent.COUNT),
    ("what's the total count of my ideas?",     QueryIntent.COUNT),
]

_GREEN  = "\033[92m"
_RED    = "\033[91m"
_YELLOW = "\033[93m"
_CYAN   = "\033[96m"
_RESET  = "\033[0m"
_BOLD   = "\033[1m"


def _fmt_intent(intent: QueryIntent, expected: QueryIntent | None = None) -> str:
    if expected is None:
        return f"{_CYAN}{intent.value}{_RESET}"
    if intent == expected:
        return f"{_GREEN}{intent.value} ✓{_RESET}"
    return f"{_RED}{intent.value} ✗  (expected {expected.value}){_RESET}"


async def _run_batch(queries: list[tuple[str, QueryIntent | None]]) -> None:
    passed = 0
    failed = 0
    for query, expected in queries:
        print(f"  Query    : {query}")
        try:
            result = await classify_intent(query)
            label  = _fmt_intent(result, expected)
            print(f"  Intent   : {label}")
            if expected is not None:
                if result == expected:
                    passed += 1
                else:
                    failed += 1
        except Exception as exc:
            print(f"  {_RED}ERROR: {exc}{_RESET}")
            failed += 1
        print()

    if expected is not None:
        total = passed + failed
        colour = _GREEN if failed == 0 else _RED
        print(f"{colour}{_BOLD}Results: {passed}/{total} passed{_RESET}")


async def _run_interactive() -> None:
    print(f"{_YELLOW}Interactive mode — type a query and press Enter. Ctrl+C to quit.{_RESET}\n")
    while True:
        try:
            query = input("Query: ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nBye!")
            break
        if not query:
            continue
        try:
            result = await classify_intent(query)
            print(f"Intent   : {_fmt_intent(result)}\n")
        except Exception as exc:
            print(f"{_RED}ERROR: {exc}{_RESET}\n")


def _parse_args() -> tuple[str | None, list[str]]:
    """
    Returns (provider_override, remaining_query_args).
    provider_override is None if --provider is not supplied.
    """
    args = sys.argv[1:]
    provider: str | None = None
    queries: list[str] = []

    i = 0
    while i < len(args):
        if args[i] == "--provider":
            if i + 1 >= len(args):
                print("Error: --provider requires a value (ollama|openrouter)")
                sys.exit(1)
            provider = args[i + 1]
            i += 2
        else:
            queries.append(args[i])
            i += 1

    return provider, queries


async def main() -> None:
    provider_override, cli_queries = _parse_args()

    # Temporarily override LLM_PROVIDER for this test run without touching .env
    if provider_override:
        os.environ["LLM_PROVIDER"] = provider_override
        # Re-import to pick up the env change (llm_config is a module-level singleton,
        # so we reconstruct it here for the test only).
        from app.core.llm_config import LLMConfig
        import app.core.llm_config as _lc
        _lc.llm_config.__class__ = LLMConfig
        new_cfg = LLMConfig()
        _lc.llm_config.__dict__.update(new_cfg.__dict__)
        # Also patch the copy imported into intent_classifier
        import app.services.intent_classifier as _ic
        import importlib
        importlib.reload(_ic)
        from app.services.intent_classifier import classify_intent as _ci  # noqa: F401

    print("=" * 56)
    print(f"{_BOLD}Intent Classifier — Smoke Test{_RESET}")
    print(f"Provider : {llm_config.provider.value}")
    print(f"Model    : {llm_config.classifier_model}")
    print("=" * 56)
    print()

    if cli_queries:
        # Queries passed as CLI args — no expected intent to validate against
        pairs: list[tuple[str, QueryIntent | None]] = [(q, None) for q in cli_queries]
        await _run_batch(pairs)
    elif sys.stdin.isatty():
        # No args + interactive terminal → offer built-in suite or interactive
        print("Choose mode:")
        print("  1. Run built-in test suite (all intents, shows pass/fail)")
        print("  2. Interactive — type your own queries")
        choice = input("Choice [1/2]: ").strip()
        if choice == "2":
            await _run_interactive()
        else:
            print()
            await _run_batch(_DEFAULT_QUERIES)
    else:
        # Non-interactive (piped input) — run the built-in suite
        await _run_batch(_DEFAULT_QUERIES)


if __name__ == "__main__":
    asyncio.run(main())
