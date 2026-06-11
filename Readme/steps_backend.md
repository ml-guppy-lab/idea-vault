# ---------------------------------------------------------------------------------------------------------------------------------------------------------------

# V4 Handoff + Quality Standards

- V4 readiness checklist: `Readme/v4_readiness_checklist.md`
- Engineering quality charter: `Readme/engineering_quality_charter.md`

Use both docs as non-negotiable guardrails for planning and implementation.

# To test one api - logout 

# Step 1 — Log in now to get a fresh token
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test1@example.com", "password": "112233"}' | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['access_token'], r['refresh_token'])")

ACCESS=$(echo $TOKEN | awk '{print $1}')
REFRESH=$(echo $TOKEN | awk '{print $2}')

# Step 2 — Use the fresh token immediately
curl -s -X POST http://localhost:8000/api/auth/logout \
  -H "Authorization: Bearer $ACCESS" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\": \"$REFRESH\"}"
---------------------------------------------------------------------------------------------------------------------------------------------------------------


# Project Setup Steps

> All features must be done in `feature/feature-name` branches that merge into `dev`. Never commit directly to `main`.

---

## Frontend (Next.js + Tailwind + shadcn/ui)

```bash
# 1. Load nvm and create the Next.js app
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
npx create-next-app@latest frontend --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*"

# 2. Go into the frontend folder
cd frontend

# 3. Init shadcn/ui (choose: Radix style → Nova theme)
npx shadcn@latest init

# 4. Add components
npx shadcn@latest add input card dialog badge dropdown-menu form label textarea

# 5. Set up environment variables
cp ../.env.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:8000/api

# 6. Start dev server
npm run dev
# → http://localhost:3000
```

---

## Backend (FastAPI + Python venv)

```bash
# 1. Go into the backend folder
cd backend

# 2. Create and activate virtual environment
python3 -m venv venv
source venv/bin/activate

# 3. Set up environment variables
cp .env.example .env
# Edit .env → set SECRET_KEY to a long random string

# 4. Install dependencies
pip install -r requirements.txt

# 5. Start dev server
uvicorn app.main:app --reload --port 8000
# → http://localhost:8000/docs
```

---

## Docker Setup (all services)

### Files created

| File | Purpose |
|---|---|
| `backend/Dockerfile` | Builds the FastAPI image using `python:3.12-slim` |
| `frontend/Dockerfile` | Multi-stage build: deps → builder → runner using `node:20-alpine` |
| `backend/.dockerignore` | Excludes `venv/`, `__pycache__/`, `.env`, `.db` from image |
| `frontend/.dockerignore` | Excludes `node_modules/`, `.next/`, `.env*` from image |
| `docker-compose.yml` | Defines all 5 services, volumes, and network |

### How services are connected

All services share a Docker bridge network called `app-network`. Within this network, services talk to each other by **service name** (not `localhost`):

- Backend connects to Postgres via `postgres:5432`
- Backend connects to MongoDB via `mongo:27017`
- Backend connects to Redis via `redis:6379`
- Frontend calls the backend via `http://backend:8000` (or `localhost:8000` from browser)

Service URLs are set in `backend/.env`:
```
POSTGRES_URL=postgresql+asyncpg://idea_user:idea_pass@postgres:5432/idea_vault
MONGO_URI=mongodb://idea_user:idea_pass@mongo:27017/idea_vault?authSource=admin
REDIS_URL=redis://redis:6379
```

Postgres and MongoDB use named volumes (`postgres_data`, `mongo_data`, `redis_data`) so data persists across restarts.

The backend and databases use **health checks** — the backend only starts after Postgres, MongoDB, and Redis are confirmed healthy.

`frontend/next.config.ts` was updated with `output: "standalone"` — required for the Next.js Docker image to work correctly.

### How to start

```bash
# From the project root — builds images and starts all services
docker-compose up --build

# Run in background
docker-compose up --build -d
```

### Ports

| Service | Port |
|---|---|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:8000/docs |
| PostgreSQL | localhost:5432 |
| MongoDB | localhost:27017 |
| Redis | localhost:6379 |

### How to stop

```bash
# Stop all services
docker-compose down

# Stop and wipe all DB data (volumes)
docker-compose down -v
```

```bash
docker compose up --build #build and run all services
```

---

## MongoDB — Compass Connection

### 1. Start MongoDB
```bash
docker-compose up -d mongo
```

### 2. Connect in MongoDB Compass
Use this connection string:
```
mongodb://idea_user:idea_pass@localhost:27017/idea_vault?authSource=admin
```

### 3. Create database and collection
1. Click **"+"** next to Databases in the sidebar
2. Database name: `idea_vault`
3. Collection name: `ideas`
4. Click **Create Database**

> `authSource=admin` is required because `idea_user` is a root user created in the `admin` database by Docker Compose.

---

## MongoDB — FastAPI Integration (Motor)

### Files created / changed

| File | Change |
|---|---|
| `backend/app/db/mongodb.py` | New — Motor client, `connect_to_mongo()`, `close_mongo_connection()`, `get_mongo_db()` |
| `backend/app/core/config.py` | Added `MONGO_URI` and `MONGO_DB_NAME` settings |
| `backend/app/main.py` | Wired `connect_to_mongo()` / `close_mongo_connection()` into lifespan |
| `backend/requirements.txt` | Added `motor>=3.4.0` |
| `backend/.env` | Added `MONGO_DB_NAME=idea_vault`, updated `MONGO_URI` to `localhost` |

### Install Motor

```bash
cd backend
source venv/bin/activate
pip install motor
```

### How it works

- On startup, `connect_to_mongo()` connects to MongoDB and creates an index on `userId` in the `ideas` collection (safe to re-run — skipped if index exists)
- On shutdown, `close_mongo_connection()` closes the client cleanly
- Use `get_mongo_db()` as a FastAPI dependency in routes that need MongoDB

### Verify it's working

```bash
# 1. Make sure MongoDB container is running
docker-compose up -d mongo

# 2. Start the backend
cd backend && source venv/bin/activate
uvicorn app.main:app --reload --port 8000
```

On startup you should see **no errors** in the terminal. Then confirm the index was created:

1. Open **MongoDB Compass** → connect
2. Go to `idea_vault` → `ideas` → **Indexes** tab
3. You should see an index on `userId` listed there

---

## Backend — Pydantic Settings Fix (`extra="ignore"`)

### Problem

Pydantic-settings reads **every variable** from `.env` and tries to map each one to a field in the `Settings` class. Our `.env` contains Docker-only vars like `POSTGRES_USER`, `MONGO_USER`, `REDIS_URL` that aren't declared in `Settings` — this caused a `ValidationError: Extra inputs are not permitted` crash on startup.

### Fix

Added `extra="ignore"` to `model_config` in `backend/app/core/config.py`:

```python
model_config = SettingsConfigDict(
    env_file=".env",
    env_file_encoding="utf-8",
    extra="ignore",   # silently skip .env vars not declared in Settings
)
```

This tells pydantic to quietly ignore any extra `.env` vars. The Docker-only vars are still read by Docker Compose directly — they just don't need to be in the `Settings` class.

---

## Backend — Schema & Route Alignment

### Why two idea schema files?

The original `schemas/idea.py` was a placeholder with basic fields. It was rewritten to properly reflect how ideas are stored in **MongoDB** (not SQL):

| Class | Purpose |
|---|---|
| `IdeaCreate` | What the frontend sends when creating an idea |
| `IdeaUpdate` | Partial update — all fields optional |
| `IdeaResponse` | What the API returns — maps MongoDB `_id` → `id` via alias |
| `IdeaInDB` | The full document shape written into MongoDB |

`IdeaResponse` uses `Field(alias="_id")` because MongoDB stores the primary key as `_id`, but the frontend should receive it as `id`.

### Why `api/ideas.py` was updated

The route file was importing `IdeaRead` (old name). After the schema rewrite renamed it to `IdeaResponse`, all imports and `response_model=` references in `api/ideas.py` were updated to match.

> **Note:** The ideas routes still use SQLAlchemy as a placeholder. They will be fully rewritten to use `get_mongo_db()` when the ideas CRUD epic is implemented.

---

## PostgreSQL — Code Setup

### Why PostgreSQL for auth?

PostgreSQL stores structured, relational data — users and refresh tokens. MongoDB stores ideas (flexible, document-based). They don't overlap.

### Files created / changed

