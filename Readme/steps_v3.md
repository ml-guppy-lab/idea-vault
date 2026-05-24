# Idea Vault — Version 3 Implementation Notes

---

## Epic 1 — Intent Classification & Query Router

### What & Why

Version 2 sent every chat query to the same vector search pipeline regardless of what the user actually asked. V3 adds an **intent classifier** that reads the query first and routes it to the right handler:

| Intent | Example | Action |
|---|---|---|
| `CONVERSATIONAL` | "hi, how are you?" | Skip DB entirely, LLM answers directly |
| `LISTING` | "show me all my ideas" | Fetch 10 most recent from MongoDB |
| `SEMANTIC_SEARCH` | "ideas about ML" | Vector similarity search |
| `COUNT` | "how many ideas do I have?" | `count_documents` query |

---

### Files Created

| File | Purpose |
|---|---|
| `backend/app/services/intent_classifier.py` | Classifies query → one of 4 intents using a small/fast LLM |
| `backend/app/core/ai/__init__.py` | Package marker |
| `backend/app/core/ai/handlers.py` | One async function per intent — fetches data from MongoDB |
| `backend/app/core/ai/query_router.py` | Dispatches to the right handler based on intent |
| `backend/testFiles/test_intent_classifier.py` | CLI smoke-test for the classifier |
| `frontend/components/chat/StatusIndicator.tsx` | Perplexity-style status dot shown while backend is working |

### Files Modified

| File | What Changed |
|---|---|
| `backend/app/core/config.py` | Added `LLM_CLASSIFIER_MODEL_OLLAMA` and `LLM_CLASSIFIER_MODEL_OPENROUTER` |
| `backend/app/core/llm_config.py` | Added `classifier_model` property (separate from main generation model) |
| `backend/app/services/rag_service.py` | Removed its own retrieval logic; now accepts pre-fetched `context` dict |
| `backend/app/api/chat.py` | Wired in classify → status event → route → stream pipeline |
| `frontend/components/chat/ChatWindow.tsx` | Added `status` SSE event handling + renders `StatusIndicator` |

---

### Step-by-Step Implementation

#### Step 1 — Classifier config

Added two new fields to `config.py` so the classifier uses a cheaper/faster model than the main generation model:

```python
LLM_CLASSIFIER_MODEL_OLLAMA: str = "qwen3:4b"
LLM_CLASSIFIER_MODEL_OPENROUTER: str = "meta-llama/llama-3.2-3b-instruct:free"
```

Added a `classifier_model` property to `LLMConfig` that returns the right one based on the active provider.

---

#### Step 2 — Intent classifier (`intent_classifier.py`)

- Accepts only `query: str` — **user_id is intentionally never passed** (classification is stateless; isolation is enforced at the retrieval layer)
- Strips and truncates input to 200 chars (prompt injection defense)
- Calls the LLM with `temperature=0` (deterministic)
- Uses `re.search` to extract the label from the response (handles models that add punctuation or brief commentary)
- Falls back to `SEMANTIC_SEARCH` if the model returns garbage

---

#### Step 3 — Handlers (`handlers.py`)

Four simple async functions. Each one:
- **Always** filters MongoDB with `{"userId": user_id}` — never omitted, even in fallback paths
- **Always** excludes the `embedding` field (large float array, no value to the LLM)
- Returns a normalised dict: `{"ideas": [...], "intent": str, "raw_query": str, "count": int|None}`

`handle_semantic_search` calls the existing `search_similar_ideas()` and falls back to recent ideas if vector search returns nothing.

---

#### Step 4 — Query router (`query_router.py`)

Single function `route_query(query, intent, user_id, db)`. Uses a `match` statement. Any unhandled intent raises `ValueError` loudly — prevents silent wrong-routing if a new intent is added to the enum later without updating the router.

---

#### Step 5 — Refactor `rag_service.py`

