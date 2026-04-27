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