| File | What changed |
|---|---|
| `backend/app/db/postgres.py` | Renamed from `database.py` — SQLAlchemy async engine, `Base`, `get_db()`, `init_db()` |
| `backend/app/models/user.py` | Rewritten — `auth_provider` enum (`local`/`google`), `hashed_password` nullable for OAuth users, removed `full_name` |
| `backend/app/models/refresh_token.py` | New — `id`, `user_id` (FK → users, CASCADE delete), `token` (unique), `expires_at`, `created_at` |
| `backend/app/schemas/user.py` | Updated — removed `full_name`, added `auth_provider` to `UserRead` |
| `backend/app/api/auth.py` | Removed `full_name` from user creation |
| `backend/app/core/config.py` | `DATABASE_URL` default now points to PostgreSQL `idea_vault_auth` |
| `backend/.env` | `DATABASE_URL` updated to PostgreSQL, `POSTGRES_DB` set to `idea_vault_auth` |
| `backend/requirements.txt` | Replaced `aiosqlite` with `asyncpg` (async PostgreSQL driver) |
| `backend/app/main.py` | Imports both models before `init_db()` so SQLAlchemy registers them with `Base` |
| `docker-compose.yml` | PostgreSQL default DB updated to `idea_vault_auth` |

### How tables are created

`init_db()` in `postgres.py` calls `Base.metadata.create_all` on startup. SQLAlchemy reads all models imported in `main.py` and creates the tables automatically if they don't exist. No manual SQL needed.

### Tables created in `idea_vault_auth`

**`users`**
| Column | Type | Notes |
|---|---|---|
| `id` | VARCHAR(36) PK | UUID |
| `email` | VARCHAR(255) | unique, indexed, not null |
| `hashed_password` | VARCHAR | nullable (null for OAuth users) |
| `auth_provider` | ENUM | `local` or `google` |
| `is_active` | BOOLEAN | not null |
| `created_at` | TIMESTAMP WITH TIME ZONE | not null |

**`refresh_tokens`**
| Column | Type | Notes |
|---|---|---|
| `id` | VARCHAR(36) PK | UUID |
| `user_id` | VARCHAR(36) FK | → `users.id`, CASCADE delete |
| `token` | VARCHAR(512) | unique, not null |
| `expires_at` | TIMESTAMP WITH TIME ZONE | not null |
| `created_at` | TIMESTAMP WITH TIME ZONE | not null |

### Install asyncpg and start

```bash
cd backend && source venv/bin/activate
pip install -r requirements.txt

# Start PostgreSQL container
docker-compose up -d postgres

# Create the database (only needed once — Docker won't auto-create a renamed DB)
docker-compose exec postgres psql -U idea_user -d postgres -c "CREATE DATABASE idea_vault_auth;"

# Start backend — tables are auto-created on startup
uvicorn app.main:app --reload --port 8000
```

---

## PostgreSQL — TablePlus Connection