Old signature: `stream_rag_response(user_message, user_id, db)` — did retrieval internally.  
New signature: `stream_rag_response(user_message, context)` — pure LLM streaming layer.

Added intent-aware system prompts:
- `CONVERSATIONAL` → no ideas context, LLM responds naturally
- `COUNT` → injects the count number into the prompt
- `LISTING` / `SEMANTIC_SEARCH` → existing ideas-grounded prompt

---

#### Step 6 — Wire into `chat.py`

New `_event_generator()` flow:
```
yield status: "Classifying your request..."
intent = await classify_intent(query)
yield status: "Searching your ideas..." (intent-specific)
context = await route_query(query, intent, user_id, db)
async for event in stream_rag_response(message, context): yield event
```

Every step is wrapped in `try/except` so failures emit `{"type":"error","content":"..."}` instead of silently dropping the connection (ASGI swallows generator exceptions — without this, curl hangs forever).

---

#### Step 7 — Frontend status indicator

New `StatusIndicator.tsx` — bouncing blue dot + pulsing text. Renders `null` when `message` is null (zero cost).

In `ChatWindow.tsx`:
- Added `statusMessage: string | null` state (transient, never persisted)
- `status` SSE events → `setStatusMessage(event.content)`
- First `text` token → `setStatusMessage(null)` (clears the indicator)
- `finally` block also clears it (catches network errors / missing `done` event)

---

### Issues Encountered & Fixes

#### Issue 1 — OpenRouter rate limiting (429)
`meta-llama/llama-3.2-3b-instruct:free` was rate-limited upstream during testing.  
**Fix:** Switched to local Ollama (`qwen3:4b`) for dev testing using `--provider ollama` flag.

---

#### Issue 2 — Classifier returning `SEMANTIC_SEARCH` for everything (Ollama)
**Root cause:** `qwen3:4b` is a thinking model. It emits `<think>...</think>` reasoning internally. Ollama's OpenAI-compatible API counts thinking tokens against `max_tokens`. With `max_tokens=10`, all tokens were consumed by thinking — `message.content` came back empty — every parse failed — fell back to `SEMANTIC_SEARCH`.

**Diagnosed by** printing raw response and checking `finish_reason='length'` with empty content at various `max_tokens` values.

**Fix:** 
```python
max_tokens = None if llm_config.provider == LLMProvider.ollama else 10
```
Ollama gets no cap (model thinks freely then responds). OpenRouter's `llama-3.2-3b` has no thinking mode so `max_tokens=10` is safe and cheap.

---

#### Issue 3 — Mock `find()` was async
Test mock had `async def find()` but Motor's real `.find()` is synchronous (returns a cursor, not a coroutine). Calling it returned a coroutine → `.sort()` failed.  
**Fix:** `def find(self, *a, **kw): return self` (sync).

---

#### Issue 4 — `asyncio.coroutine` removed in Python 3.11+
A mock used `asyncio.coroutine(lambda: [])()` which is removed in Python 3.14.  
**Fix:** `async def to_list(self, n): return []`

---

#### Issue 5 — Chat endpoint silently hanging
Exceptions inside a FastAPI `StreamingResponse` generator are swallowed by ASGI — the connection just closes and curl waits forever with no output.  
**Fix:** Wrapped every step in `try/except` inside `_event_generator()` to yield `{"type":"error"}` events on failure.

---

#### Issue 6 — Code changes not taking effect in Docker
`uvicorn` in the Dockerfile runs without `--reload`. Volume-mounted files update on disk but the process keeps old modules in memory.  
**Fix:** `docker compose restart backend` after any backend code change.

---

### How to Test

#### Classifier only (local, no Docker needed)
```bash
cd backend
source venv/bin/activate

# Run built-in suite (pass/fail for all 4 intents)
python testFiles/test_intent_classifier.py --provider ollama

# Test a single query
python testFiles/test_intent_classifier.py --provider ollama "how many ideas do I have?"

# Interactive mode
python testFiles/test_intent_classifier.py --provider ollama
# then choose 2
```

