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
