# Idea Vault — Version 3 Implementation Notes

---

## Feature: Intent Classification + Query Router

### Why
V2 routed every chat message through one semantic retrieval path. That was inefficient and sometimes wrong for simple intents like greetings or counts.

V3 introduced intent-aware routing so each query type takes the correct execution path.

### Intent categories
- `CONVERSATIONAL` → no DB retrieval
- `LISTING` → recent ideas list
- `SEMANTIC_SEARCH` → vector retrieval
- `COUNT` → count query

### Final implementation
- Added classifier service using a small/fast model.
- Added handler module with one function per intent.
- Added router that dispatches by intent.
- Refactored chat pipeline to use classifier + route output as context.
- Added frontend status indicator event handling.

### Files created
- `backend/app/services/intent_classifier.py`
- `backend/app/ai/__init__.py`
- `backend/app/ai/handlers.py`
- `backend/app/ai/query_router.py`
- `backend/testFiles/test_intent_classifier.py`
- `frontend/components/chat/StatusIndicator.tsx`

### Files changed
- `backend/app/core/config.py`
- `backend/app/core/llm_config.py`
- `backend/app/services/rag_service.py`
- `backend/app/api/chat.py`
- `frontend/components/chat/ChatWindow.tsx`

### Result
Chat now chooses the right backend path per user intent instead of overusing semantic search.

---

## Feature: Model Tiering

### Why
Not every chat message needs the same model size. Using one large model for everything increases cost and latency.

### Final implementation
- Added `FAST` and `STANDARD` model tiers.
- Intent selects tier:
  - `CONVERSATIONAL`, `LISTING`, `COUNT` → `FAST`
  - `SEMANTIC_SEARCH` → `STANDARD`
- Kept classifier on separate small model regardless of tier.

### Files changed
- `backend/app/core/llm_config.py`
  - Added `ModelTier`, tier map, model selection helpers
- `backend/app/services/rag_service.py`
  - Uses intent-derived tier when choosing generation model
- `backend/app/core/config.py`
  - Updated default model alignment
- `backend/.env`
  - Updated model values for tier map consistency

### Files created
- `backend/testFiles/test_model_tiering.py`

### Verification
Added runtime logging in RAG service to print resolved:
- intent
- tier
- model

### Result
Simple queries are faster/cheaper while complex semantic requests still use stronger models.

---

## Fixes After Real-World Testing

### Fix: Thinking-token overhead on local models

#### Problem
Ollama qwen models were spending too long in reasoning mode, causing large latency even for simple prompts.

#### Fix
- Disabled thinking mode in classifier and generation paths for Ollama where supported.
- Removed reasoning-token streaming UI because frontend no longer consumes it.

#### Files changed
- `backend/app/services/intent_classifier.py`
- `backend/app/services/rag_service.py`
- `frontend/components/chat/MessageBubble.tsx`
- `frontend/components/chat/ChatWindow.tsx`

#### Result
Substantially better responsiveness for local development.

---

### Fix: MongoDB projection error (code 31254)

#### Problem
Handler projection mixed inclusion and exclusion fields in one query.

#### Fix
Removed explicit `embedding: 0` from inclusion projection.

#### File changed
- `backend/app/ai/handlers.py`

#### Result
MongoDB projection became valid and stable.

---

### Fix: Next.js SSE body timeout (`UND_ERR_BODY_TIMEOUT`)

#### Problem
Undici-based `fetch()` in Next.js proxy could timeout long-running SSE streams.

#### Fix
Switched chat BFF transport to Node `http` streaming and added `maxDuration` setting.

#### File changed
- `frontend/app/api/chat/route.ts`

#### Result
Long responses stream reliably without premature timeout.

---

### Fix: Stale import path after ai-folder move

#### Problem
`app/core/ai` was moved to `app/ai` but some imports still used old path.

#### Fix
Updated imports in chat and router modules.

#### Files changed
- `backend/app/api/chat.py`
- `backend/app/ai/query_router.py`

#### Result
Routing/import resolution is correct after folder migration.

---

### Fix: Classifier observability

#### Problem
Classifier behavior was hard to inspect during debugging.

#### Fix
Added debug logger for raw classifier outputs.

#### File changed
- `backend/app/services/intent_classifier.py`

#### Result
Intent debugging became faster and easier from backend logs.

---

## Feature: Compound Query Decomposition

### Why
Users often ask multi-intent prompts such as:
- "hi, how many ideas do I have?"
- "how many ideas do I have, and show fitness ideas"