#### Full pipeline via curl
```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "hey, how are you?"}' \
  --no-buffer

# Expected output:
# data: {"type": "status", "content": "Classifying your request..."}
# data: {"type": "status", "content": "Just a moment..."}
# data: {"type": "text", "content": "Hi! ..."}
# data: {"type": "done", "content": ""}
```

Test each intent:
```bash
-d '{"message": "how many ideas do I have?"}'     # COUNT
-d '{"message": "show me all my ideas"}'           # LISTING
-d '{"message": "ideas about machine learning"}'   # SEMANTIC_SEARCH
-d '{"message": "hey, how are you?"}'              # CONVERSATIONAL
```

#### UI test
Open the chat widget. Send any message. You should see the blue bouncing dot with status text appear immediately, then disappear when the first token arrives.

---

### Pipeline Summary (V3)

```
User query
  → [chat.py] rate limit check
  → classify_intent()         — small/fast model, stateless
  → status SSE event          — "Searching your ideas..." etc.
  → route_query()             — dispatches to correct handler
      → handle_conversational()   — no DB
      → handle_listing()          — recent 10 ideas
      → handle_semantic_search()  — vector search + fallback
      → handle_count()            — count_documents
  → stream_rag_response()     — intent-aware prompt → LLM stream
  → SSE events: text / done / error
  → [ChatWindow.tsx] renders tokens + status indicator
```

---

## Epic 2 — Model Tiering

### What & Why

All queries were previously using one model for generation regardless of complexity. V3 selects model size based on intent — simple intents use a smaller/faster model, semantic search uses a larger one.

### Files Modified

| File | What Changed |
|---|---|
| `backend/app/core/llm_config.py` | Added `ModelTier` enum, `_MODEL_TIER_MAP`, `model_for_tier()` method, `select_tier_for_intent()` function |
| `backend/app/services/rag_service.py` | Derives tier from `context["intent"]`, passes selected model to `_create_stream_with_fallback` |
| `backend/app/core/config.py` | Updated `LLM_OPENROUTER_MODEL` default to match STANDARD tier model |
| `backend/.env` | Cleaned up stale model names (`gpt-oss-120b`, `gemma-4-31b`) → replaced with tier-aligned models |

### Files Created

| File | Purpose |
|---|---|
| `backend/testFiles/test_model_tiering.py` | Prints resolved model per intent + asserts FAST ≠ STANDARD |

### Tier Map

| Intent | Tier | Ollama model | OpenRouter model |
|---|---|---|---|
| `CONVERSATIONAL` | FAST | `qwen3:4b` | `meta-llama/llama-3.2-3b-instruct:free` |
| `LISTING` | FAST | `qwen3:4b` | `meta-llama/llama-3.2-3b-instruct:free` |
| `COUNT` | FAST | `qwen3:4b` | `meta-llama/llama-3.2-3b-instruct:free` |
| `SEMANTIC_SEARCH` | STANDARD | `qwen3:14b` | `mistralai/mistral-7b-instruct:free` |

The intent classifier always uses `classifier_model` (separate property, always fast) — never subject to the tier map.

### How to Test

```bash
cd backend
python testFiles/test_model_tiering.py                    # uses .env provider
python testFiles/test_model_tiering.py --provider openrouter
```

---

## Additional Fixes & Changes (Post-Epic-1 Testing)

### Fix 1 — Thinking tokens disabled for all providers

**Problem:** qwen3 models (Ollama) run chain-of-thought by default, adding 30-120s latency on every request — including trivial ones like "hi".

**Fix — classifier (`intent_classifier.py`):**
```python
if llm_config.provider == LLMProvider.ollama:
    kwargs["extra_body"] = {"think": False}
```
`max_tokens=None` retained for Ollama as a safety net in case `think: False` is not honoured by the OpenAI-compat layer (prevents empty content → SEMANTIC_SEARCH fallback).