1. Download **TablePlus** from [tableplus.com](https://tableplus.com) (free, macOS native)
2. Open TablePlus → click **"+"** → select **PostgreSQL**
3. Fill in:
   - **Name:** `Idea Vault Auth`
   - **Host:** `127.0.0.1`
   - **Port:** `5432`
   - **User:** `idea_user`
   - **Password:** `idea_pass`
   - **Database:** `idea_vault_auth`
4. Click **Test** → should show green **"Connection is OK"**
5. Click **Connect**

You'll see `users`, `refresh_tokens`, and `ideas` tables in the sidebar.

---

## Redis — Setup & Connection

### Why Redis?

Redis is used for **rate limiting on auth endpoints** (register/login). It stores request counts per IP with a TTL so they expire automatically.

### Files created / changed

| File | What changed |
|---|---|
| `backend/app/db/redis.py` | New — async Redis client, `connect_to_redis()` (pings on startup), `close_redis_connection()`, `get_redis()` dependency |
| `backend/app/core/config.py` | Added `REDIS_URL` setting |
| `backend/app/main.py` | `connect_to_redis()` / `close_redis_connection()` wired into lifespan |
| `backend/requirements.txt` | Added `redis>=5.0.0` |
| `backend/test_redis.py` | Standalone ping test script |

### Important: localhost vs Docker service name

- **Running locally** → `REDIS_URL=redis://localhost:6379` (set in `backend/.env`)
- **Running in Docker** → `redis://redis:6379` (Docker service name, used inside containers)

Always make sure `.env` uses `localhost` when developing locally.

### Install and start

```bash
cd backend && source venv/bin/activate
pip install redis

# Start Redis container
docker-compose up -d redis
```

### Test the connection

```bash
python test_redis.py
# → Redis response: True  (means PONG — connection works)
```

### Verify on backend startup

```bash
uvicorn app.main:app --reload --port 8000
```

On startup, `connect_to_redis()` runs `ping()` — if Redis isn't reachable, the server won't start. A clean startup with no errors means Redis is connected.

---

## Auth — POST /auth/register

### What it does

Accepts an email and password, validates both, creates a user in PostgreSQL, and returns the new user's `id` and `email`.

### Files created / changed

| File | What changed |
|---|---|
| `backend/app/schemas/user.py` | `UserCreate` — added `@field_validator("password")` for strength rules; `UserRead` — trimmed to only `id` + `email` |
| `backend/app/api/auth.py` | `POST /register` — checks duplicate email (409), hashes password with bcrypt, persists user, returns `UserRead` |
| `backend/app/core/security.py` | `hash_password()` — uses `bcrypt.hashpw` directly (passlib removed — incompatible with bcrypt ≥ 4.x on Python 3.12+) |
| `backend/requirements.txt` | Replaced `passlib` with `bcrypt>=4.0.0` |

### Password validation rules (enforced in Pydantic before the route runs)

| Rule | Error message |
|---|---|
| Minimum 8 characters | `Password must be at least 8 characters` |
| At least one uppercase letter | `Password must contain at least one uppercase letter` |
| At least one number | `Password must contain at least one number` |

Validation failures return `422 Unprocessable Entity` automatically — the route is never reached.

### Security decisions

- The plain-text password is **never stored** — only the bcrypt hash
- `UserRead` intentionally omits `hashed_password`, `auth_provider`, and `is_active` — the client gets only `id` and `email`
- Duplicate email → `409 Conflict` (not 422) — it's a business rule, not a validation error

### How to verify

```bash
# Valid registration — returns 201
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123"}'
# → {"id": "...", "email": "you@example.com"}

# Duplicate email — returns 409
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123"}'
# → {"detail": "Email already registered"}

# Weak password — returns 422
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "abc"}'
# → {"detail": [{"msg": "Password must be at least 8 characters", ...}]}
```

Confirm the row in **TablePlus** → `idea_vault_auth` → `users` table. The `hashed_password` column should contain a `$2b$...` bcrypt hash, never the plain text.

---

## Auth — POST /auth/login

### What it does

Accepts an email and password as a JSON body. Looks up the user in PostgreSQL, verifies the password with bcrypt, and on success issues a short-lived JWT access token and a long-lived opaque refresh token. The refresh token is stored in the `refresh_tokens` table so it can be validated and revoked server-side.

### Files created / changed

| File | What changed |
|---|---|
| `backend/app/schemas/user.py` | Added `UserLogin` (email + password, no strength check); `Token` updated to include `refresh_token` field |
| `backend/app/api/auth.py` | `POST /login` — full implementation (see below) |
| `backend/app/core/security.py` | Added `create_refresh_token()` — `secrets.token_urlsafe(64)`, opaque, not a JWT |
| `backend/app/core/config.py` | `ACCESS_TOKEN_EXPIRE_MINUTES` set to `15`; added `REFRESH_TOKEN_EXPIRE_DAYS = 180` |
| `backend/.env` | `ACCESS_TOKEN_EXPIRE_MINUTES` updated to `15` |

### Token design

| Token | Type | Expiry | Where stored |
|---|---|---|---|
| `access_token` | Signed JWT (`HS256`) | 15 minutes | Client only (Authorization header) |
| `refresh_token` | Opaque random string (`secrets.token_urlsafe(64)`) | 180 days | PostgreSQL `refresh_tokens` table |

**Why two tokens?**
- The JWT is stateless — the server can verify it without a DB call, so it's kept short-lived (15 min)
- The refresh token is stored in the DB, so it can be revoked at any time (logout, compromised account, etc.)

### Security decisions

- Uses `UserLogin` (plain JSON body), not OAuth2 form — the frontend sends JSON, not form-encoded data
- A **single generic `401 Invalid credentials`** is returned whether the email doesn't exist, the password is wrong, or the user has no stored password hash (OAuth user). This prevents account enumeration — the caller learns nothing about which field was wrong
- Inactive users get `403 Forbidden` — distinct from an auth failure, and deliberate
- The refresh token raw value (`secrets.token_urlsafe(64)`) is stored as-is. A future improvement is to hash it before storing (like a password) so a DB leak doesn't expose valid tokens

### How to verify

```bash
# Successful login — returns 200
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123"}'
# → {"access_token": "eyJ...", "refresh_token": "abc123...", "token_type": "bearer"}

# Wrong password — returns 401 (same message as wrong email — by design)
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "wrongpassword"}'
# → {"detail": "Invalid credentials"}

# Non-existent email — returns 401 (same generic message — by design)
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "ghost@example.com", "password": "Secret123"}'
# → {"detail": "Invalid credentials"}
```

After a successful login, confirm the refresh token row in **TablePlus** → `idea_vault_auth` → `refresh_tokens` table. You should see a row with `user_id` matching the user, a long random `token` string, and `expires_at` ~180 days from now.

Decode the access token at [jwt.io](https://jwt.io) to confirm the `sub` (user id) and `exp` (expiry ~15 min from now) claims.

---

## Auth — POST /auth/refresh

### What it does

Accepts the opaque refresh token (issued at login) as a JSON body. Looks it up in the `refresh_tokens` table in PostgreSQL. If found and not expired, issues a brand-new JWT access token. The refresh token itself is **not rotated** — it stays the same until the user logs out or it expires after 180 days.

### Why this endpoint exists

The access token is a short-lived JWT (15 minutes). Once it expires, the client would otherwise have to ask the user to log in again. The refresh token solves this: the client silently calls `/auth/refresh` with the long-lived token it already has, and gets a fresh access token — no password re-entry needed.

### Why the refresh token is NOT rotated on every call

Token rotation (issuing a new refresh token on every use) is a common pattern but adds complexity: the client must always store the latest token, and a race condition can log users out if two requests fire simultaneously. For this app at this stage, the simpler approach — keep the same refresh token alive until logout — is correct. Rotation can be added later when we implement `/auth/logout`.

### Files created / changed

| File | What changed |
|---|---|
| `backend/app/schemas/user.py` | Added `RefreshRequest` (input — just the `refresh_token` string); added `AccessToken` (output — only `access_token`, no new refresh token) |
| `backend/app/api/auth.py` | `POST /refresh` — DB lookup, expiry check, expired row cleanup, new JWT issued |

### How it works step by step

1. Client sends `{ "refresh_token": "..." }` to `POST /auth/refresh`
2. The token string is looked up in `refresh_tokens` by exact match
3. If not found → `401` (generic message — same as if it were forged)
4. If found but `expires_at` is in the past → delete the row from DB, return `401`
5. If found and valid → call `create_access_token(subject=record.user_id)` → return new JWT

The expired-row deletion is intentional: no background job is needed to clean up stale tokens — they delete themselves on the next access attempt.

### Why a separate `AccessToken` response schema

`/login` returns `Token` which has both `access_token` and `refresh_token`. `/refresh` should only return a new `access_token` — the caller already has the refresh token and it hasn't changed. Using a different schema makes the contract explicit and prevents accidentally returning a stale or empty `refresh_token` field.

### How to test in Swagger UI

Go to `http://localhost:8000/docs`.

**Step 1 — Get tokens from login**

Open `POST /auth/login` → **Try it out** → enter:
```json
{ "email": "you@example.com", "password": "Secret123" }
```
Copy the `refresh_token` string from the response.

**Step 2 — Call the refresh endpoint**

Open `POST /auth/refresh` → **Try it out** → enter:
```json
{ "refresh_token": "paste-your-token-here" }
```
Expected `200` response:
```json
{ "access_token": "eyJ...", "token_type": "bearer" }
```

**Step 3 — Verify via curl**

```bash
# Successful refresh
curl -X POST http://localhost:8000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "your-token-here"}'
# → {"access_token": "eyJ...", "token_type": "bearer"}

# Invalid token — returns 401
curl -X POST http://localhost:8000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "not-a-real-token"}'
# → {"detail": "Invalid or expired refresh token"}
```

**Step 4 — Test expiry handling**

In **TablePlus** → `refresh_tokens` table → find your row → manually change `expires_at` to a past timestamp (e.g. `2020-01-01 00:00:00+00`). Call `/auth/refresh` again — it should return `401` and the row should be **deleted** from the table automatically.

**Step 5 — Confirm the new access token**

Paste the returned `access_token` into [jwt.io](https://jwt.io). The `sub` should match your user's `id` and `exp` should be ~15 minutes from the time you called refresh.

---

## Auth — POST /auth/logout

### What it does

Requires a valid JWT access token in the `Authorization: Bearer` header. Accepts the refresh token to revoke in the request body. Deletes that specific refresh token from PostgreSQL — it can no longer be used to generate new access tokens. Returns `200 OK` with `{"message": "Logged out successfully"}`.

### Why it works this way

**Why require a JWT at all?**
Without it, anyone who gets hold of a refresh token string could silently revoke someone else's session. The JWT proves the caller is the legitimate owner of that session.

**Why accept a specific refresh token instead of deleting all?**
Deleting all tokens for a user would log them out of every device simultaneously ("log out everywhere"). That's a separate feature. This endpoint revokes only the one token the client passes — the session on the current device ends, while other device sessions remain active.

**Why return 200 even if the token wasn't found?**
Logout is idempotent by design. If the client calls it twice (e.g. network retry), the second call should not return an error — the end state is the same either way: the token is gone.

### Files created / changed

| File | What changed |
|---|---|
| `backend/app/schemas/user.py` | Added `LogoutRequest` — carries the `refresh_token` to revoke |
| `backend/app/api/auth.py` | Added `HTTPBearer` import and `_bearer` scheme; added `get_current_user_id` dependency that validates the JWT and extracts the user id; added `POST /logout` endpoint |

### How `get_current_user_id` works

```python
_bearer = HTTPBearer()

def get_current_user_id(credentials = Depends(_bearer)) -> str:
    user_id = decode_access_token(credentials.credentials)
    if not user_id:
        raise HTTPException(401, "Invalid or expired access token")
    return user_id
```

`HTTPBearer()` automatically reads the `Authorization: Bearer <token>` header. FastAPI returns `403` if the header is missing entirely, `401` if the JWT is invalid or expired.

This dependency is reusable — any future protected endpoint can add `user_id: str = Depends(get_current_user_id)` to require authentication.

### How to test in Swagger UI

Go to `http://localhost:8000/docs`.

**Step 1 — Login to get both tokens**

Open `POST /auth/login` → **Try it out** → enter your credentials. Copy both `access_token` and `refresh_token` from the response.

**Step 2 — Authorize Swagger with the access token**

Click the **Authorize** button (padlock icon, top right of Swagger) → paste your `access_token` → click **Authorize**. Swagger will now send `Authorization: Bearer <token>` automatically on all requests.

**Step 3 — Call logout**

Open `POST /auth/logout` → **Try it out** → enter:
```json
{ "refresh_token": "paste-your-refresh-token-here" }
```
Expected `200` response:
```json
{ "message": "Logged out successfully" }
```

**Step 4 — Confirm the token is gone**

Open **TablePlus** → `idea_vault_auth` → `refresh_tokens` table. The row should no longer exist.

**Step 5 — Verify the refresh token no longer works**

Call `POST /auth/refresh` with the same refresh token you just revoked:
```json
{ "refresh_token": "same-token-here" }
```
Expected: `401 Invalid or expired refresh token`.

**Step 6 — Test without Authorization header via curl**

```bash
# Missing Authorization header — returns 403
curl -X POST http://localhost:8000/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "any-token"}'
# → 403 Forbidden

# Expired/invalid JWT — returns 401
curl -X POST http://localhost:8000/auth/logout \
  -H "Authorization: Bearer not-a-real-jwt" \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "any-token"}'
# → {"detail": "Invalid or expired access token"}

# Valid JWT + correct refresh token — returns 200
curl -X POST http://localhost:8000/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "YOUR_REFRESH_TOKEN"}'
# → {"message": "Logged out successfully"}
```

---

## Auth — Google OAuth (GET /auth/google + GET /auth/google/callback)

### What it does

Two endpoints together implement the OAuth 2.0 Authorization Code Flow with Google:

1. `GET /auth/google` — redirects the user's browser to Google's login page
2. `GET /auth/google/callback` — Google redirects back here after login; the backend exchanges the code for tokens, finds or creates the user in PostgreSQL, issues a JWT + refresh token, and redirects the browser to the frontend

### How the Authorization Code Flow works (step by step)

```
Browser                  Backend                    Google
  │                         │                          │
  │── GET /auth/google ────►│                          │
  │                         │── redirect to Google ───►│
  │◄── 302 to accounts.google.com ──────────────────────│
  │                         │                          │
  │── [user logs in with Google] ─────────────────────►│
  │                         │                          │
  │◄── 302 /auth/google/callback?code=...&state=... ───│
  │                         │                          │
  │── GET /callback?code=...►│                          │
  │                         │── exchange code ────────►│
  │                         │◄── access_token + id_token│
  │                         │── decode email from id_token
  │                         │── find or create user in DB
  │                         │── issue JWT + refresh token
  │◄── 302 frontend/auth/callback?access_token=...&refresh_token=...
```

### Why `state` matters (CSRF protection)

When the user visits `/auth/google`, authlib generates a random `state` string, stores it in the signed session cookie (via `SessionMiddleware`), and includes it in the redirect URL to Google. When Google redirects back, it echoes the same `state`. Authlib compares it to what's in the session — if they don't match, it rejects the callback. This prevents an attacker from tricking a logged-in user into completing someone else's OAuth flow.

### Files created / changed

| File | What changed |
|---|---|
| `backend/.env` | Added `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `FRONTEND_URL` |
| `backend/app/core/config.py` | Added the four corresponding settings fields |
| `backend/requirements.txt` | Added `authlib>=1.3.0`, `httpx>=0.27.0`, `itsdangerous>=2.0.0` |
| `backend/app/main.py` | Added `SessionMiddleware` (required by authlib to store OAuth state in a signed cookie) |
| `backend/app/api/auth.py` | Added `_oauth` client (registered once at module level); added `GET /google` and `GET /google/callback` routes |

### Why these three new packages

| Package | Why needed |
|---|---|
| `authlib` | OAuth 2.0 / OpenID Connect client — handles redirect, state, token exchange, id_token parsing |
| `httpx` | Async HTTP client used internally by authlib to call Google's token and userinfo endpoints |
| `itsdangerous` | Signs and verifies the session cookie — prevents tampering with the stored `state` value |

### Setting up Google Cloud Console (one-time)

Before this works, the redirect URI must be registered with Google. **This is required — Google will reject callbacks to unregistered URIs.**

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Select your project → **APIs & Services** → **Credentials**
3. Click on your OAuth 2.0 Client ID
4. Under **Authorized redirect URIs**, add:
   ```
   http://localhost:8000/api/auth/google/callback
   ```
5. Under **Authorized JavaScript origins**, add:
   ```
   http://localhost:8000
   http://localhost:3000
   ```
6. Click **Save**

> When deploying to production, you must add the production domain here too (e.g. `https://api.yourdomain.com/api/auth/google/callback`).

### Find-or-create user logic

| Scenario | What happens |
|---|---|
| New Google account, email not in DB | New `User` row created with `auth_provider=google`, `hashed_password=NULL` |
| Same email already exists (local account) | Existing user found and returned — Google login works alongside email/password |
| Account exists but `is_active=False` | `403 Forbidden` — same gate as email/password login |

`hashed_password` is `NULL` for OAuth users — they have no password in our system. If they later try to use `POST /auth/login`, the check `if not user.hashed_password` will return `401` (correct — they must use Google).

### How to verify

**Step 1 — Install new packages** (if running locally outside Docker)

```bash
cd backend && source venv/bin/activate
pip install -r requirements.txt
```

**Step 2 — Restart the backend**

```bash
uvicorn app.main:app --reload --port 8000
```

No startup errors means `SessionMiddleware` and `authlib` loaded correctly.

**Step 3 — Trigger the OAuth flow**

Open your browser and navigate directly to:
```
http://localhost:8000/api/auth/google
```

You should be redirected to Google's login page. Sign in with a Google account.

**Step 4 — Verify the callback**

After Google login, the browser should land on:
```
http://localhost:3000/auth/callback?access_token=eyJ...&refresh_token=abc...
```

> The frontend page `/auth/callback` doesn't exist yet — you'll see a Next.js 404. That's expected. The important thing is that the URL contains both tokens, which confirms the OAuth flow completed successfully.

**Step 5 — Confirm the user was created in PostgreSQL**

Open **TablePlus** → `idea_vault_auth` → `users` table. You should see:
- A new row with your Google email
- `auth_provider` = `google`
- `hashed_password` = `NULL`
- `is_active` = `true`

Also check `refresh_tokens` — a new row should exist for this user.

**Step 6 — Decode the access token**

Paste the `access_token` from the URL into [jwt.io](https://jwt.io). The `sub` claim should match the user's `id` from the `users` table, and `exp` should be ~15 minutes from now.

**Step 7 — Test the token works**

```bash
# Use the access_token to call a protected endpoint (e.g. logout)
curl -X POST http://localhost:8000/api/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "YOUR_REFRESH_TOKEN"}'
# → {"message": "Logged out successfully"}
```

---

## Auth — Rate Limiting on /auth/login and /auth/register

### What it does

Both `/auth/login` and `/auth/register` are protected by a per-IP rate limit: **5 attempts per 15 minutes**. On the 6th attempt within the window, the endpoint returns `429 Too Many Requests` with an exact message telling the user how long to wait. The counter resets automatically when the 15-minute TTL expires in Redis.

### Why Redis for rate limiting?

Redis is the right tool for this:
- `INCR` is atomic — no race conditions even under concurrent requests
- Keys expire automatically via `EXPIRE` — no cleanup job needed
- It's already running in the stack for exactly this purpose

### How it works — the INCR + EXPIRE pattern

```
First request  → INCR key → value=1 → set EXPIRE 900s → allow
Second request → INCR key → value=2 →                 → allow
...
Fifth request  → INCR key → value=5 →                 → allow
Sixth request  → INCR key → value=6 → TTL check       → 429
```

`EXPIRE` is only called **once** (when value becomes 1). This means the window is **fixed** from the first request — it does not slide on every attempt. After 15 minutes, the key expires and the counter resets to 0.

### Redis key format

```
ratelimit:{endpoint}:{client_ip}
```

Examples:
- `ratelimit:login:127.0.0.1`
- `ratelimit:register:192.168.1.5`

Separate keys per endpoint mean login attempts don't count against register attempts and vice versa.

### Files created / changed

| File | What changed |
|---|---|
| `backend/app/core/config.py` | Added `RATE_LIMIT_MAX_ATTEMPTS = 5` and `RATE_LIMIT_WINDOW_SECONDS = 900` |
| `backend/app/api/auth.py` | Added `check_rate_limit` async dependency; injected it into `POST /register` and `POST /login` via `Depends(check_rate_limit)` |

### How `check_rate_limit` works

```python
async def check_rate_limit(request: Request, redis = Depends(get_redis)):
    client_ip = request.headers.get("X-Forwarded-For", request.client.host)
    endpoint  = request.url.path.rsplit("/", 1)[-1]   # "login" or "register"
    key       = f"ratelimit:{endpoint}:{client_ip}"

    count = await redis.incr(key)       # atomic — safe under concurrency
    if count == 1:
        await redis.expire(key, 900)    # set TTL only on first request in window

    if count > 5:
        ttl = await redis.ttl(key)
        raise HTTPException(429, f"Too many attempts. Try again in {ttl//60}m {ttl%60}s.",
                            headers={"Retry-After": str(ttl)})
```

The dependency is injected as `_: None = Depends(check_rate_limit)` — the `_` signals it's a side-effect dependency with no return value used in the route body.

### How to verify

**Step 1 — Make sure Redis and the backend are running**

```bash
docker-compose up -d redis
uvicorn app.main:app --reload --port 8000
```

**Step 2 — Hit /auth/login 6 times rapidly from the same IP**

```bash
for i in {1..6}; do
  echo "Attempt $i:"
  curl -s -X POST http://localhost:8000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email": "test@example.com", "password": "wrongpassword"}' | python3 -m json.tool
  echo "---"
done
```

Expected output — attempts 1–5 return `401 Invalid credentials`, attempt 6 returns:
```json
{
  "detail": "Too many attempts. Try again in 14m 58s."
}
```

**Step 3 — Check the Retry-After header**

```bash
curl -si -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "wrong"}' | grep -i "retry-after"
# → Retry-After: 892
```

**Step 4 — Inspect the Redis key directly**

```bash
# Connect to the Redis container
docker-compose exec redis redis-cli

# List rate limit keys
KEYS ratelimit:*
# → 1) "ratelimit:login:127.0.0.1"

# Check the current count
GET ratelimit:login:127.0.0.1
# → "6"

# Check remaining TTL in seconds
TTL ratelimit:login:127.0.0.1
# → 887  (seconds until the window resets)
```

**Step 5 — Verify the same limit applies to /auth/register**

```bash
for i in {1..6}; do
  curl -s -X POST http://localhost:8000/api/auth/register \
    -H "Content-Type: application/json" \
    -d '{"email": "spam@example.com", "password": "Spam1234"}' | python3 -m json.tool
done
# → 6th call returns 429
```

**Step 6 — Confirm separate counters per endpoint**

After getting rate limited on `/login`, you can still make attempts on `/register` (and vice versa) until that endpoint's own counter hits 5.

```bash
# These are tracked independently
KEYS ratelimit:*
# → 1) "ratelimit:login:127.0.0.1"
# → 2) "ratelimit:register:127.0.0.1"
```

---

## Auth — `get_current_user` Dependency (app/core/security.py)

### What it does

`get_current_user` is a reusable FastAPI dependency that protects any route. Add it to a route's parameters and that route automatically requires a valid JWT. It reads the `Authorization: Bearer` header, verifies the JWT signature, decodes the user ID, fetches the full `User` row from PostgreSQL, and returns it. If anything fails, the route is never reached — FastAPI returns the error automatically.

### Usage in any route

```python
from app.core.security import get_current_user
from app.models.user import User

@router.get("/me")
async def me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "email": current_user.email}
```

That's all that's needed. FastAPI discovers the dependency, runs it before the route handler, and either injects the `User` object or short-circuits with an error.

### What it checks (in order)

| Check | Failure response |
|---|---|
| `Authorization: Bearer` header is present | `403 Forbidden` (HTTPBearer handles this automatically) |
| JWT signature is valid and not expired | `401 Unauthorized` — `"Invalid or expired access token"` |
| User ID from token exists in PostgreSQL | `401 Unauthorized` — same generic message (prevents leaking account info) |
| `user.is_active == True` | `403 Forbidden` — `"Account is disabled"` |

### Why 401 for "user not found"

If a user is deleted from the database after their token was issued, the token is still cryptographically valid — but the user no longer exists. Returning `401` (not `404`) is intentional: we never confirm whether the email/ID exists to prevent information leakage.

### Why the User model is imported inside the function body

`security.py` importing `models/user.py` at the module level would create a circular import:

```
security.py → models/user.py → db/postgres.py → (config) ✓
```

This is actually fine. But importing `User` at the top of `security.py` would work — the local import inside the function body is used as a precaution to make the module easy to restructure in the future without risk of cycles.

### Files created / changed

| File | What changed |
|---|---|
| `backend/app/core/security.py` | Added `_bearer = HTTPBearer()` and `get_current_user` async dependency |
| `backend/app/api/auth.py` | Removed local `_bearer` and `get_current_user_id`; imported `get_current_user` from security; updated `POST /logout` to use `current_user: User = Depends(get_current_user)` |

### How to verify

**Step 1 — Restart the backend**

```bash
uvicorn app.main:app --reload --port 8000
```

**Step 2 — Call a protected endpoint without a token**

```bash
curl -s http://localhost:8000/api/auth/logout \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "anything"}'
# → 403 {"detail": "Not authenticated"}
# HTTPBearer returns 403 when the Authorization header is entirely missing
```

**Step 3 — Call with an invalid token**

```bash
curl -s http://localhost:8000/api/auth/logout \
  -X POST \
  -H "Authorization: Bearer not-a-real-jwt" \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "anything"}'
# → 401 {"detail": "Invalid or expired access token"}
```

**Step 4 — Call with a valid token**

```bash
# First, log in to get a token
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123"}'
# Copy access_token and refresh_token from the response

# Then call logout with the real token
curl -s -X POST http://localhost:8000/api/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"refresh_token": "YOUR_REFRESH_TOKEN"}'
# → 200 {"message": "Logged out successfully"}
```

**Step 5 — Add it to a new route (example)**

Any future route that needs authentication just adds one parameter:

```python
from app.core.security import get_current_user
from app.models.user import User

@router.get("/ideas")
async def list_ideas(current_user: User = Depends(get_current_user)):
    # current_user is the authenticated User row — guaranteed valid by this point
    ...
```

No additional code is needed — FastAPI handles the entire auth flow automatically.

---

## Ideas — POST /ideas/create (Create Idea)

### What it does

Creates a new idea document in MongoDB. Requires a valid JWT — the `userId` on every idea is taken from the token, not from the request body, so it can never be spoofed. Returns `201 Created` with the full saved document including the MongoDB-generated `_id` as `id`.

### Fields

| Field | Required | Type | Default | Validation |
|---|---|---|---|---|
| `title` | ✅ | string | — | 1–200 characters |
| `description` | ❌ | string | `null` | max 5000 characters |
| `tags` | ❌ | array of strings | `[]` | each tag: non-empty, max 50 chars, no duplicates |
| `status` | ❌ | enum | `raw` | `raw`, `exploring`, `validated`, `building`, `shipped`, `abandoned` |
| `priority` | ❌ | enum | `low` | `low`, `medium`, `high` |

Server-controlled (never sent by client):

| Field | Set by |
|---|---|
| `userId` | Decoded from JWT — the authenticated user's id |
| `createdAt` | Server UTC timestamp at insert time |
| `updatedAt` | Same as `createdAt` on creation |
| `_id` (→ `id`) | MongoDB auto-generated ObjectId, returned as string |

### Files created / changed

| File | What changed |
|---|---|
| `backend/app/schemas/idea.py` | Added `@field_validator("tags")` — strips whitespace, rejects empty/long/duplicate tags |
| `backend/app/api/ideas.py` | Full implementation — replaced TODO placeholder with `POST /ideas/create` route + `_serialize_idea` helper |

### How it works

1. `get_current_user` runs first — validates JWT, fetches `User` from PostgreSQL, returns it or raises `401`/`403`
2. Pydantic validates `IdeaCreate` — rejects bad input with `422` before the route body runs
3. A UTC timestamp is captured once (`now`) and used for both `createdAt` and `updatedAt`
4. The document is assembled by spreading `payload.model_dump()` + injecting `userId`, `createdAt`, `updatedAt`
5. `db.ideas.insert_one(document)` writes to MongoDB — Motor returns the generated `_id`
6. `db.ideas.find_one({"_id": result.inserted_id})` fetches the saved document back (ensures we return exactly what was stored)
7. `_serialize_idea()` converts the BSON `ObjectId` → plain string so `IdeaResponse(alias="_id")` maps it to `id`
8. Returns `201` with the full `IdeaResponse`

### Why fetch back after insert?

`insert_one` only returns the `_id`. Reconstructing the document in Python would risk drift if MongoDB applies any transforms. Fetching back guarantees the response matches exactly what's in the database.

### Why `userId` comes from the JWT, not the request body

If the client sent `userId`, any authenticated user could create ideas for any other user by passing someone else's id. Taking it from the verified token eliminates the attack surface entirely.

### How to verify

**Step 1 — Restart the backend**

```bash
uvicorn app.main:app --reload --port 8000
```

**Step 2 — Log in to get a token**

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123"}' \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['access_token'])")
```

**Step 3 — Create an idea (minimal)**

```bash
curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "My first idea"}' | python3 -m json.tool
```

Expected `201`:
```json
{
  "id": "664a1b2c3d4e5f6a7b8c9d0e",
  "userId": "90a804a9-0700-4f87e3-...",
  "title": "My first idea",
  "description": null,
  "tags": [],
  "status": "raw",
  "priority": "low",
  "createdAt": "2026-05-03T12:00:00.000Z",
  "updatedAt": "2026-05-03T12:00:00.000Z"
}
```

**Step 4 — Create an idea (all fields)**

```bash
curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "AI-powered journal",
    "description": "An app that summarises your daily notes using GPT",
    "tags": ["AI", "productivity", "SaaS"],
    "status": "exploring",
    "priority": "high"
  }' | python3 -m json.tool
```

**Step 5 — Test validation errors**

```bash
# Missing title — 422
curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description": "no title here"}'

# Title too long — 422
curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"title\": \"$(python3 -c 'print("x"*201)')\"}"

# Duplicate tags — 422
curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "tags": ["AI", "ai"]}'

