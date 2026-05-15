# Idea Vault — Version 2 Implementation Notes

## 1. PKCE for Google OAuth

**Why:** The existing Google OAuth flow had no PKCE. If an attacker intercepted the authorization code in transit, they could exchange it for tokens. PKCE makes the stolen code useless without the corresponding verifier.

**What changed:**
- `backend/app/api/auth.py` — `GET /auth/google`: generates a 128-char URL-safe `code_verifier` via the `pkce` library, derives the S256 `code_challenge`, stores the verifier in the **server-side signed session cookie** (never exposed to the browser), and passes `code_challenge + code_challenge_method=S256` to Google.
- `GET /auth/google/callback`: pops the verifier from the session (one-time use → replay-safe), passes it to `authorize_access_token()`. Google re-derives the challenge and rejects any mismatch.
- `backend/requirements.txt`: added `pkce>=1.0.0`.

**Flow:** Browser → `/auth/google` → backend stores verifier in session → Google → `/auth/google/callback` → backend sends verifier to Google's token endpoint → token issued only if challenge matches.

The backchannel architecture (browser never touches Google's tokens) was preserved unchanged.

---

## 2. BFF — Refresh Token Never Reaches the Browser

**Why (the problem):** In V1, `/login` returned `{access_token, refresh_token}` in the JSON body. Browser JS read both, then POSTed them to `/api/auth/session`. The `refresh_token` briefly lived in JS memory — an XSS window. Google OAuth was worse: both tokens were in the redirect URL (`?access_token=...&refresh_token=...`), ending up in browser history and server logs.

**Rule enforced:** `refresh_token` must never appear in any JSON response body or URL reachable by browser JS.

**What changed:**

| File | Change |
|---|---|
| `backend/app/api/auth.py` — `/login` | Sets `refresh_token` via `Set-Cookie` (httpOnly), returns only `{access_token}` in body |
| `backend/app/api/auth.py` — `/refresh` | Reads `refresh_token` from `request.cookies` instead of JSON body |
| `backend/app/api/auth.py` — `/logout` | Reads `refresh_token` from `request.cookies`, clears cookie via `response.delete_cookie()` |
| `backend/app/api/auth.py` — `/google/callback` | Stores both tokens in Redis under a UUID (60s TTL), redirects with `?code=<uuid>` only |
| `backend/app/api/auth.py` — `GET /auth/google/token` | New endpoint: exchanges UUID code → deletes from Redis (one-time use) → sets `refresh_token` cookie → returns `{access_token}` |
| `frontend/app/api/auth/login/route.ts` | New BFF proxy: calls FastAPI server-to-server, extracts `refresh_token` from FastAPI's `Set-Cookie`, re-sets both cookies on `:3000`, returns `{ok:true}` to browser |
| `frontend/app/api/auth/refresh/route.ts` | Forwards `refresh_token` as `Cookie:` header to FastAPI (not JSON body) |
| `frontend/app/api/auth/logout/route.ts` | Forwards `refresh_token` as `Cookie:` header to FastAPI |
| `frontend/app/api/auth/oauth-token/route.ts` | New: exchanges OAuth UUID code with FastAPI server-to-server, sets both cookies on `:3000` |
| `frontend/app/api/auth/session/route.ts` | Simplified: only sets `access_token` cookie (refresh handled by login/oauth-token routes) |
| `frontend/app/auth/callback/page.tsx` | Reads `?code=` (not tokens), calls `/api/auth/oauth-token` |
| `frontend/components/auth/LoginForm.tsx` | Calls `/api/auth/login` (Next.js proxy) instead of FastAPI directly |
| `backend/app/schemas/user.py` | Removed `Token`, `RefreshRequest`, `LogoutRequest`; kept only `AccessToken` |

**Net result:** Both tokens are httpOnly on the browser. Browser JS sees only `{ok:true}` on login. XSS gets nothing.

---

## 3. Image Uploads via Cloudinary

**Why:** Ideas need image attachments. Files must never be stored on the server filesystem; MIME type must be validated against magic bytes (not extension) to block disguised executables; filenames must be generated server-side to prevent path traversal.

**What changed:**

| File | Change |
|---|---|
| `backend/Dockerfile` | Added `apt-get install -y libmagic1` (C library required by `python-magic`) |
| `backend/requirements.txt` | Added `cloudinary>=1.0.0,<2.0.0` and `python-magic>=0.4.27` |
| `backend/app/core/config.py` | Added `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` settings; added `configure_cloudinary()` method |
| `backend/app/main.py` | Calls `settings.configure_cloudinary()` at startup in `lifespan` |
| `backend/app/services/image_service.py` | `validate_and_upload_image()`: (1) size check ≤5MB, (2) magic-byte MIME validation, (3) `asyncio.to_thread` upload to Cloudinary with `unique_filename=True` (original filename discarded). Returns `secure_url`. |
| `backend/app/api/ideas.py` | `POST /ideas/image`: auth-gated endpoint calling `validate_and_upload_image`, returns `{url}` |
| `backend/app/schemas/idea.py` | Added `imageUrl: Optional[str]` to `IdeaCreate`, `IdeaUpdate`, `IdeaResponse`, `IdeaInDB` |
| `frontend/app/api/ideas/image/route.ts` | New BFF proxy: reads `access_token` from httpOnly cookie, forwards multipart form to FastAPI |
| `frontend/app/dashboard/ideas/new/page.tsx` | Frontend type+size validation on file select; uploads via `/api/ideas/image` on submit; sends `imageUrl` (not base64) in idea payload |
| `frontend/app/dashboard/ideas/[id]/page.tsx` | Same upload logic in edit mode; displays `imageUrl` from MongoDB |

**Upload flow:**
```
User picks file → frontend validates (type + size, fast UX check)
              → onSubmit: POST /api/ideas/image (Next.js BFF)
              → BFF injects access_token, forwards multipart to FastAPI
              → FastAPI: magic-byte check → Cloudinary upload → returns secure_url
              → BFF returns {url} to browser
              → Browser includes imageUrl in POST /api/ideas/create payload
              → MongoDB stores the Cloudinary URL (not the file)
```

**Required `.env` additions:**
```
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

---

## 4. Email Verification & Password Reset

**Why:** Without email verification, anyone can register with a fake or someone else's email address. Accounts must be verified before login is permitted, and users must be able to recover access via a reset link.

**What changed — backend:**

| File | Change |
|---|---|
| `backend/requirements.txt` | Added `resend[async]>=2.30.1` (async extra enables `send_async()` via httpx) |
| `backend/app/core/config.py` | Added `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_OVERRIDE_TO` settings |
| `backend/app/models/user.py` | Added 5 columns: `email_verified` (bool, default False), `verification_token_hash` (VARCHAR 64), `verification_token_expires` (TIMESTAMPTZ), `reset_token_hash`, `reset_token_expires` |
| `backend/app/db/postgres.py` | Added 5 idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` migrations in `init_db()` |
| `backend/app/services/email_service.py` | `send_verification_email()` and `send_password_reset_email()` — async Resend calls; `_resolve_to()` applies `EMAIL_OVERRIDE_TO` dev redirect |
| `backend/app/api/auth.py` | New endpoints below; `POST /auth/login` now blocks unverified users with 403 |
| `backend/app/main.py` | Added dedicated `StreamHandler` on `"app"` logger namespace (see Logging section below) |

**New endpoints:**

| Endpoint | Behaviour |
|---|---|
| `POST /auth/register` | Upsert-unverified pattern: new email → create + send verify link; existing unverified → update password + fresh token + resend; existing verified → 409 |
| `GET /auth/verify-email?token=` | Validates SHA-256 hash + expiry, marks `email_verified=True`, clears token |
| `POST /auth/resend-verification` | Issues fresh token, resends link; rate-limited to 3 requests/hour/email; always returns 200 |
| `POST /auth/forgot-password` | Generates reset token, sends link; rate-limited 3/hour/email; always returns 200 (no user enumeration) |
| `POST /auth/reset-password` | Validates hash + expiry, updates password, clears token |

**Token security:** `_generate_token()` returns `(raw_token, sha256_hash)`. The raw token goes in the email link; only the SHA-256 hash is stored in the DB. A stolen DB dump cannot be used to forge links.

**What changed — frontend:**

| File | Purpose |
|---|---|
| `frontend/app/verify-email/page.tsx` | Reads `?token=` from URL, calls BFF, shows success/error |
| `frontend/app/forgot-password/page.tsx` | Email form; always shows "check your inbox" regardless of whether the email exists |
| `frontend/app/reset-password/page.tsx` | Reads `?token=`, new-password form with client-side validation |
| `frontend/components/auth/SignupForm.tsx` | After successful register → shows check-email screen (not redirect); has "Resend" button and "Already verified? Sign in" link |
| `frontend/components/auth/LoginForm.tsx` | On 403 "unverified" → shows inline "Resend verification email" link |
| `frontend/app/api/auth/verify-email/route.ts` | BFF GET proxy |
| `frontend/app/api/auth/forgot-password/route.ts` | BFF POST proxy |
| `frontend/app/api/auth/reset-password/route.ts` | BFF POST proxy |
| `frontend/app/api/auth/resend-verification/route.ts` | BFF POST proxy |

**Challenges & workarounds:**

1. **Unverified sender domain silently rejected.** Using `EMAIL_FROM=noreply@ideavault.com` (unowned domain) caused Resend to accept the API call but never deliver. Fixed by switching to Resend's shared `onboarding@resend.dev` sender.

2. **Resend test-mode restriction.** Without a verified custom domain, Resend's API hard-rejects delivery to any address other than the account owner's. Resend Contacts/Audiences does **not** bypass this — that feature is for marketing campaigns, not transactional API sends. Workaround: `EMAIL_OVERRIDE_TO` env var; `_resolve_to()` in `email_service.py` redirects all outgoing emails to that address so the full flow can be tested locally. Remove this var and verify a domain before going to production.

3. **Uvicorn kills app-level logging.** Uvicorn calls `logging.config.dictConfig()` at startup which replaces the root logger's handlers. Any logger using `logging.getLogger("app.*")` ends up with no handler and silently drops all log calls — including `logger.exception()` in the email service, making failures invisible. Fixed in `main.py` by attaching a dedicated `StreamHandler` (pointing to stdout) directly on the `"app"` namespace logger with `propagate=False`, before uvicorn's config runs. App logs now always appear in `docker compose logs backend`.

4. **Ghost account bug.** A user who registered but never verified was permanently locked out: re-registering returned 409 (email taken) and verifying was impossible without the (expired) token. Fixed with the upsert-unverified pattern in `POST /auth/register`.

**Required `.env` additions:**
```
RESEND_API_KEY=
EMAIL_FROM=Idea Vault <onboarding@resend.dev>
EMAIL_OVERRIDE_TO=themlguppie@gmail.com   # dev only — remove in production with a verified domain
```

---

## 5. Semantic Search via Embeddings (RAG Pipeline Foundation)

**Why:** Keyword search (`$regex`) only matches exact words. A search for "productivity tool" won't find an idea titled "focus timer app". Embeddings encode semantic meaning — similar concepts score high regardless of exact wording.

**Model: `all-MiniLM-L6-v2`**

Chosen over `BAAI/bge-m3` (the other candidate):

| | `all-MiniLM-L6-v2` ✅ | `BAAI/bge-m3` ❌ |
|---|---|---|
| Size | 90 MB | 2.3 GB |
| Cold start | <1 s | 10–15 s |
| Vector dims | 384 | 1024 |
| Use case fit | Short English text | Multilingual, long context |

bge-m3's advantages (multilingual, sparse retrieval) don't apply here. Paying the cost with zero benefit. MiniLM loads once via `@lru_cache` — all subsequent calls return the cached model instantly.

**Accepted trade-off:** model swap (if ever needed) requires a re-backfill script. Documented and worth it.

**What gets embedded — and what doesn't:**

- `title + summary` → embedded together. Title anchors the topic; summary provides semantic depth.
- `description` → stored for display, never embedded (unlimited length, retrieved post-search).
- `tags` → used as `$vectorSearch` pre-filters (metadata), not embedded. Embedding keyword lists adds noise.
- `summary` is capped at 190 words on the frontend, enforced at 1300 chars in the schema — guarantees no silent truncation by MiniLM's 256-token limit.

**Write path — non-blocking:**

```
POST /ideas/create
  → insert document (no embedding yet)
  → return 201 immediately          ← user sees instant save
  → BackgroundTasks fires after response
      → asyncio.to_thread(model.encode)   ← CPU work off event loop
      → db.ideas.update_one({$set: {embedding: [...]}})
```

Same pattern on update: re-embeds only when `title` or `summary` actually changed. No-op edits (status/priority/tags/description) skip it.

**Scale note:** `BackgroundTasks` runs in-process — doesn't survive horizontal scale or process crash. Upgrade path: Celery + Redis broker (~1 day migration). MongoDB write is identical either way.

**Backfill:**

`backend/scripts/backfill_embeddings.py` — one-shot script for ideas that pre-date the embedding feature. Filter: `{"embedding": {"$exists": False}}` → idempotent, safe to re-run.

```bash
cd backend
python -m scripts.backfill_embeddings          # live run
python -m scripts.backfill_embeddings --dry-run # preview only
```

**What changed:**

| File | Change |
|---|---|
| `backend/requirements.txt` | Added `sentence-transformers>=3.0.0` |
| `backend/app/services/embedding_service.py` | `get_embedding_model()` (lru_cache), `generate_embedding()`, `generate_idea_embedding(title, summary)` |
| `backend/app/schemas/idea.py` | Added `summary: str` (required, max 1300 chars) to `IdeaCreate`, `IdeaUpdate`, `IdeaResponse`, `IdeaInDB` |
| `backend/app/api/ideas.py` | `_embed_and_store()` background task; `BackgroundTasks` injected into create + update; re-embed guard on update |
| `backend/scripts/backfill_embeddings.py` | Backfill script for pre-existing ideas |
| `frontend/app/dashboard/ideas/new/page.tsx` | Summary field with live word counter (190-word limit, turns red at limit) |
| `frontend/app/dashboard/ideas/[id]/page.tsx` | Same summary field in edit mode; summary displayed in view mode |

**Required `requirements.txt` addition:**
```
sentence-transformers>=3.0.0
```