**Fix — generation (`rag_service.py`):**  
Removed `"include_reasoning": True` from OpenRouter extra params.  
Added `extra_body={"think": False}` for Ollama.  
Neither provider streams reasoning tokens to the frontend.

**Fix — frontend (`MessageBubble.tsx`, `ChatWindow.tsx`):**  
Removed the collapsible "Thinking" block UI, `thinking` field from `Message` interface, and `thinking` SSE event handler entirely.

---

### Fix 2 — MongoDB projection error (code 31254)

**Problem:** `_IDEA_PROJECTION` in `handlers.py` mixed inclusion fields (`field: 1`) with one exclusion (`"embedding": 0`). MongoDB rejects mixed projections.

**Fix:** Removed `"embedding": 0`. Embedding is implicitly excluded when an inclusion projection lists only the required fields.

---

### Fix 3 — Frontend SSE timeout (`UND_ERR_BODY_TIMEOUT`)

**Problem:** Next.js uses undici internally for `fetch()`. Undici's body timeout killed the SSE stream mid-response for slow queries (SEMANTIC_SEARCH + qwen3:14b on CPU).

**Fix:** Rewrote `frontend/app/api/chat/route.ts` to use Node.js's native `node:http` module instead of `fetch()`. Native http has no body timeout by default — the stream stays open until the LLM finishes.  
Also added `export const maxDuration = 300` for Vercel compatibility.

---

### Fix 4 — `ai/` folder location

`backend/app/core/ai/` was moved to `backend/app/ai/` during development. All imports updated:

| File | Old import | New import |
|---|---|---|
| `chat.py` | `from backend.app.ai.query_router` | `from app.ai.query_router` |
| `query_router.py` | `from backend.app.ai.handlers` | `from app.ai.handlers` |

---

### Fix 5 — Debug logging added to classifier

Added `logging.getLogger(__name__)` to `intent_classifier.py`. Classifier logs the raw model output at DEBUG level:
```
DEBUG app.services.intent_classifier — classifier raw output for 'hi': 'CONVERSATIONAL'
```
Useful for verifying classification without curl — visible in `docker compose logs backend`.

---

## Epic 3 — Compound Query Decomposition

### What & Why

V3 Epic 1 assumed one intent per message. Real users send multi-part queries like:
- "hi, how many ideas do I have?"  ← CONVERSATIONAL + COUNT
- "how many ideas do I have? do I have any fitness ideas?" ← COUNT + SEMANTIC_SEARCH

A single classification picks one intent and silently ignores the rest. Epic 3 splits the query, classifies each part independently, routes each to the correct handler, and merges the results before passing a unified context to the LLM.

---

### Files Created

| File | Purpose |
|---|---|
| `backend/app/ai/query_decomposer.py` | Splits, classifies, routes, and merges compound queries |

### Files Modified

| File | What Changed |
|---|---|
| `backend/app/api/chat.py` | Replaced `classify_intent + route_query` with single `decompose_and_route` call |
| `backend/app/services/rag_service.py` | `_build_system_prompt` gains `compound_prefix` + `count_fact` injection for compound context |

---

### Step-by-Step Implementation

#### Step 1 — Query splitter (`_split_query`)

Splits on sentence-terminal punctuation (`.!?`) first, then on explicit multi-word connectives:

```
"and also" | "but also" | "also show" | "also list" | "also find" | "also tell"
```

Deliberately **not** splitting on bare `"and"` — that would break topical phrases like `"fitness and nutrition ideas"` into two useless fragments.

Sub-strings shorter than 5 characters are dropped (conjunction fragments like `"and"`, `"also"`).

---

#### Step 2 — Simple path (no overhead for single-intent queries)

If `_split_query` returns ≤ 1 part, the function falls through to the original single classify + route path. No extra latency added for normal queries.

---

#### Step 3 — Compound path