Single-intent classification ignores parts of such queries.

### Final implementation
- Added decomposition stage before routing.
- Splits compound messages into sub-queries.
- Classifies/routes each sub-query independently.
- Merges results into one context payload for RAG prompt.
- Uses dominant-intent priority to choose overall prompt strategy.

### Files created
- `backend/app/ai/query_decomposer.py`

### Files changed
- `backend/app/api/chat.py`
- `backend/app/services/rag_service.py`

### Dominant-intent priority
- `SEMANTIC_SEARCH` > `LISTING` > `COUNT` > `CONVERSATIONAL`

### Merging behavior
- ideas deduplicated by `_id`
- count value taken from count handler when present
- original raw query preserved

### Prompt-level improvements
- compound-mode instruction: answer all parts
- injected count fact when count + listing/semantic are combined

### Result
Multi-part user questions are answered more completely and consistently.

---

## Fix: Auth Refresh Reliability with Centralized Server API Client

### Why
Frontend route handlers were duplicating auth-forwarding logic. Middleware refresh also used wrong transport for refresh token, causing forced logout after token expiry.

### Final implementation
- Added shared server utility to handle:
  - auth forwarding
  - 401 refresh retry
  - new access-token cookie propagation
- Corrected middleware refresh request to send refresh token through cookie header.
- Migrated key BFF routes to shared utility.

### Files created
- `frontend/lib/server-api.ts`

### Files changed
- `frontend/middleware.ts`
- `frontend/app/api/ideas/create/route.ts`
- `frontend/app/api/ideas/[id]/route.ts`
- `frontend/app/api/ideas/image/route.ts`
- `frontend/app/api/profile/route.ts`
- `frontend/app/api/profile/avatar/route.ts`
- `frontend/app/api/profile/change-password/route.ts`
- `backend/app/main.py` (CORS PATCH allow-method correction)

### Result
Auth refresh is now centralized, consistent, and resilient across BFF routes.

---

## Feature: Task Management Under Ideas

### Why
Ideas needed actionable execution tracking directly inside idea detail pages.

### Architecture decision
Tasks are embedded inside idea documents (not separate collection) because the expected scale is small-to-medium per idea and single-document reads keep implementation simple.

### Final implementation
- Added backend task schemas and CRUD endpoints.
- Added BFF proxies for task endpoints.
- Added frontend task types and UI components.
- Added optimistic UI updates with rollback safeguards.
- Added task progress rendering in idea cards.

### Files created
- `backend/app/schemas/task.py`
- `backend/app/api/tasks.py`
- `frontend/app/api/ideas/[id]/tasks/route.ts`
- `frontend/app/api/ideas/[id]/tasks/[taskId]/route.ts`
- `frontend/types/task.ts`
- `frontend/components/tasks/TaskItem.tsx`
- `frontend/components/tasks/AddTaskForm.tsx`
- `frontend/components/tasks/TaskList.tsx`

### Files changed
- `backend/app/schemas/idea.py`
- `backend/app/main.py`
- `frontend/components/IdeaCard.tsx`
- `frontend/components/DashboardClient.tsx`
- `frontend/app/dashboard/ideas/[id]/page.tsx`

### Security and correctness decisions
- task endpoints always scope by authenticated `userId`
- ownership mismatch returns 403
- task create rate limit per user
- PATCH refetches persisted state after update
- DELETE checks modified count to detect missing task

### Result
Ideas now support full task lifecycle with safe backend controls and practical UX.

---

## Testing Guide (V3)

### Intent classifier
```bash
cd backend
source venv/bin/activate
python testFiles/test_intent_classifier.py --provider ollama
```

### Model tiering
```bash
cd backend
python testFiles/test_model_tiering.py
```

### Full chat SSE
```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "how many ideas do I have?"}' \
  --no-buffer
```

### Task CRUD
```bash
# Create
curl -X POST http://localhost:8000/api/ideas/{idea_id}/tasks \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"title": "Write landing page", "status": "todo"}'

# List
curl http://localhost:8000/api/ideas/{idea_id}/tasks \
  -H "Authorization: Bearer {token}"
```

---

## Final Outcome (V3)

V3 converted the system from a single-path RAG chat into a routed AI assistant with:
- intent-aware execution paths
- tiered model selection
- compound-query handling
- stronger auth refresh architecture
- embedded task management
- better observability and resilience from real-world debugging fixes

This release established the operational and architecture foundations that made the V4 agentic workflow possible.
