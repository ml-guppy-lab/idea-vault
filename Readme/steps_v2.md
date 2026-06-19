# Idea Vault — Version 2 Implementation Notes

---

## Fix: PKCE for Google OAuth

### Why
The original Google OAuth flow did not use PKCE. If an authorization code was intercepted, it could be exchanged for tokens.

PKCE adds a second secret (`code_verifier`) that is never sent in the front-channel authorization request. A stolen authorization code is useless without the matching verifier.

### Final implementation
- `GET /auth/google` now creates a strong `code_verifier` and S256 `code_challenge`.
- The verifier is stored in a server-side signed session cookie.
- `code_challenge` + `code_challenge_method=S256` are sent to Google.
- `GET /auth/google/callback` pops the verifier (one-time use) and passes it into token exchange.

### Files changed
- `backend/app/api/auth.py`
  - Added PKCE verifier/challenge generation in `/auth/google`
  - Added verifier usage + one-time pop in `/auth/google/callback`
- `backend/requirements.txt`
  - Added `pkce>=1.0.0`

### How the flow works
1. Browser hits `/auth/google`.
2. Backend generates verifier + challenge.
3. Backend stores verifier in server session.
4. Browser is redirected to Google with challenge.
5. Google redirects back with auth code.
6. Backend sends auth code + verifier to Google token endpoint.
7. Token exchange succeeds only if challenge/verifier match.

### Result
Google OAuth now has replay-resistant code exchange without changing the existing backchannel token architecture.

---

## Fix: BFF Token Hardening (Refresh Token Never Exposed to Browser JS)

### Why
In V1, refresh tokens were reachable by browser JavaScript:
- local login returned `{access_token, refresh_token}` in JSON
- OAuth callback carried tokens in URL query

That created XSS and log/history leakage risk.

### Security rule enforced
`refresh_token` must never appear in browser-visible JSON or URL parameters.

### Final implementation
- Backend sets refresh token only via `Set-Cookie` (`httpOnly`).
- `/refresh` and `/logout` read refresh token from request cookies.
- OAuth callback stores tokens temporarily in Redis and redirects with one-time `code` only.
- New token exchange endpoint consumes code once and sets cookies server-side.
- Next.js BFF routes handle server-to-server token exchanges and cookie propagation.

### Files changed
- `backend/app/api/auth.py`
  - `/login` returns only access token body + refresh cookie
  - `/refresh` reads cookie, not JSON body
  - `/logout` reads cookie + clears cookie
  - `/google/callback` stores tokens in Redis and redirects with one-time code
  - Added `/auth/google/token` one-time exchange endpoint
- `backend/app/schemas/user.py`
  - Removed no-longer-needed refresh/logout body schemas
- `frontend/app/api/auth/login/route.ts`
  - Added BFF login proxy with cookie handling
- `frontend/app/api/auth/refresh/route.ts`
  - Sends refresh token via `Cookie` header
- `frontend/app/api/auth/logout/route.ts`
  - Sends refresh token via `Cookie` header
- `frontend/app/api/auth/oauth-token/route.ts`
  - Exchanges one-time OAuth code server-to-server
- `frontend/app/api/auth/session/route.ts`
  - Simplified to access-token handling only
- `frontend/app/auth/callback/page.tsx`
  - Uses one-time code flow
- `frontend/components/auth/LoginForm.tsx`
  - Uses BFF login route

### Result
Refresh tokens never enter browser JS memory. OAuth tokens are no longer exposed in URL query params.

---

## Fix: Secure Image Uploads via Cloudinary

### Why
Images needed to be attached to ideas, but storage and validation had to be secure:
- no local filesystem persistence
- content validation by magic bytes (not file extension)
- server-generated filenames

### Final implementation
- Backend validates file size and MIME type from content bytes.
- Upload happens to Cloudinary using secure URL return.
- Frontend uploads image first, then sends `imageUrl` in idea payload.

### Files changed
- `backend/Dockerfile`
  - Added `libmagic1` runtime dependency
- `backend/requirements.txt`
  - Added `cloudinary` and `python-magic`
- `backend/app/core/config.py`
  - Added Cloudinary env config + setup method
- `backend/app/main.py`
  - Initializes Cloudinary on startup
- `backend/app/services/image_service.py`
  - Added `validate_and_upload_image()`
- `backend/app/api/ideas.py`
  - Added `POST /ideas/image`
- `backend/app/schemas/idea.py`
  - Added `imageUrl` fields in idea schemas
- `frontend/app/api/ideas/image/route.ts`
  - Added BFF image proxy
- `frontend/app/dashboard/ideas/new/page.tsx`
  - Added frontend validation + upload wiring
- `frontend/app/dashboard/ideas/[id]/page.tsx`
  - Added edit-mode upload wiring

### Upload flow
1. User selects file.
2. Frontend performs quick client checks (size/type).
3. Frontend posts multipart to BFF `/api/ideas/image`.
4. BFF forwards request with auth cookie-derived token.
5. Backend validates bytes + uploads to Cloudinary.
6. Backend returns secure URL.
7. Frontend includes URL in create/update payload.

### Required env vars
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

### Result
Images are validated and stored externally, with secure URLs persisted in MongoDB.

---

## Fix: Email Verification + Password Reset

### Why
Without verification and reset flows:
- unverified/incorrect emails could be used to register
- users had no recovery path

### Final implementation
- Added verification token lifecycle (issue, verify, resend).
- Added password reset lifecycle (forgot, token validate, reset).
- Login blocks unverified accounts.
- All email tokens are stored hashed (`sha256`) in DB.

