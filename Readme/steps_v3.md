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
  → SSE events: thinking / text / done / error
  → [ChatWindow.tsx] renders tokens + status indicator
```
