# to test, from backend/ run:
#   python testFiles/test_classifier_smoke.py
#   ../.venv/bin/python testFiles/test_classifier_smoke.py

"""
Offline regression smoke-test for the two classifier entry points.

Why this exists
---------------
`classify_intent` and `classify_chat_route` each build their LLM call inside the
function body. A stale reference there (e.g. a removed import) imports fine and
only explodes at REQUEST time — exactly the `NameError: name 'AsyncOpenAI' is
not defined` that slipped past compile/import checks. This test *executes* both
functions end-to-end with the LLM call mocked, so that class of bug is caught
without any network access or API keys.

It is fully self-contained: it monkeypatches `create_chat_completion` in the
intent_classifier module, so no provider, keys, or running Ollama are required.

Run (from backend/):
    python testFiles/test_classifier_smoke.py
Exit code is 0 on success, 1 on any failure (CI-friendly).
"""

import asyncio
import os
import sys
from types import SimpleNamespace

# Allow imports from backend/ root without installing the package.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import intent_classifier as ic
from app.services.intent_classifier import (
    ChatRoute,
    QueryIntent,
    classify_chat_route,
    classify_intent,
)

_GREEN = "\033[92m"
_RED = "\033[91m"
_RESET = "\033[0m"

_passed = 0
_failed = 0


def _check(name: str, got, expected) -> None:
    global _passed, _failed
    if got == expected:
        _passed += 1
        print(f"  {_GREEN}✓{_RESET} {name}: {got}")
    else:
        _failed += 1
        print(f"  {_RED}✗ {name}: got {got!r}, expected {expected!r}{_RESET}")


def _fake_response(content: str):
    """Build the minimal object shape the classifiers read: .choices[0].message.content."""
    message = SimpleNamespace(content=content)
    choice = SimpleNamespace(message=message)
    return SimpleNamespace(choices=[choice])


def _stub_returning(content: str):
    """A create_chat_completion stub that always returns `content` as the label."""

    async def _stub(messages, *, tier, **kwargs):  # noqa: ANN001 - test stub
        return _fake_response(content)

    return _stub


def _stub_raising(exc: Exception):
    """A create_chat_completion stub that always raises — exercises the except paths."""

    async def _stub(messages, *, tier, **kwargs):  # noqa: ANN001 - test stub
        raise exc

    return _stub


def _stub_boom():
    """A stub that must NOT be called (proves a fast-path short-circuit)."""

    async def _stub(messages, *, tier, **kwargs):  # noqa: ANN001 - test stub
        raise AssertionError("LLM was called when it should have been short-circuited")

    return _stub


async def main() -> int:
    original = ic.create_chat_completion
    try:
        # ── classify_intent maps each label the model can return ──────────────
        print("classify_intent — label mapping:")
        for label in ("CONVERSATIONAL", "LISTING", "SEMANTIC_SEARCH", "COUNT", "OUT_OF_SCOPE"):
            ic.create_chat_completion = _stub_returning(label)
            got = await classify_intent("some query")
            _check(f"model→{label}", got, QueryIntent(label))

        # Unrecognised model output → safe SEMANTIC_SEARCH default.
        ic.create_chat_completion = _stub_returning("banana nonsense")
        _check("unknown label → default", await classify_intent("x"), QueryIntent.SEMANTIC_SEARCH)

        # Provider failure → SEMANTIC_SEARCH (exercises the except branch).
        ic.create_chat_completion = _stub_raising(RuntimeError("all providers down"))
        _check("intent LLM error → default", await classify_intent("x"), QueryIntent.SEMANTIC_SEARCH)

        # ── classify_chat_route ───────────────────────────────────────────────
        print("classify_chat_route — routing:")

        # Fast-path write command must NOT call the LLM at all.
        ic.create_chat_completion = _stub_boom()
        _check(
            "fast-path write (no LLM)",
            await classify_chat_route("create a new idea about gardening"),
            ChatRoute.AGENT_WRITE,
        )

        # Non-fast-path query → whatever the model labels it.
        ic.create_chat_completion = _stub_returning("AGENT_READ")
        _check("model→AGENT_READ", await classify_chat_route("what are my fitness ideas?"), ChatRoute.AGENT_READ)

        ic.create_chat_completion = _stub_returning("AGENT_WRITE")
        _check("model→AGENT_WRITE", await classify_chat_route("polish the wording please"), ChatRoute.AGENT_WRITE)

        # Provider failure → AGENT_READ (safe, non-destructive default).
        ic.create_chat_completion = _stub_raising(RuntimeError("all providers down"))
        _check("route LLM error → AGENT_READ", await classify_chat_route("tell me about my ideas"), ChatRoute.AGENT_READ)
    finally:
        ic.create_chat_completion = original

    print()
    if _failed:
        print(f"{_RED}FAILED: {_passed} passed, {_failed} failed{_RESET}")
        return 1
    print(f"{_GREEN}ALL PASSED: {_passed} checks{_RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
