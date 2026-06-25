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

import logging
import re
from enum import Enum

from openai import AsyncOpenAI, RateLimitError

from app.core.llm_config import LLMProvider, llm_config

logger = logging.getLogger(__name__)

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

    # Disable thinking for Ollama qwen3 models — without this, the model runs a
    # full chain-of-thought before outputting a single label word, adding 30-120s
    # of latency to every request. think=False makes classification near-instant.
    # max_tokens=None for Ollama: safety net in case think=False is not honoured
    # by the OpenAI-compat layer — lets the model finish thinking then output label.
    # max_tokens=10 for OpenRouter/others: no thinking mode, label fits in 10 tokens.
    kwargs: dict = {
        "model": llm_config.classifier_model,
        "messages": [
            {"role": "system", "content": _INTENT_SYSTEM_PROMPT},
            {"role": "user", "content": safe_query},
        ],
        "max_tokens": None if llm_config.provider == LLMProvider.ollama else 10,
        "temperature": 0,  # deterministic — classification is not creative
        "stream": False,
    }
    if llm_config.provider == LLMProvider.ollama:
        kwargs["extra_body"] = {"think": False}

    try:
        response = await client.chat.completions.create(**kwargs)
    except RateLimitError:
        # Classifier model is rate-limited at the provider level.
        # Default to SEMANTIC_SEARCH — safest fallback because it triggers
        # retrieval so the user still gets a relevant answer.
        logger.warning("classifier rate-limited; defaulting to SEMANTIC_SEARCH")
        return QueryIntent.SEMANTIC_SEARCH

    raw = (response.choices[0].message.content or "")
    logger.debug("classifier raw output for %r: %r", safe_query, raw)

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


# ───────────────────────────────────────────────────────────────────────────────
# Pipeline routing — read (RAG) vs write (agent)
#
# This is a SEPARATE, coarser classification layer that sits ABOVE QueryIntent.
# It decides which *pipeline* a message goes to:
#   AGENT_WRITE → the agentic-AI service (generates proposals, never auto-writes)
#   AGENT_READ  → the existing RAG pipeline (which then runs its own QueryIntent
#                 classification internally via decompose_and_route)
#
# It is kept distinct from QueryIntent on purpose: the RAG retrieval/tiering code
# (route_query, select_tier_for_intent) only understands the four QueryIntent
# values, so polluting that enum with write-routing would break those contracts.
# ───────────────────────────────────────────────────────────────────────────────


class ChatRoute(str, Enum):
    """Top-level routing decision for the unified chat endpoint."""

    AGENT_WRITE = "AGENT_WRITE"  # create / update / improve / add → agent proposals
    AGENT_READ = "AGENT_READ"    # everything else → RAG read pipeline


_ROUTE_SYSTEM_PROMPT = """You route a message about a user's personal idea vault to one of two pipelines.

Reply with exactly one label:
- AGENT_WRITE: the user wants to CREATE, ADD, UPDATE, EDIT, IMPROVE, REWRITE, REFINE, EXPAND, or otherwise MODIFY an idea or a task.
- AGENT_READ: anything else — asking questions, listing, counting, searching, summarizing, or general conversation.

Examples:
- "improve my first idea" -> AGENT_WRITE
- "rewrite the description of my fitness idea" -> AGENT_WRITE
- "add a task to my meal-prep idea" -> AGENT_WRITE
- "create a new idea about a budgeting app" -> AGENT_WRITE
- "make my idea title clearer" -> AGENT_WRITE
- "what are my ideas?" -> AGENT_READ
- "how many ideas do I have?" -> AGENT_READ
- "do I have any ideas about travel?" -> AGENT_READ
- "summarize my building-stage ideas" -> AGENT_READ
- "hello" -> AGENT_READ

Respond with ONLY the label. No explanation. No punctuation. Just the label."""

# High-precision fast path for unambiguous write commands. Matching here returns
# AGENT_WRITE WITHOUT an LLM call (lower latency, zero token cost). It is kept
# deliberately conservative — write verbs must reference the user's content
# ("idea", "task", "it", "my", ...) so read phrasings like "ideas about
# improving sleep" do NOT match and instead fall through to the LLM classifier.
_WRITE_FASTPATH = re.compile(
    r"""
    (^\s*(please\s+|can\s+you\s+|could\s+you\s+|i\s+want\s+to\s+|i'?d\s+like\s+to\s+)?
      (improve|rewrite|revise|refine|enhance|polish|expand|shorten|reword|update|edit|modify|tweak)\b
      [^.?!]{0,40}\b(idea|task|description|title|summary|tag|tags|it|this|that|my)\b)
    | (\bcreate\s+(a\s+|an\s+|another\s+)?(new\s+)?(idea|task|to-?do)\b)
    | (\badd\s+(a\s+|an\s+|another\s+)?(new\s+)?(idea|task|subtask|to-?do|step)\b)
    | (\bmake\s+(it|this|that|my|the)\b[^.?!]{0,40}\b(better|clearer|cleaner|shorter|longer|concise|detailed|stronger)\b)
    """,
    re.IGNORECASE | re.VERBOSE,
)


async def classify_chat_route(query: str) -> ChatRoute:
    """
    Decide whether *query* should go to the agent (write) or RAG (read) pipeline.

    Strategy
    --------
    1. A conservative regex fast path catches obvious write commands with no LLM
       call at all.
    2. Everything else is classified by the fast/small model with a focused
       binary prompt.

    Security / robustness
    ---------------------
    - Never accepts user_id — same contract as classify_intent.
    - Input is stripped and hard-truncated before reaching the LLM.
    - Any unrecognised / failed model output falls back to AGENT_READ, the
      non-destructive path (the agent never writes without explicit approval,
      but defaulting to read avoids surfacing spurious proposals).
    """
    safe_query = query.strip()[:_MAX_QUERY_CHARS]

    # ── Fast path: unambiguous write command → no LLM call ────────────────────
    if _WRITE_FASTPATH.search(safe_query):
        return ChatRoute.AGENT_WRITE

    client = AsyncOpenAI(
        base_url=llm_config.base_url,
        api_key=llm_config.api_key,
        default_headers=llm_config.extra_headers,
    )

    kwargs: dict = {
        "model": llm_config.classifier_model,
        "messages": [
            {"role": "system", "content": _ROUTE_SYSTEM_PROMPT},
            {"role": "user", "content": safe_query},
        ],
        "max_tokens": None if llm_config.provider == LLMProvider.ollama else 10,
        "temperature": 0,
        "stream": False,
    }
    if llm_config.provider == LLMProvider.ollama:
        kwargs["extra_body"] = {"think": False}

    try:
        response = await client.chat.completions.create(**kwargs)
    except RateLimitError:
        # Classifier rate-limited → default to the safe, non-destructive path.
        logger.warning("route classifier rate-limited; defaulting to AGENT_READ")
        return ChatRoute.AGENT_READ

    # Defensive: some providers can return an empty choices list on transient
    # errors — guard against IndexError so the endpoint never 500s here.
    choices = getattr(response, "choices", None)
    if not choices:
        return ChatRoute.AGENT_READ

    raw = (choices[0].message.content or "")
    logger.debug("route classifier raw output for %r: %r", safe_query, raw)

    # Strip any residual <think>...</think> blocks (defense-in-depth).
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL)

    valid_labels = "|".join(route.value for route in ChatRoute)
    match = re.search(rf"\b({valid_labels})\b", raw.upper())
    if match:
        return ChatRoute(match.group(1))

    # Unrecognised output → safe non-destructive default.
    return ChatRoute.AGENT_READ