For N sub-queries:
1. `classify_intent(sub)` — called N times sequentially
2. `route_query(sub, intent, user_id, db)` — called N times sequentially
3. Results merged:
   - **Ideas** — deduplicated by `_id` (all already scoped to `user_id` at DB layer)
   - **Count** — first COUNT result wins (multiple count sub-queries in one message is rare)
   - **Dominant intent** — highest priority intent drives the system prompt selection

Intent priority (higher = richer DB context = better LLM grounding):
```
SEMANTIC_SEARCH: 4  →  LISTING: 3  →  COUNT: 2  →  CONVERSATIONAL: 1
```

---

#### Step 4 — Context dict returned

```python
{
    "ideas":       list[dict],  # deduplicated, all scoped to user_id
    "intent":      str,         # dominant intent value e.g. "SEMANTIC_SEARCH"
    "raw_query":   str,         # original full query (not sub-queries)
    "count":       int | None,  # from COUNT handler if any sub-query was COUNT
    "is_compound": bool,        # True only for multi-intent queries
}
```

---

#### Step 5 — Prompt changes in `rag_service.py`

Two additions to `_build_system_prompt`:

**`compound_prefix`** — prepended to every intent branch when `is_compound=True`:
```
"The user's message contains multiple questions or requests.
Address ALL of them in your response — do not skip any part."
```

**`count_fact`** — injected into LISTING/SEMANTIC_SEARCH prompts when the compound context includes a COUNT result. Without this, the LLM would count the few retrieved ideas shown in the prompt instead of the real vault total:
```
"FACT: The user has 4 ideas saved in total in their vault.
Use this number if they asked how many ideas they have."
```

COUNT prompt (any compound or standalone) already says: *"Tell the user this in a warm, complete sentence — never output just the number alone."*

---

#### Step 6 — Wire into `chat.py`

Replaced:
```python
intent = await classify_intent(query)
context = await route_query(query, intent, user_id, db)
```
With:
```python
from app.ai.query_decomposer import decompose_and_route
context = await decompose_and_route(query=request.message, user_id=user_id, db=db)
```

The `_status_map` keys remain plain strings (`"CONVERSATIONAL"`, etc.) — `context["intent"]` is always the `.value` of the `QueryIntent` enum.

---

### Known Behaviour

| Scenario | Behaviour |
|---|---|
| Single-intent query | No overhead — same path as before Epic 3 |
| Compound with CONVERSATIONAL + COUNT | Dominant = COUNT; `compound_prefix` tells LLM to also greet |
| Compound with COUNT + SEMANTIC_SEARCH | Dominant = SEMANTIC_SEARCH; `count_fact` injects real total into prompt |
| Classifier typo (e.g. `SEMIC_SEARCH`) | Regex match fails → fallback `SEMANTIC_SEARCH`; routing still correct |
| Laptop closed mid-request | Ollama pauses → in-flight request fails → frontend shows network error; not a code bug |

---

### Latency Impact

Each sub-query adds one `classify_intent` call + one DB query. For Ollama on Mac CPU, each classifier call takes ~12–15 s, so a 2-part compound query takes ~25 s in classification alone before generation starts. This is expected for local CPU inference.

For interactive use, switch STANDARD tier to `qwen3:4b` locally (set `LLM_OLLAMA_MODEL=qwen3:4b` in `.env`) or use OpenRouter where cloud GPU inference is fast.

---

### Updated Pipeline Summary (V3 Epic 3)

```
User query
  → [chat.py] rate limit check
  → yield status: "Analysing your request..."
  → decompose_and_route()
      → _split_query()              — sentence/connective split
      → [simple path]  classify + route once
      → [compound path] for each sub-query:
            classify_intent()       — small/fast model
            route_query()           — correct handler per intent
        merge ideas (deduplicate by _id)
        pick dominant intent by priority
  → yield status: intent-specific message
  → stream_rag_response()
      → _build_system_prompt()      — compound_prefix + count_fact if needed
      → LLM stream (tier-selected model)
  → SSE events: text / done / error
```
