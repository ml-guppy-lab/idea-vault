"""
Query router — maps a classified intent to the correct handler.

This is the single decision point in the AI pipeline. Callers only need to
supply a query, its classified intent, the authenticated user_id, and the DB
handle. The router does the rest.

Usage:
    from app.ai.query_router import route_query
    from app.services.intent_classifier import classify_intent

    intent = await classify_intent(user_message)
    context = await route_query(user_message, intent, user_id, db)
    # pass context to the LLM prompt builder
"""

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.ai.handlers import (
    handle_conversational,
    handle_count,
    handle_listing,
    handle_semantic_search,
)
from app.services.intent_classifier import QueryIntent

# Context dict shape returned by every handler:
# {
#   "ideas":     list[dict]   — idea documents (embedding excluded)
#   "intent":    str          — QueryIntent.value
#   "raw_query": str          — original query (empty where irrelevant)
#   "count":     int | None   — only set for COUNT intent
# }
type ContextDict = dict


async def route_query(
    query: str,
    intent: QueryIntent,
    user_id: str,
    db: AsyncIOMotorDatabase,
) -> ContextDict:
    """
    Route a classified query to its handler and return a context dict.

    Parameters
    ----------
    query:
        The raw user message (already sanitised by the classifier layer).
    intent:
        QueryIntent produced by classify_intent(). Never derived from raw input.
    user_id:
        Authenticated user's ID from the verified JWT. Every handler uses this
        to scope MongoDB queries — user isolation is enforced at the data layer.
    db:
        Motor database instance injected by FastAPI's dependency system.

    Returns
    -------
    ContextDict
        Normalised dict consumed by the LLM prompt builder in rag_service.
        Shape is identical across all intents (count may be None).
    """
    match intent:
        case QueryIntent.CONVERSATIONAL:
            return await handle_conversational(query)
        case QueryIntent.LISTING:
            return await handle_listing(user_id, db)
        case QueryIntent.COUNT:
            return await handle_count(user_id, db)
        case QueryIntent.SEMANTIC_SEARCH:
            return await handle_semantic_search(query, user_id, db)
        case QueryIntent.OUT_OF_SCOPE:
            # Off-topic / general-knowledge / code request. No DB access and no
            # retrieval — the pipeline detects this intent and returns a fixed
            # refusal, so the (expensive) generation model is never called.
            return {
                "ideas": [],
                "intent": QueryIntent.OUT_OF_SCOPE.value,
                "raw_query": query,
                "count": None,
            }
        case _:
            # Exhaustive match — should never reach here because the classifier
            # always returns a valid QueryIntent (with SEMANTIC_SEARCH as fallback).
            # If a new intent is added to the enum without updating this router,
            # fail loudly rather than silently returning wrong data.
            raise ValueError(f"Unhandled intent: {intent!r}. Add a case to route_query.")
