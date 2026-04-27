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


