"""
Query decomposer — handles compound queries like "hi, do I have any fitness ideas?"

A compound query contains multiple sub-questions with different intents. This module:
  1. Detects if a query is compound by splitting on sentence boundaries
  2. Classifies + routes each sub-query independently
  3. Merges all results into a single context dict for the LLM

Security
--------
- user_id is passed through to every route_query call unchanged.
- Deduplication operates on results already filtered by user_id at the DB layer.
- No cross-user data is possible regardless of query structure.
"""

import logging
import re

from app.ai.query_router import route_query
from app.services.intent_classifier import QueryIntent, classify_intent

logger = logging.getLogger(__name__)

# Sub-queries shorter than this are likely conjunction fragments ("and", "also")
# and not worth classifying on their own.
_MIN_SUB_QUERY_LEN = 5

# Intent priority for picking the "dominant" intent when merging results.
# Higher priority → richer DB context → better LLM response.
# SEMANTIC_SEARCH wins because it returns the most relevant ideas.
_INTENT_PRIORITY: dict[str, int] = {
    QueryIntent.SEMANTIC_SEARCH: 4,
    QueryIntent.LISTING:         3,
    QueryIntent.COUNT:           2,
    QueryIntent.CONVERSATIONAL:  1,
}


def _split_query(query: str) -> list[str]:
    """
    Split a query into sub-queries on sentence boundaries and explicit
    multi-clause connectives.

    Deliberately does NOT split on bare "and" — that would break topical
    phrases like "fitness and nutrition ideas" into two separate queries.

    Returns a list of non-empty strings, each at least _MIN_SUB_QUERY_LEN chars.
    """
    # Split on terminal punctuation first
    parts = re.split(r"[.!?]+", query)

    result: list[str] = []
    for part in parts:
        # Only split on explicit multi-word connectives — never on bare "and"
        sub_parts = re.split(
            r"\b(and also|but also|also show|also list|also find|also tell)\b",
            part,
            flags=re.IGNORECASE,
        )
        result.extend(sub_parts)

    cleaned = [p.strip() for p in result if len(p.strip()) >= _MIN_SUB_QUERY_LEN]
    logger.debug("split %r → %d part(s): %s", query, len(cleaned), cleaned)
    return cleaned


async def decompose_and_route(query: str, user_id: str, db) -> dict:
    """
    Main entry point — replaces the separate classify_intent + route_query
    calls in the chat endpoint.

    Simple query  → classifies + routes once (identical overhead to before).
    Compound query → classifies + routes each sub-query, then merges results.

    Parameters
    ----------
    query:
        Raw user message. Sanitised internally by classify_intent (strip + truncate).
    user_id:
        Verified JWT subject. Passed through to every DB query — never derived
        from the query itself.
    db:
        AsyncIOMotorDatabase instance.

    Returns
    -------
    Context dict compatible with rag_service.stream_rag_response:
    {
        "ideas":       list[dict],  — deduplicated ideas, all scoped to user_id
        "intent":      str,         — dominant intent value
        "raw_query":   str,         — original full query (not the sub-queries)
        "count":       int | None,  — from COUNT handler, if any sub-query was COUNT
        "is_compound": bool,        — True only for multi-intent queries
    }
    """
    sub_queries = _split_query(query)

    # ── Simple path: single sub-query → no extra overhead ──────────────────────
    if len(sub_queries) <= 1:
        intent = await classify_intent(query)
        context = await route_query(query, intent, user_id, db)
        context["is_compound"] = False
        return context

    # ── Compound path: classify + route each sub-query independently ───────────
    logger.info("compound query detected (%d parts): %r", len(sub_queries), query)

    results: list[dict] = []
    for sub in sub_queries:
        intent = await classify_intent(sub)
        ctx = await route_query(sub, intent, user_id, db)
        results.append(ctx)

    # ── Merge ideas — deduplicate by _id (all already scoped to user_id) ───────
    merged_ideas: list[dict] = []
    seen_ids: set[str] = set()
    for r in results:
        for idea in r.get("ideas", []):
            # MongoDB documents use "_id"; serialised dicts may use "id"
            idea_id = str(idea.get("_id") or idea.get("id") or "")
            if idea_id and idea_id not in seen_ids:
                seen_ids.add(idea_id)
                merged_ideas.append(idea)

    # ── Count: take the first COUNT result (multiple counts in one query is rare) ─
    count: int | None = next(
        (r["count"] for r in results if r.get("count") is not None), None
    )

    # ── Dominant intent: highest priority drives the system prompt ─────────────
    dominant = max(results, key=lambda r: _INTENT_PRIORITY.get(r["intent"], 0))

    return {
        "ideas":       merged_ideas,
        "intent":      dominant["intent"],   # string value e.g. "SEMANTIC_SEARCH"
        "raw_query":   query,                # always the original full query
        "count":       count,
        "is_compound": True,
    }