### Backend changes
- Added Resend integration with async sending.
- Added user columns:
  - `email_verified`
  - `verification_token_hash`, `verification_token_expires`
  - `reset_token_hash`, `reset_token_expires`
- Added idempotent startup migrations for these fields.
- Added endpoints:
  - `POST /auth/register` (upsert-unverified behavior)
  - `GET /auth/verify-email`
  - `POST /auth/resend-verification`
  - `POST /auth/forgot-password`
  - `POST /auth/reset-password`

### Frontend changes
- Added pages:
  - `frontend/app/verify-email/page.tsx`
  - `frontend/app/forgot-password/page.tsx`
  - `frontend/app/reset-password/page.tsx`
- Added BFF routes for each flow.
- Updated signup/login forms for verification-aware UX.

### Important operational lessons
1. Unverified sender domains can silently drop email delivery.
2. Resend test mode restricts recipients without verified custom domain.
3. Uvicorn logging config can hide app logger output unless explicit handler is attached.
4. Upsert-unverified registration path prevents ghost-account dead ends.

### Required env vars
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `EMAIL_OVERRIDE_TO` (dev/testing only)

### Result
Verification and password recovery now follow production-grade security and UX patterns.

---

## Feature: Semantic Search via Embeddings (RAG Foundation)

### Why
Keyword search misses semantic matches (for example, "productivity tool" vs "focus timer"). Embeddings allow concept-level retrieval.

### Model decision
`all-MiniLM-L6-v2` was chosen for practical deployment trade-offs:
- much smaller footprint than `bge-m3`
- faster startup
- 384-dim vectors align with current Atlas index sizing

### Final implementation
- Embed `title + summary` (not full description/tags).
- Store embeddings in idea documents.
- Create/update paths generate embeddings in background tasks.
- Added one-shot backfill script for legacy ideas.

### Files changed
- `backend/requirements.txt`
  - Added `sentence-transformers>=3.0.0`
- `backend/app/services/embedding_service.py`
  - Added model cache + embedding helpers
- `backend/app/schemas/idea.py`
  - Added required `summary` field
- `backend/app/api/ideas.py`
  - Added async background embedding path for create/update
- `backend/scripts/backfill_embeddings.py`
  - Added idempotent backfill script
- `frontend/app/dashboard/ideas/new/page.tsx`
  - Added summary field + word count UX
- `frontend/app/dashboard/ideas/[id]/page.tsx`
  - Added same summary behavior in edit flow

### Result
Semantic retrieval pipeline is in place with manageable resource usage and migration path via backfill.

---

## Feature: LLM Provider Abstraction Layer

### Why
The app needs easy provider switching:
- local dev with Ollama
- cloud deploy with OpenRouter
- future expansion to OpenAI/Anthropic

### Final implementation
- Added unified config layer that resolves provider-specific:
  - `base_url`
  - `api_key`
  - `model`
  - `fallback_model` (OpenRouter)
  - required extra headers

### Files changed
- `backend/app/core/llm_config.py`
  - Added provider enum/config resolution/singleton
- `backend/app/core/config.py`
  - Added provider env configuration fields

### Notable behavior
- OpenRouter can fallback to secondary model on 429.
- Docker uses `host.docker.internal` for Ollama connectivity.

### Required env vars
- `LLM_PROVIDER`
- `LLM_OLLAMA_MODEL`
- `LLM_OPENROUTER_MODEL`
- `LLM_OPENROUTER_FALLBACK_MODEL`
- `OPENROUTER_API_KEY` (+ optional OpenAI/Anthropic keys)

### Result
Model provider can be changed with env config instead of code changes.

---

## Feature: RAG Chat Pipeline + SSE Endpoint

### Why
Text-only request/response chat feels slow for LLM generation. SSE enables token streaming and better UX.

### Final implementation
- Added vector search service for semantic retrieval.
- Added RAG service as async generator.
- Added SSE chat endpoint with auth and rate limiting.
- Added fallback for meta-queries (recent ideas when semantic match is empty).

### Files changed
- `backend/app/services/vector_search.py`
- `backend/app/services/rag_service.py`
- `backend/app/schemas/chat.py`
- `backend/app/api/chat.py`
- `backend/app/main.py` (router wiring)
- `backend/app/api/ideas.py` (embedding error logging hardening)

### SSE event model
- `status`
- `text`
- `done`
- `error`

### Reliability safeguards
- rate limit checked before opening stream
- `try/except` around generator flow to emit explicit error events
- retry + fallback model flow on provider 429s

### Result
Users receive grounded answers in streaming format with better responsiveness and safer failure behavior.

---

## Feature: Frontend Chat UI (Widget + Full Page)

### Why
Users need both:
- quick inline chat from dashboard
- full-page chat session for longer interaction

### Final implementation
- Added BFF SSE proxy for `/api/chat`.
- Added token-by-token rendering components.
- Added shared message persistence via sessionStorage.
- Added full page at `/dashboard/chat` and dashboard floating widget.

### Files changed
- `frontend/app/api/chat/route.ts`
- `frontend/components/chat/StreamingText.tsx`
- `frontend/components/chat/MessageBubble.tsx`
- `frontend/components/chat/ChatInput.tsx`
- `frontend/components/chat/ChatWindow.tsx`
- `frontend/app/dashboard/chat/page.tsx`
- `frontend/components/Navbar.tsx`
- `frontend/components/DashboardClient.tsx`
- `frontend/app/globals.css`

### Key UX details
- widget and full page share same session key so history persists when navigating
- `Enter` submits, `Shift+Enter` creates newline
- status indicators and streaming cursor improve perceived responsiveness

### Result
V2 ships a complete full-stack conversational experience with secure auth handling and robust retrieval-backed responses.