# Invalid status enum — 422
curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "status": "notastatus"}'

# No Authorization header — 403
curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Content-Type: application/json" \
  -d '{"title": "Test"}'

# Invalid JWT — 401
curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer notajwt" \
  -H "Content-Type: application/json" \
  -d '{"title": "Test"}'
```

**Step 6 — Confirm in MongoDB Compass**

1. Open **MongoDB Compass** → connect
2. Go to `idea_vault` → `ideas` collection
3. You should see the documents created above, each with `userId` matching your user's PostgreSQL `id`

**Step 7 — Verify via Swagger UI**

1. Open **http://localhost:8000/docs**
2. Log in via `POST /auth/login` → copy `access_token`
3. Click **Authorize** → paste the token
4. Open `POST /ideas/create` → **Try it out** → enter a body → **Execute**
5. Response should be `201` with the full idea document

---

## Ideas — GET /ideas/list (List Ideas — Paginated)

### What it does

Returns the authenticated user's ideas from MongoDB as a paginated, sorted, optionally filtered list. Only ideas where `userId` matches the JWT are returned — users can never see each other's ideas. Supports `page`, `limit`, `sort_by`, `order`, `status`, and `tag` query parameters. All params are optional and combinable.

### Query parameters

| Param | Type | Default | Allowed values | Notes |
|---|---|---|---|
---|
| `page` | int | `1` | ≥ 1 | 1-based page number |
| `limit` | int | `10` | 1–100 | items per page |
| `sort_by` | string | `createdAt` | `createdAt`, `updatedAt`, `priority` | field to sort by |
| `order` | string | `desc` | `asc`, `desc` | sort direction |
| `status` | string | — | `raw`, `exploring`, `validated`, `building`, `shipped`, `abandoned` | filter by status (optional) |
| `tag` | string | — | any tag string, max 50 chars | filter to ideas whose tags array contains this value (optional) |

### Response shape

```json
{
  "items": [ ...IdeaResponse objects... ],
  "total": 42,
  "page": 1,
  "limit": 10
}
```

`total` is the count of all matching ideas (not just this page) — the frontend uses it to calculate total page count.

### Files created / changed

| File | What changed |
|---|---|
| `backend/app/schemas/idea.py` | Added `IdeaListResponse` — wraps `items`, `total`, `page`, `limit` |
| `backend/app/api/ideas.py` | Added `GET /ideas/list` route with pagination, sorting, and priority weight fix; added `status` and `tag` filter params |

### How filters work

`status` and `tag` are both optional. Omitting them returns all ideas. When provided, they are added directly to the MongoDB query filter:

- `?status=raw` → `{"status": "raw"}` added to the filter
- `?tag=AI` → `{"tags": "AI"}` added to the filter — MongoDB automatically matches documents where the `tags` array contains `"AI"`
- `?status=exploring&tag=mobile` → both conditions applied, only ideas matching both are returned

Filters compose cleanly with pagination and sorting — `?status=raw&tag=AI&sort_by=priority&order=desc&page=1&limit=5` is a valid request.

### How priority sorting works

`priority` is a string enum (`low`, `medium`, `high`). Sorting alphabetically gives the wrong order (`high < low < medium`). Instead, a MongoDB aggregation pipeline adds a temporary `_priorityWeight` field (`low=1`, `medium=2`, `high=3`), sorts by that number, then removes the field before returning. Result: `asc` = low → medium → high, `desc` = high → medium → low.

For `createdAt` and `updatedAt`, a simpler `find().sort().skip().limit()` is used — no pipeline needed.

### How to verify

**Step 1 — Restart the backend and get a token**

```bash
uvicorn app.main:app --reload --port 8000

TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

**Step 2 — Create a few test ideas (so there's data to page through)**

```bash
for title in "Idea One" "Idea Two" "Idea Three" "Idea Four" "Idea Five"; do
  curl -s -X POST http://localhost:8000/api/ideas/create \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"title\": \"$title\", \"priority\": \"high\"}" > /dev/null
done
```

**Step 3 — List all ideas (defaults: page=1, limit=10, sort_by=createdAt, order=desc)**

```bash
curl -s "http://localhost:8000/api/ideas/list" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

Expected response shape:
```json
{
  "items": [ ... ],
  "total": 5,
  "page": 1,
  "limit": 10
}
```

**Step 4 — Test pagination**

```bash
# Page 1 — first 2 ideas
curl -s "http://localhost:8000/api/ideas/list?page=1&limit=2" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool

# Page 2 — next 2 ideas
curl -s "http://localhost:8000/api/ideas/list?page=2&limit=2" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool

# Page 3 — last 1 idea (if total=5)
curl -s "http://localhost:8000/api/ideas/list?page=3&limit=2" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

**Step 5 — Test sorting**

```bash
# Oldest first
curl -s "http://localhost:8000/api/ideas/list?sort_by=createdAt&order=asc" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; items=json.load(sys.stdin)['items']; [print(i['title'], i['createdAt']) for i in items]"

# By priority — high first
curl -s "http://localhost:8000/api/ideas/list?sort_by=priority&order=desc" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; items=json.load(sys.stdin)['items']; [print(i['title'], i['priority']) for i in items]"

# By priority — low first
curl -s "http://localhost:8000/api/ideas/list?sort_by=priority&order=asc" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; items=json.load(sys.stdin)['items']; [print(i['title'], i['priority']) for i in items]"
```

**Step 6 — Test invalid params (should return 400)**

```bash
# Invalid sort_by — 400
curl -s "http://localhost:8000/api/ideas/list?sort_by=email" \
  -H "Authorization: Bearer $TOKEN"
# → {"detail": "Invalid sort_by 'email'. Must be one of: createdAt, priority, updatedAt"}

# Invalid order — 400
curl -s "http://localhost:8000/api/ideas/list?order=random" \
  -H "Authorization: Bearer $TOKEN"
# → {"detail": "Invalid order. Must be 'asc' or 'desc'"}
```

**Step 7 — Test auth protection**

```bash
# No token — 403
curl -s "http://localhost:8000/api/ideas/list"
# → {"detail": "Not authenticated"}

# Invalid JWT — 401
curl -s "http://localhost:8000/api/ideas/list" -H "Authorization: Bearer notreal"
# → {"detail": "Invalid or expired access token"}
```

**Step 8 — Test status filter**

```bash
# First create ideas with different statuses
curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Raw idea", "status": "raw", "tags": ["AI"]}' > /dev/null

curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Exploring idea", "status": "exploring", "tags": ["mobile"]}' > /dev/null

curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Shipped idea", "status": "shipped", "tags": ["AI", "mobile"]}' > /dev/null

# Filter by status only
curl -s "http://localhost:8000/api/ideas/list?status=raw" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; items=json.load(sys.stdin)['items']; [print(i['title'], i['status']) for i in items]"
# → only ideas with status="raw"

curl -s "http://localhost:8000/api/ideas/list?status=exploring" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total'], 'results')"
```

**Step 9 — Test tag filter**

```bash
# Filter by tag only
curl -s "http://localhost:8000/api/ideas/list?tag=AI" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; items=json.load(sys.stdin)['items']; [print(i['title'], i['tags']) for i in items]"
# → only ideas whose tags array contains "AI"

curl -s "http://localhost:8000/api/ideas/list?tag=mobile" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; items=json.load(sys.stdin)['items']; [print(i['title'], i['tags']) for i in items]"
# → ideas tagged "mobile"
```

**Step 10 — Test status + tag combined**

```bash
# Ideas that are BOTH status=shipped AND tagged AI
curl -s "http://localhost:8000/api/ideas/list?status=shipped&tag=AI" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
# → only "Shipped idea" (matches both conditions)

# status=raw AND tag=mobile — expect 0 results (no idea matches both)
curl -s "http://localhost:8000/api/ideas/list?status=raw&tag=mobile" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['total'], 'results')"
# → 0 results
```

**Step 11 — Test filters + sorting + pagination together**

```bash
# AI-tagged ideas, sorted by priority descending, page 1 of 2
curl -s "http://localhost:8000/api/ideas/list?tag=AI&sort_by=priority&order=desc&page=1&limit=2" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

**Step 12 — Test invalid status value (expect 422)**

```bash
curl -s "http://localhost:8000/api/ideas/list?status=notvalid" \
  -H "Authorization: Bearer $TOKEN"
# → 422 Unprocessable Entity — FastAPI rejects the enum automatically
```

**Step 13 — Verify via Swagger UI**

1. Open **http://localhost:8000/docs**
2. Log in via `POST /auth/login` → copy `access_token`
3. Click **Authorize** → paste the token
4. Open `GET /ideas/list` → **Try it out**
5. Test all four combinations:
   - No filters (leave `status` and `tag` blank) → all ideas
   - `status=raw` only → only raw ideas
   - `tag=AI` only → only AI-tagged ideas
   - `status=raw&tag=AI` → intersection of both filters
6. Response should be `200` with `items`, `total`, `page`, `limit`

---

## Ideas — GET /ideas/search (Search Ideas)

### What it does

Searches the authenticated user's ideas for a keyword across both `title` and `description`. The search is case-insensitive and matches partial strings — "ai" will match "Building an AI tool". Returns results as a paginated list, newest first. Only the logged-in user's ideas are searched.

### Query parameters

| Param | Required | Type | Default | Notes |
|---|---|---|---|---|
| `q` | ✅ | string | — | 1–200 chars; matched against title and description |
| `page` | ❌ | int | `1` | 1-based page number |
| `limit` | ❌ | int | `10` | 1–100 items per page |

### Response shape

Same as `GET /ideas/list`:
```json
{
  "items": [ ...IdeaResponse objects... ],
  "total": 3,
  "page": 1,
  "limit": 10
}
```

`total` reflects the number of ideas that matched the query (not just this page).

### Key design decisions

**Why `$regex` and not MongoDB Atlas full-text search?**
`$regex` works with any MongoDB deployment (including the self-hosted Docker container used here) with no extra configuration. Atlas search requires a managed Atlas cluster and index setup. For a personal idea vault with a relatively small dataset, `$regex` with the `i` option is fast enough and simpler to operate.

**Why `re.escape()` on the user's query?**
MongoDB's `$regex` accepts raw regex patterns. Without escaping, a user could send `q=.+` or `q=(` and either get unexpected matches or trigger a server error. `re.escape()` converts every special character to a literal, so `"(AI)"` becomes `"\(AI\)"` — a safe substring search, nothing more.

**Why search title AND description (not tags)?**
Title and description are free-text fields where users write natural language. Tags are short controlled labels — a dedicated `tags` filter (e.g. `?tag=AI`) is a better UX for that use case. Mixing them into the keyword search would produce confusing results.

**Why sort newest first and not expose `sort_by`?**
Search results are most useful when the most recently created ideas appear first — the user is likely looking for something they worked on recently. A `sort_by` parameter can be added later if needed.

### Files changed

| File | What changed |
|---|---|
| `backend/app/api/ideas.py` | Added `import re`; added `GET /ideas/search` route |

### How to verify

**Step 1 — Get a token and create some test ideas**

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Create ideas with different titles and descriptions
curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "AI-powered journal", "description": "Summarise daily notes using GPT", "tags": ["AI"]}' > /dev/null

curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Workout tracker", "description": "Track your gym sessions and progress", "tags": ["health"]}' > /dev/null

curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Recipe manager", "description": "AI-assisted meal planning and grocery lists", "tags": ["AI", "food"]}' > /dev/null
```

**Step 2 — Search by keyword in title**

```bash
curl -s "http://localhost:8000/api/ideas/search?q=AI" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
# → returns "AI-powered journal" (title match)
```

**Step 3 — Search by keyword in description**

```bash
curl -s "http://localhost:8000/api/ideas/search?q=meal" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
# → returns "Recipe manager" (description match)
```

**Step 4 — Confirm case-insensitivity**

```bash
# "ai" (lowercase) should match the same ideas as "AI"
curl -s "http://localhost:8000/api/ideas/search?q=ai" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total'], 'results')"

curl -s "http://localhost:8000/api/ideas/search?q=AI" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['total'], 'results')"
# → both should print the same total
```

**Step 5 — Confirm partial match**

```bash
# "track" should match "Workout tracker"
curl -s "http://localhost:8000/api/ideas/search?q=track" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; [print(i['title']) for i in json.load(sys.stdin)['items']]"
# → Workout tracker
```

**Step 6 — Test no results**

```bash
curl -s "http://localhost:8000/api/ideas/search?q=blockchain" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
# → {"items": [], "total": 0, "page": 1, "limit": 10}
```

**Step 7 — Test pagination**

```bash
# Assumes you have several ideas matching "idea"
curl -s "http://localhost:8000/api/ideas/search?q=idea&page=1&limit=2" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool

curl -s "http://localhost:8000/api/ideas/search?q=idea&page=2&limit=2" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

**Step 8 — Test validation errors**

```bash
# Missing q — 422
curl -s "http://localhost:8000/api/ideas/search" \
  -H "Authorization: Bearer $TOKEN"
# → 422 {"detail": [{"msg": "Field required", ...}]}

# Empty q — 422 (min_length=1)
curl -s "http://localhost:8000/api/ideas/search?q=" \
  -H "Authorization: Bearer $TOKEN"
# → 422

# q too long — 422 (max_length=200)
curl -s "http://localhost:8000/api/ideas/search?q=$(python3 -c 'print(\"x\"*201)')" \
  -H "Authorization: Bearer $TOKEN"
# → 422
```

**Step 9 — Test auth protection**

```bash
# No token — 403
curl -s "http://localhost:8000/api/ideas/search?q=AI"
# → {"detail": "Not authenticated"}

# Invalid JWT — 401
curl -s "http://localhost:8000/api/ideas/search?q=AI" \
  -H "Authorization: Bearer notreal"
# → {"detail": "Invalid or expired access token"}
```

**Step 10 — Verify via Swagger UI**

1. Open **http://localhost:8000/docs**
2. Authorize with your access token
3. Open `GET /ideas/search` → **Try it out**
4. Enter a keyword in the `q` field → **Execute**
5. Expected `200` with `items`, `total`, `page`, `limit`

---

## Ideas — GET /ideas/get/{id} (Get Single Idea)

### What it does

Fetches a single idea by its MongoDB `_id`. Requires a valid JWT. Returns the full `IdeaResponse` if found and owned by the caller.

### Security logic (order is intentional)

| Step | Condition | Response |
|---|---|---|
| 1 | `idea_id` is not a valid 24-hex ObjectId | `404 Not Found` |
| 2 | No document found with that `_id` | `404 Not Found` |
| 3 | Document exists but `userId` ≠ caller's id | `403 Forbidden` |
| 4 | Document exists and `userId` matches | `200 OK` + idea |

**Why 403 and not 404 when the idea belongs to someone else?**

Returning `404` for cross-user access lets attackers confirm whether an id exists by signing up as two different users and probing the same id — if one gets `404` and the other gets `200`, the id is valid. Returning `403` always for ownership mismatches closes that information leak.

**Why invalid ObjectId format → 404?**

If we returned `422` for a malformed id (e.g. `"abc"`), attackers could distinguish format-valid ids from format-invalid ones. Treating both as `404` gives nothing away.

### Files changed

| File | What changed |
|---|---|
| `backend/app/api/ideas.py` | Added `_parse_object_id()` helper and `GET /ideas/get/{idea_id}` route |

### How to verify

**Step 1 — Get a token and an idea id**

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Create an idea and capture its id
IDEA_ID=$(curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "My idea"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "Idea ID: $IDEA_ID"
```

**Step 2 — Fetch the idea by id**

```bash
curl -s "http://localhost:8000/api/ideas/get/$IDEA_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

Expected `200`:
```json
{
  "id": "664a1b2c3d4e5f6a7b8c9d0e",
  "userId": "...",
  "title": "My idea",
  "description": null,
  "tags": [],
  "status": "raw",
  "priority": "low",
  "createdAt": "2026-05-03T...",
  "updatedAt": "2026-05-03T..."
}
```

**Step 3 — Test 404 (nonexistent id)**

```bash
# Valid ObjectId format but doesn't exist in DB
curl -s "http://localhost:8000/api/ideas/000000000000000000000000" \
  -H "Authorization: Bearer $TOKEN"
# → {"detail": "Idea not found"}
```

**Step 4 — Test 404 (invalid ObjectId format)**

```bash
curl -s "http://localhost:8000/api/ideas/not-an-id" \
  -H "Authorization: Bearer $TOKEN"
# → {"detail": "Idea not found"}
# Same 404 — format information is not leaked
```

**Step 5 — Test 403 (idea belongs to another user)**

```bash
# Register a second user
curl -s -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "other@example.com", "password": "Other1234"}'

# Log in as the second user
TOKEN2=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "other@example.com", "password": "Other1234"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Try to access the first user's idea using the second user's token
curl -s "http://localhost:8000/api/ideas/get/$IDEA_ID" \
  -H "Authorization: Bearer $TOKEN2"
# → 403 {"detail": "You do not have permission to access this idea"}
```

**Step 6 — Test auth protection**

```bash
# No token — 403
curl -s "http://localhost:8000/api/ideas/get/$IDEA_ID"

# Expired/invalid JWT — 401
curl -s "http://localhost:8000/api/ideas/get/$IDEA_ID" \
  -H "Authorization: Bearer notreal"
```

**Step 7 — Verify via Swagger UI**

1. Open **http://localhost:8000/docs**
2. Authorize with a valid access token
3. Open `GET /ideas/get/{idea_id}` → **Try it out** → paste a real idea id → **Execute**
4. Expected `200` with the full idea document

---

## Ideas — PUT /ideas/update/{id} (Update Idea)

### What it does

Partially updates an idea owned by the authenticated user. Only fields explicitly included in the request body are modified — omitted fields are left unchanged in MongoDB. Always stamps `updatedAt` with the current UTC time on every successful update. Returns the full updated document.

### Key design decisions

**Why partial update (not full replace)?**
The client might only want to change `status` from `raw` → `exploring`. Requiring the entire document forces the client to re-send all fields, risking accidental overwrites. `model_dump(exclude_unset=True)` captures only what was sent, and MongoDB's `$set` writes only those fields — the rest are untouched.

**Why always update `updatedAt`?**
Timestamps track when a document was last touched, not just when payload fields changed. If the same title is sent twice, `updatedAt` still advances — consistent with standard REST conventions.

**Why re-fetch after update instead of merging in Python?**
The response must reflect exactly what's in MongoDB. Building the response locally by merging old + new fields risks subtle drift. Re-fetching guarantees consistency.

**Ownership check: 403, not 404**
Same rule as `GET /ideas/get/{id}` — see that section for the full rationale.

### All fields are optional in the request body

| Field | Type | Notes |
|---|---|---|
| `title` | string | 1–200 chars if provided |
| `description` | string or null | max 5000 chars |
| `tags` | array of strings | same validation as POST |
| `status` | enum | `raw`, `exploring`, `validated`, `building`, `shipped`, `abandoned` |
| `priority` | enum | `low`, `medium`, `high` |

### Files changed

| File | What changed |
|---|---|
| `backend/app/api/ideas.py` | Added `IdeaUpdate` to imports; added `PUT /ideas/update/{idea_id}` route |

### How to verify

**Step 1 — Get a token and create an idea**

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

IDEA_ID=$(curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Original title", "status": "raw", "priority": "low"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "Idea ID: $IDEA_ID"
```

**Step 2 — Update a single field only**

```bash
curl -s -X PUT "http://localhost:8000/api/ideas/update/$IDEA_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "exploring"}' \
  | python3 -m json.tool
# → status is now "exploring", all other fields unchanged, updatedAt advanced
```

**Step 3 — Update multiple fields at once**

```bash
curl -s -X PUT "http://localhost:8000/api/ideas/update/$IDEA_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Updated title",
    "priority": "high",
    "tags": ["AI", "SaaS"]
  }' \
  | python3 -m json.tool
```

**Step 4 — Confirm `updatedAt` advanced but `createdAt` is unchanged**

```bash
curl -s "http://localhost:8000/api/ideas/get/$IDEA_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print('created:', d['createdAt']); print('updated:', d['updatedAt'])"
# createdAt and updatedAt should differ
```

**Step 5 — Test 404 (nonexistent id)**

```bash
curl -s -X PUT "http://localhost:8000/api/ideas/000000000000000000000000" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "Ghost"}' 
# → {"detail": "Idea not found"}
```

**Step 6 — Test 403 (idea belongs to another user)**

```bash
# Log in as a different user (must already exist)
TOKEN2=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "other@example.com", "password": "Other1234"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s -X PUT "http://localhost:8000/api/ideas/update/$IDEA_ID" \
  -H "Authorization: Bearer $TOKEN2" \
  -H "Content-Type: application/json" \
  -d '{"title": "Hijacked"}' 
# → 403 {"detail": "You do not have permission to update this idea"}
```

**Step 7 — Test validation errors (422)**

```bash
# Invalid status value
curl -s -X PUT "http://localhost:8000/api/ideas/update/$IDEA_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "notvalid"}'

# Title too long
curl -s -X PUT "http://localhost:8000/api/ideas/update/$IDEA_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"title\": \"$(python3 -c 'print(\"x\"*201)')\"}"
```

**Step 8 — Verify via Swagger UI**

1. Open **http://localhost:8000/docs**
2. Authorize with your access token
3. Open `PUT /ideas/update/{idea_id}` → **Try it out**
4. Paste the idea id and a partial body (e.g. `{"priority": "high"}`)
5. Expected `200` with the full updated idea document

---

## Ideas — DELETE /ideas/delete/{id} (Delete Idea)

### What it does

Permanently deletes an idea owned by the authenticated user. Returns `204 No Content` on success with no response body. Returns `404` if the idea does not exist (or the id is malformed), and `403` if the idea exists but belongs to a different user.

### Key design decisions

**Why fetch before delete?**
`delete_one` only tells you how many documents were deleted (`deleted_count`). If that count is 0, it could mean either "not found" or "wrong owner" — you can't distinguish the two. Fetching first lets us check existence (404) and ownership (403) separately, giving the client accurate error information.

**Why 403 instead of 404 when the idea belongs to someone else?**
Same rule as `GET /ideas/get/{id}` and `PUT /ideas/update/{id}` — the authenticated user can tell the resource exists but they are not allowed to touch it. Hiding it as 404 is more secure but inconsistent with the rest of the API design here.

**Why `Response(status_code=204)` instead of returning `None`?**
FastAPI skips body serialisation when you explicitly return a `Response` object. Returning `None` could cause FastAPI to try serialising `null` or leave an ambiguous response depending on the declared `response_model`. Explicit is safer.

### Files changed

| File | What changed |
|---|---|
| `backend/app/api/ideas.py` | Added `Response` to FastAPI imports; added `DELETE /ideas/delete/{idea_id}` route |

### How to verify

**Step 1 — Create an idea to delete**

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "Secret123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

IDEA_ID=$(curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "To be deleted", "priority": "low"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

echo "Idea ID: $IDEA_ID"
```

**Step 2 — Delete the idea (expect 204)**

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X DELETE "http://localhost:8000/api/ideas/delete/$IDEA_ID" \
  -H "Authorization: Bearer $TOKEN"
# → 204
```

**Step 3 — Confirm it's gone (expect 404)**

```bash
curl -s -X GET "http://localhost:8000/api/ideas/get/$IDEA_ID" \
  -H "Authorization: Bearer $TOKEN"
# → {"detail": "Idea not found"}
```

**Step 4 — Test 404 with a nonexistent id**

```bash
curl -s -X DELETE "http://localhost:8000/api/ideas/000000000000000000000000" \
  -H "Authorization: Bearer $TOKEN"
# → {"detail": "Idea not found"}
```

**Step 5 — Test 403 (idea belongs to another user)**

```bash
# Create an idea with user 1, then try to delete it with user 2
TOKEN2=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "other@example.com", "password": "Other1234"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

IDEA_ID=$(curl -s -X POST http://localhost:8000/api/ideas/create \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "User 1 idea"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

curl -s -X DELETE "http://localhost:8000/api/ideas/delete/$IDEA_ID" \
  -H "Authorization: Bearer $TOKEN2"
# → 403 {"detail": "You do not have permission to delete this idea"}
```

**Step 6 — Test 401 (no token)**

```bash
curl -s -X DELETE "http://localhost:8000/api/ideas/delete/$IDEA_ID"
# → 403 {"detail": "Not authenticated"}
```

**Step 7 — Verify via Swagger UI**

1. Open **http://localhost:8000/docs**
2. Authorize with your access token
3. Open `DELETE /ideas/delete/{idea_id}` → **Try it out**
4. Paste a valid idea id owned by you
5. Expected `204` with an empty response body










