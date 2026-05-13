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
