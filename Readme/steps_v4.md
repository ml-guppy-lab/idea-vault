## Idea Vault — Version 4 Implementation Notes

---

## Embeddings: Local Model -> API

### Why
The old embedding setup loaded `sentence-transformers/all-MiniLM-L6-v2` inside the backend process. That was fine locally, but it pushed the server too close to Render's memory limit and caused OOM crashes.

### What we tried first
We tried Cohere and then Hugging Face raw API calls. Both worked in theory, but the network path was not reliable in this environment, so the backfill could not complete consistently.

### Final approach
We kept the embedding idea but moved the actual generation to Hugging Face Inference Providers through the official `huggingface_hub` client. That keeps the backend lightweight and avoids loading any local embedding model into memory.

### How it works now
- `generate_embedding()` creates a 384-dim embedding for idea text.
- `generate_query_embedding()` uses the same model for search queries.
- `generate_idea_embedding(title, summary)` combines the title and summary before embedding.
- The MongoDB Atlas vector index was rebuilt for `384` dimensions, with `userId` as the filter field.
- Existing ideas were reprocessed with `backend/scripts/backfill_embeddings.py` so all old MiniLM vectors were replaced.

### Files changed
- `backend/app/services/embedding_service.py` — switched to Hugging Face hosted embeddings
- `backend/app/core/config.py` — added `EMBEDDING_PROVIDER` and `HUGGINGFACE_API_TOKEN`
- `backend/requirements.txt` — added `huggingface_hub`
- `backend/scripts/backfill_embeddings.py` — re-embedded all existing ideas
- `backend/.env` — added Hugging Face token and embedding provider setting

### Result
The backend no longer loads a local embedding model, memory use is lower, and the idea search flow still works with the same semantic search pipeline.

---

## Fix: Mobile-Inaccessible Task Delete Button

### Problem
Task delete was hover-only (`group-hover`) so it was effectively hidden on touch devices (no persistent hover state).

### Why previous behavior failed
Hover interactions work for mouse pointers, but phones/tablets do not have a real pre-click hover phase. This made delete hard or impossible to access on mobile.

### Final implementation
- Keep desktop behavior (clean UI, show actions on hover).
- Make delete always visible on mobile.

### Change made
- `frontend/components/tasks/TaskItem.tsx`
	- from: `opacity-0 group-hover:opacity-100`
	- to: `opacity-100 md:opacity-0 md:group-hover:opacity-100`

### Result
Delete is reliably visible on mobile while desktop keeps the original hover polish.

---

## Fix: Chat Input Focus + React Hydration Noise

