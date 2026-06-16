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