### Problem
Chat input needed auto-focus on open, but adding raw `autoFocus` in SSR UI triggered a production hydration warning (React minified error #418 in console).

### Why this happened
The server-rendered markup and first client render diverged around focus/DOM state during hydration.

### Final implementation
- Focus is handled after mount using client-side effect only.
- Removed raw `autoFocus` attribute from the textarea to avoid SSR/client mismatch.

### Changes made
- `frontend/components/chat/ChatInput.tsx`
	- Added mount-time focus via `useEffect` + `requestAnimationFrame`
	- Removed JSX `autoFocus` attribute

### Result
Input still auto-focuses in practice, and console hydration noise is removed.

---

## Fix: Render + Neon PostgreSQL Startup Failures

### Problems observed
- Render startup failed with DB connection errors while moving from expired Render free Postgres to Neon.
- Errors included:
	- `TypeError: connect() got an unexpected keyword argument 'sslmode'`
	- authentication/format mismatches from provider-specific URL params.

### Why this happened
Neon connection URLs include parameters that are valid for psycopg-style clients (`sslmode`, `channel_binding`) but can break SQLAlchemy asyncpg flows when passed through unchanged.

### Final implementation
Normalize DB URLs before creating the async engine:
- Force async scheme when needed (`postgresql` -> `postgresql+asyncpg`).
- Strip unsupported query params (`sslmode`, `channel_binding`, `ssl`) from URL.
- Pass SSL correctly via `connect_args` (`ssl` context) for asyncpg.

### Changes made
- `backend/app/db/postgres.py`
	- Added `_build_engine_url(raw_url)` helper
	- Engine now created from normalized URL + asyncpg-safe `connect_args`

### Result
Backend startup is resilient to common Neon/Render connection string formats, reducing deployment-time DB dialect issues.

---

## Fix: Proactive Token Refresh Before SSE Stream

### Problem
A regular API call that gets a 401 can be retried after refreshing the token — it's just a request. An SSE stream cannot. Once the stream is open and the access token expires mid-response, the stream closes with a 401 error and the user sees a broken chat. There is no way to resume it.

### Why the reactive interceptor is not enough here
The existing Axios refresh interceptor catches 401s on normal requests and retries them transparently. SSE streams bypass Axios — they use the browser's `fetch` API directly, and retrying a stream means starting a completely new one from scratch, which loses context.

### Solution — refresh before opening the stream
Check token expiry **before** the SSE connection is established. If the token expires within 2 minutes, refresh it silently first, then open the stream with the fresh token. The user never sees anything — it happens in the BFF route before the response starts.

### How token expiry is checked (no library needed)
JWTs contain a Base64url-encoded JSON payload with an `exp` claim (unix timestamp). Decoding it is a one-liner — no crypto library required. Signature verification still happens on FastAPI; this is just a local read of a claim we already trust.

### Failure handling
If the proactive refresh fails (revoked session, network blip), the route continues with the existing token. FastAPI will return a 401 if the token is truly expired, and the client-side interceptor handles it as normal. No silent failure, no crash.

### Cookie propagation
When a proactive refresh fires and succeeds, the new `access_token` is set as a `Set-Cookie` header on the SSE response itself. The browser's httpOnly cookie is updated immediately — no second round-trip needed.

### Files changed
- `frontend/app/api/chat/route.ts`
  - Added `getTokenExp()` — decodes `exp` claim from JWT payload locally
  - Added `isExpiringSoon()` — returns true if token expires within 120 seconds
  - Added `proactiveRefresh()` — calls FastAPI refresh server-to-server, same pattern as all other BFF routes
  - Stream response now carries `Set-Cookie` header when a proactive refresh happened

### Result
The chat SSE stream never encounters a mid-stream 401 under normal usage. Token lifetime is transparent to the user.

---

## Fix: Graceful Session Expiry in Chat

### Problem
When both the access token and the refresh token are expired, the chat BFF returns 401. The existing error handling showed a generic red banner with no guidance — the user had no idea they needed to log in again.

### Why a separate state (not just the error string)
A session-expired 401 needs a different UI response from other errors (429 rate limit, 500 server error, network failure). Detecting it via string-matching on the error message is fragile. A dedicated `sessionExpired` boolean keeps the two paths explicit and independent.

### What happens now
- 401 response → incomplete assistant bubble removed → `sessionExpired` banner shown.
- Banner displays a plain-language message and a "Log in" link that navigates to `/login`.
- All other errors (non-401) still use the existing generic error banner.
- `clearChat()` resets both `error` and `sessionExpired` so the UI is clean if the user returns after logging in.

### Files changed
- `frontend/components/chat/ChatWindow.tsx`
  - Added `sessionExpired` state (boolean)
  - 401 branch in `sendMessage` sets `sessionExpired` instead of throwing a generic error
  - Session-expired banner rendered separately from the generic error banner
  - `clearChat()` resets `sessionExpired`

### Result
Users see a clear, actionable message when their session expires rather than a confusing generic error.

---

## Fix: Hosted Embeddings Failed Because `numpy` Was Missing

### Problem
Idea creation succeeded, but embedding generation failed in the background and semantic search queries returned an error. The backend log showed:

`ImportError: Please install numpy to use deal with embeddings (pip install numpy).`

### Why this happened
The app switched from a local sentence-transformers model to Hugging Face Inference Providers, but `huggingface_hub`'s `feature_extraction()` helper still depends on `numpy` locally to process the embedding response.

### Final implementation
- Add `numpy` to backend dependencies.
- Rebuild the backend image so the package is installed in Docker/Render.
- Re-run embedding backfill for any ideas that were saved while embeddings were failing.

### Files changed
- `backend/requirements.txt`
	- Added `numpy>=1.26.0`

### Result
New ideas now embed successfully, background embedding no longer crashes, and semantic search works again.

---

## Fix: Raw Backend Exceptions Leaked Into Chat UI

### Problem
When chat-related backend failures occurred, the SSE error event included the raw Python exception text. Users could see internal implementation details like dependency/import errors, which is not acceptable for a production-style app.

### Why this was wrong
Internal stack or exception details belong in backend logs, not the UI. The UI should show a safe, professional message while developers still get full tracebacks server-side.

### Final implementation
- Replace user-facing exception strings with a neutral message:
	- `Something went wrong. Please try again.`
- Log the full exception and traceback on the backend with `logger.exception()`.
- Keep the existing rate-limit message unchanged because it is already safe and useful to users.

### Files changed
- `backend/app/api/chat.py`
	- Sanitized decompose/route failure sent through SSE
	- Added backend logging with full traceback
- `backend/app/services/rag_service.py`
	- Sanitized unexpected LLM stream creation failures
	- Added backend logging with full traceback

### Result
Users no longer see raw technical errors in chat, while developers still get complete debugging detail in backend logs.

---

## Fix: Prevent Duplicate Accounts When Local + Google Use the Same Email

### Problem
The app originally treated `auth_provider` as a single source of truth for identity. That breaks down when a user signs up with email/password first and later signs in with Google using the same email. Without account linking, the app risks creating or treating that as a separate auth identity, which would strand the user's MongoDB ideas under the original UUID.

### Why this needed a schema change
A single `auth_provider` field can only answer “what provider was used?” It cannot represent “this one user has linked both local and Google auth.” To support linking safely, the user record needs:
- a stable Google identifier (`google_id`) from Google's `sub` claim
- a list of linked providers (`auth_providers`)

### Final implementation
- Keep `auth_provider` for backward compatibility as the latest/active provider label.
- Add `google_id` to identify the Google account by stable subject ID, not just email.
- Add `auth_providers` to store all linked providers, e.g. `['local', 'google']`.
- In Google OAuth callback:
	- look up by `google_id` first
	- if not found, look up by email
	- if email exists, link Google to that existing user instead of creating a new user row
	- only create a new user when neither lookup matches

### Migration strategy
- Startup migration adds `google_id` and `auth_providers` if missing
- Existing users are backfilled so `auth_providers` starts as `[auth_provider]`
- A unique partial index is added on `google_id` for non-null values

### Password-management consequence
Once an account is linked to both providers, it should still be allowed to change its local password. So password checks can no longer rely on `auth_provider == 'local'` alone. They must check whether `'local'` is present in `auth_providers`.

### Files changed
- `backend/app/models/user.py`
	- Added `google_id`
	- Added `auth_providers`
- `backend/app/db/postgres.py`
	- Added idempotent column migration for linked-auth fields
	- Added partial unique index for `google_id`
	- Backfilled `auth_providers` from legacy `auth_provider`
- `backend/app/api/auth.py`
	- Google callback now links by `google_id` / email instead of treating provider as a separate identity
	- Local/Google logins preserve `auth_providers`
- `backend/app/api/profile.py`
	- Password change now checks for linked local auth, not just current provider
- `backend/app/schemas/user.py`
	- Added `auth_providers` to profile/user responses
- `frontend/app/dashboard/profile/page.tsx`
	- Profile UI now understands linked providers and only hides password controls for pure-Google accounts

### Result
One email now maps to one account/UUID even if the user signs in with both local auth and Google. Existing ideas remain reachable, and linked accounts keep the correct password-management behavior.

---

## Agentic AI Backend: One Agent, Multiple Tools, Human Approval Before Writes

### Why this feature was added
The existing app could already store ideas, search ideas, and run a chat flow. The next step was to make the system feel more like an assistant that can take structured action.

The goal was **not** to build a swarm of agents. The goal was to build **one backend agent** that can:
- understand a user request
- look up the user's existing ideas
- decide when a change should be proposed
- return a structured proposal instead of mutating data immediately
- wait for explicit user approval before writing anything to MongoDB

This is a simple but real agentic pattern:
- an LLM reasons over the request
- the LLM can call tools
- some tools are safe to execute immediately
- some tools are write-intents and therefore require a human decision

That makes the feature useful without giving the model direct write access.

### High-level architecture
This implementation is **one agent with multiple tools**, not multiple agents.

The components are:

1. **Tool contract layer**
	- Defines what tools the LLM is allowed to call.
	- File: `backend/app/services/agentic_ai/agent_tools.py`

2. **Schema layer**
	- Defines what a valid proposal looks like.
	- File: `backend/app/schemas/agent.py`

3. **Agent service layer**
	- Runs the LLM loop, executes read tools, creates proposals, and applies approved proposals.
	- File: `backend/app/services/agentic_ai/agent_service.py`

4. **API layer**
	- Exposes the agent endpoints to Swagger and the frontend.
	- File: `backend/app/api/agent.py`

5. **Existing app services reused by the agent**
	- MongoDB access
	- semantic search / vector search
	- embeddings refresh on idea updates
	- user authentication from JWT

So the agent was not built as a separate mini-application. It sits on top of the current backend and reuses the app's real business logic.

### The core design principle: propose first, write later
The most important design decision in this feature is that the agent does **not** write to the database during the first `/api/agent` call.

That request is read-only from a data-mutation perspective.

Instead, the first call returns:
- a normal assistant message
- zero or more structured proposals

Only after the user explicitly accepts one proposal does the backend execute the write.

This gives three major benefits:

1. **Safety**
	- The model cannot silently rename ideas or create tasks.

2. **Auditability**
	- The user can see exactly what the model wants to change.

3. **Better UX**
	- The proposal contains the current and new values, so the UI can show a clear diff.

This is the reason the implementation is called **human-in-the-loop**.

### Tools exposed to the LLM
The agent currently has four tools.

#### 1. `search_ideas`
Purpose:
- search the user's existing ideas before making a proposal

Why it is safe:
- it only reads data
- it does not mutate anything

How it behaves:
- the model passes a text query
- the backend uses semantic search behavior already present in the app
- if vector search finds nothing, the backend falls back to recent ideas

This fallback matters because generic prompts like:
- `improve my first idea`
- `help me refine my ideas`

may not semantically match a specific idea strongly enough to pass the vector threshold.

#### 2. `propose_idea_update`
Purpose:
- suggest changes to an existing idea

Expected payload includes:
- `idea_id`
- `current_title`
- `new_title`
- optional description/status/priority changes
- `reasoning`

Important rule:
- the model should search first so it uses a real `idea_id` and real current content

#### 3. `propose_idea_creation`
Purpose:
- propose a brand new idea for the user

Expected payload includes:
- `title`
- `description`
- optional `status`
- optional `priority`
- optional `tags`
- `reasoning`

#### 4. `propose_task_creation`
Purpose:
- propose a new task under an existing idea

Expected payload includes:
- `idea_id`
- `idea_title`
- `task_title`
- optional `task_description`
- `reasoning`

### Read tools vs proposal tools
The tools are intentionally split into two groups.

#### Read-only tools
Current member:
- `search_ideas`

These execute immediately inside the agent loop because they do not change user data.

#### Proposal tools
Current members:
- `propose_idea_update`
- `propose_idea_creation`
- `propose_task_creation`

These do **not** execute immediately. The backend converts their arguments into typed proposal objects and returns them to the user for approval.

This separation is the backbone of the safety model.

### Proposal schema design
The proposal models live in `backend/app/schemas/agent.py`.

There are three concrete proposal models:
- `IdeaUpdateProposal`
- `IdeaCreationProposal`
- `TaskCreationProposal`

All of them are wrapped in a discriminated union called `Proposal`.

That means every proposal must include:
- `proposal_type`

The backend uses `proposal_type` to decide which schema to parse.

This is why a payload like `{}` fails validation for `proposal`: the parser cannot infer which proposal shape it is supposed to be.

#### Why the discriminated union was useful
It gave a strong contract for:
- backend validation
- Swagger schema generation
- frontend rendering
- future expansion to new proposal types

It also helped catch malformed approve/reject payloads during testing instead of allowing silent bad writes.

### API surface
Two endpoints were added.

#### `POST /api/agent`
Purpose:
- run one agent turn for the authenticated user

Input:
- the same `ChatRequest` shape used elsewhere, mainly a `message`

Output:
- `message`: assistant explanation
- `proposals`: array of typed pending proposals

Important behavior:
- no database write happens here

#### `POST /api/agent/decide`
Purpose:
- accept or reject one proposal

Input shape:
- `proposal_id`
- `decision` = `accept` or `reject`
- `proposal` only required when decision is `accept`

Behavior:
- reject: returns success, changes nothing
- accept: executes exactly one approved proposal under the authenticated user's scope

### How one full agent turn works internally
The heart of the system is `run_agent()` in `backend/app/services/agentic_ai/agent_service.py`.

The flow is:

1. Build the initial message list
	- system prompt
	- user's message

2. Send the request to the LLM with the tool definitions
	- tool choice is `auto`
	- the model can either answer directly or call tools

3. If the model answers directly
	- finish and return the message

4. If the model calls tools
	- save the assistant tool-call step into message history
	- execute each tool according to its category

5. For read-only tools
	- execute immediately
	- serialize the tool result to JSON
	- append it as a tool message back into the conversation

6. For proposal tools
	- do not write to the database
	- convert raw tool arguments into typed proposal objects
	- store them in the `proposals` list
	- return a small `proposal_created` tool result into message history

7. Ask the model for a final user-facing summary
	- especially useful when the model created proposals

8. Return `AgentResponse`
	- final message
	- proposals array

The loop is capped at 3 turns so it cannot keep looping indefinitely.

### Why the agent stores tool calls in message history
When a tool call happens, the backend converts the SDK's tool-call objects into plain dictionaries and appends them to the ongoing `messages` list.

This matters because the next model call needs to see:
- what it previously decided
- which tools it called
- what those tools returned

Without that history, the model would lose context between steps and could not reason reliably over retrieved ideas or created proposals.

### Why proposal IDs are generated server-side
Each proposal gets a UUID generated on the backend.

That decision makes approval cleaner because:
- the frontend gets a stable identifier for each pending proposal
- accept/reject calls can refer to a concrete proposal
- the ID is not invented by the model

This keeps proposal tracking deterministic and avoids trusting the model for control-plane identifiers.

### How approved proposals are executed
The write path lives in `execute_proposal()`.

This function is intentionally the **only** place in the service that mutates MongoDB for the agent flow.

That makes the system easier to reason about:
- `run_agent()` = reasoning + safe reads + proposal generation
- `execute_proposal()` = actual writes after approval

#### Idea update path
When an idea update is accepted, the backend:
- parses the `idea_id` into a Mongo `ObjectId`
- checks ownership with `_id` + `userId`
- builds an update document
- writes title/description/status/priority changes
- refreshes `updatedAt`

There is also an embedding-refresh step if the title changes.

Why that exists:
- semantic search depends on embeddings
- if the idea title changes significantly, the old embedding may no longer represent the idea well

So after approval, the backend attempts to regenerate the embedding and store it.

#### Idea creation path
When an idea creation proposal is accepted, the backend creates a new Mongo idea document under the authenticated user's `userId`.

#### Task creation path
When a task proposal is accepted, the backend:
- validates the parent idea belongs to the user
- creates a new task object
- appends it to that idea's embedded tasks array

### Security model
This implementation was designed so the model has limited power.

#### What the model can do
- interpret user intent
- call approved tools
- suggest structured changes

#### What the model cannot do directly
- write to MongoDB on the first call
- bypass user ownership checks
- invent trusted user identity
- update another user's ideas

#### How user scoping is enforced
Every important path uses the authenticated user from the JWT-derived backend user object.

The client never supplies `userId` for the agent.

That means:
- reads are scoped to the authenticated user's ideas
- writes are also scoped to that same user

Even if the model produces a valid-looking `idea_id`, the backend still checks ownership before applying any update.

### LLM provider behavior and fallback
The agent uses the same OpenAI-compatible client pattern already used elsewhere in the backend.

For OpenRouter specifically, free-tier models can hit temporary 429 rate limits.

To make the agent resilient, the service now:
- retries transient `RateLimitError` failures
- uses exponential backoff
- switches to the configured fallback model if retries still fail

This was necessary because the initial implementation would crash `/api/agent` if the primary free model was rate-limited.

### Search behavior and why the first implementation was misleading
One of the most important debugging lessons from this feature was that the agent's first search implementation was **too strict**.

Originally, the `search_ideas` tool called vector search directly.

That caused a bad user experience for generic requests such as:
- `Can you improve my first idea?`

Why it failed:
- vector search tries to find semantically similar idea content
- a vague query may not match any stored idea strongly enough
- the tool returned an empty list
- the model interpreted that as `you have no ideas`

The fix was to reuse the app's existing semantic-search handler, which already falls back to recent ideas if vector search returns nothing.

That aligned the agent with the rest of the backend and made the tool far more reliable for natural user requests.

### JSON serialization issue that appeared during testing
The first live test of `/api/agent` failed because the tool result contained MongoDB datetimes.

What happened:
- `search_ideas` returned idea documents
- those documents included `createdAt` and `updatedAt`
- the backend tried to `json.dumps()` the tool result before feeding it back to the LLM
- Python raised `TypeError: Object of type datetime is not JSON serializable`

The fix was to add a helper that recursively converts datetime objects to ISO strings before serializing tool results.

This is an important agent implementation detail: tool outputs often need normalization before they are safe to pass back into the LLM conversation.

### Swagger testing lessons
Swagger was useful for validating the backend contracts, but it also exposed where the request shapes can be confusing.

#### Reject payload shape
For rejection, this works:

```json
{
  "proposal_id": "...",
  "decision": "reject"
}
```

This also works:

```json
{
  "proposal_id": "...",
  "decision": "reject",
  "proposal": null
}
```

This fails:

```json
{
  "proposal_id": "...",
  "decision": "reject",
  "proposal": {}
}
```

Why:
- `proposal` is a discriminated union
- `{}` has no `proposal_type`
- the parser cannot decide which proposal schema to use

#### Accept payload shape
For acceptance, `proposal` must be **one proposal object**, not the whole `proposals` array and not a nested decision wrapper.

Correct pattern:

```json
{
  "proposal_id": "...",
  "decision": "accept",
  "proposal": {
    "proposal_type": "idea_update",
    "proposal_id": "...",
    "status": "pending",
    "idea_id": "...",
    "current_title": "...",
    "new_title": "...",
    "current_description": "...",
    "new_description": "...",
    "new_status": null,
    "new_priority": null,
    "reasoning": "..."
  }
}
```

Incorrect patterns that were hit during testing:
- invalid JSON syntax such as `{"proposal": {[ ... ]}}`
- wrapping a whole decision payload inside `proposal`
- sending the `proposals` array item as an array instead of a single object

### Why this is already a real agentic workflow
For a beginner, it is useful to separate hype from what was actually built.

This backend is genuinely agentic because:
- the model has a toolset
- the model chooses when to use tools
- tool results are fed back into the reasoning loop
- the model can produce structured action plans
- actions are separated into safe reads vs gated writes

What it is **not**:
- not a fully autonomous system
- not a multi-agent architecture
- not long-running planning with memory across many sessions

This is a strong first agentic AI implementation because it demonstrates the most important primitive clearly:

**LLM reasoning + tool use + structured proposals + human approval + controlled execution**

### Files involved in the implementation
- `backend/app/services/agentic_ai/agent_tools.py`
	- tool contracts sent to the LLM
- `backend/app/schemas/agent.py`
	- proposal models, union types, response/decision contracts
- `backend/app/services/agentic_ai/agent_service.py`
	- main agent loop, tool execution, proposal building, proposal execution, rate-limit fallback, JSON-safe serialization
- `backend/app/api/agent.py`
	- HTTP endpoints for running the agent and deciding on proposals
- `backend/app/main.py`
	- router registration
- `backend/app/ai/handlers.py`
	- semantic search fallback reused by the agent's read tool

### Final result
The backend now supports a production-style beginner-safe agent workflow:
- users can ask the assistant to improve ideas, create ideas, or suggest tasks
- the model can inspect the user's real data before suggesting changes
- no write happens without explicit approval
- accepted proposals are executed under proper user scoping
- the service handles rate limits more gracefully
- generic search requests no longer incorrectly imply the vault is empty
- tool results are serialized safely for the LLM loop

This is a good foundation for a future frontend proposal-review experience, because the backend contracts are now explicit and tested.

---

## Agentic AI Frontend: Non-Streaming Agent Chat + Proposal Review UI

### Why a separate frontend mode was needed
The existing chat page was built for streaming RAG responses. That works well when the output is only text.

Agent responses are different. They need to return:
- assistant text
- a structured `proposals` array

Because proposal objects must arrive as valid JSON, the agent frontend was built as a non-streaming request/response UI. The user sees a loading indicator while the backend prepares both text and proposals.

This keeps implementation simpler and more reliable while preserving the human-in-the-loop review flow.

### Two chat modes (important UX decision)
The app now has two separate AI experiences:

1. **Vault AI** (`/dashboard/chat`)
	- RAG-style, read-only assistant
	- streaming text tokens via SSE

2. **Vault AI Agent** (`/dashboard/agent`)
	- proposal-oriented assistant
	- non-streaming JSON response with text + proposals
	- explicit Accept/Reject controls

Keeping these modes separate avoids user confusion about whether the current conversation can change data.

---

## Diff + Proposal Components

### `DiffView` component
File: `frontend/components/agent/DiffView.tsx`

Purpose:
- render before/after changes in a GitHub-style visual diff pattern

Behavior:
- if old and new values are identical, render nothing
- old value uses red styling + strikethrough
- new value uses green styling
- responsive layout: stacks on small screens, two-column on larger screens

Why this matters:
- it makes proposal review understandable at a glance
- it reduces accidental approvals because users can clearly see what changed

### `ProposalCard` component
File: `frontend/components/agent/ProposalCard.tsx`

Purpose:
- render one proposal with context, diff/details, reasoning, and Accept/Reject actions

Proposal types handled:
- `idea_update`
- `idea_creation`
- `task_creation`

Key UI states:
- pending review
- accepting (button loading state)
- accepted confirmation
- rejected confirmation

Why this structure was chosen:
- each proposal is self-contained
- each proposal can be approved/rejected independently
- card-level status updates keep interaction feedback immediate

---

## Agent Chat Window (frontend)

### `AgentChatWindow`
File: `frontend/components/agent/AgentChatWindow.tsx`

Responsibilities:
- render user and assistant messages
- call BFF endpoint `/api/agent` (non-streaming)
- attach proposals to assistant messages
- render proposal cards under assistant message bubbles
- send proposal decisions to `/api/agent/decide`

Important implementation details:
- uses existing `ChatInput` and `MessageBubble` components for visual consistency
- uses loading dots while waiting for backend response
- includes suggested action buttons to guide first-time users
- handles 401 with a clear session-expired message
- parses backend error payload defensively (`detail`, `error`, fallback message)

Reasoning for non-streaming behavior:
- agent endpoint returns structured JSON, not token stream
- streaming mixed text + object payloads adds complexity without clear benefit here

---

## Next.js BFF Routes for Agent

### Files added
- `frontend/app/api/agent/route.ts`
- `frontend/app/api/agent/decide/route.ts`

### Why these routes exist
The browser should not call FastAPI directly with bearer tokens in JS-managed storage.

These BFF routes:
- read auth from secure cookies through the server
- forward requests to FastAPI
- return backend response with stable status mapping
- preserve refresh behavior by reusing central server fetch utilities

### Engineering decision (important)
Instead of custom per-route token plumbing, these routes reuse:
- `apiFetch()`
- `applyNewToken()`

This keeps auth refresh and cookie propagation consistent with the rest of the app and avoids duplicate logic.

---

## Agent Page + Navigation

### New page
File: `frontend/app/dashboard/agent/page.tsx`

What it does:
- renders a dedicated full-page container for agent mode
- title: `Vault AI Agent`
- subtitle: `Propose changes to your ideas - you always decide what gets applied.`
- mounts `AgentChatWindow`

### Navbar update
File: `frontend/components/Navbar.tsx`

Change:
- added a new `AI Agent` nav item (`/dashboard/agent`) with `Bot` icon
- kept existing `Vault AI` nav item (`/dashboard/chat`) unchanged

Result:
- users can intentionally choose read-only chat vs proposal-based agent mode

---

## Preview / Test Surface

### Proposal preview page
File: `frontend/app/dashboard/agent-preview/page.tsx`

Purpose:
- quick visual test page with sample proposal data
- allows validating card states and diff rendering without backend calls

Use case:
- useful for UI iteration when backend is unavailable or rate-limited

---

## Reliability Notes from Real Testing

### OpenRouter free-tier limits can still fail even with fallback
Observed behavior during testing:
- primary model rate-limited (429)
- fallback model attempted
- fallback can also be rate-limited under provider free quota windows

Implication:
- retries + fallback improve reliability but do not guarantee success when all selected models share free-tier pressure

Mitigations:
- keep user-facing errors safe and actionable
- consider paid/BYOK configuration for stable usage
- keep fallback model configurable through environment settings

---

## End-to-End Agentic Flow (Backend + Frontend)

1. User opens `/dashboard/agent` and sends a request.
2. Frontend BFF calls `POST /api/agent` on backend.
3. Backend agent reasons, may call tools, and returns:
	- assistant `message`
	- `proposals[]`
4. Frontend renders assistant message and proposal cards.
5. User reviews diffs and reasoning.
6. User chooses:
	- Reject: UI state updates, no DB mutation.
	- Accept: frontend calls `POST /api/agent/decide` with full proposal payload.
7. Backend executes approved proposal under authenticated user scope.
8. Frontend shows success/rejection state in the proposal card.

This completes the human-in-the-loop pattern in production-style UX.

---

## Files Added or Updated for Agent Frontend

- `frontend/components/agent/DiffView.tsx`
	- before/after diff renderer
- `frontend/components/agent/ProposalCard.tsx`
	- per-proposal review + accept/reject controls
- `frontend/components/agent/AgentChatWindow.tsx`
	- non-streaming agent chat experience with proposal rendering
- `frontend/app/api/agent/route.ts`
	- BFF proxy for agent run endpoint
- `frontend/app/api/agent/decide/route.ts`
	- BFF proxy for proposal decision endpoint
- `frontend/app/dashboard/agent/page.tsx`
	- dedicated agent mode page
- `frontend/components/Navbar.tsx`
	- added `AI Agent` nav link
- `frontend/app/dashboard/agent-preview/page.tsx`
	- sample-data visual test page for proposal UI

---

## Final Outcome (Agentic AI v4)

The project now has a complete agentic AI flow with clear separation of concerns:

- backend agent reasoning + tool orchestration
- strict human approval before writes
- frontend proposal diffs and per-proposal controls
- secure BFF integration with centralized token refresh behavior
- distinct UX modes for read-only AI chat vs change-proposing AI agent

This implementation is beginner-friendly to understand, production-minded in structure, and strong for portfolio demonstration because it shows full-stack agentic patterns, not just prompt wiring.
