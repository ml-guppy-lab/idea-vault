# Idea Vault

> Never lose a thought again.

A full-stack idea management application built and deployed end-to-end — from database design to production infrastructure. Users can capture, organise, and revisit their ideas from anywhere.

**Live:** [idea-vault-frontend.onrender.com](https://idea-vault-frontend.onrender.com)

---

## Screenshots

| Login | Dashboard |
|-------|-----------|
| ![Login page](screenshots/login.png) | ![Dashboard](screenshots/dashboard.png) |

| Create Idea | Idea Detail |
|-------------|-------------|
| ![Create idea](screenshots/create-idea.png) | ![Idea detail](screenshots/idea-detail.png) |

| Profile | Settings |
|---------|----------|
| ![Profile](screenshots/profile.png) | ![Settings](screenshots/settings.png) |

---

## What It Does

- **Capture ideas** with a title, description, tags, and status (Draft / Active / Archived)
- **Dashboard** with live search and tag filtering across all your ideas
- **Full CRUD** — create, view, edit, and delete ideas
- **Google OAuth + email/password authentication** with secure httpOnly JWT cookies
- **User profiles** — avatar upload, bio, display name, date of birth
- **Password management** — change password with automatic session revocation
- **Dark / Light theme** toggle, persisted across sessions
- **Fully responsive** — works on mobile, tablet, and desktop

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS v4 |
| Backend | FastAPI (Python 3.12), SQLAlchemy, Pydantic v2 |
| Databases | PostgreSQL (relational), MongoDB (document store), Redis (caching / session) |
| Auth | JWT (access + refresh tokens), Google OAuth 2.0 |
| Infrastructure | Docker, Docker Compose (local), Render (production) |

---

## Architecture

```
Browser
  │
  ▼
Next.js (Render)          ← handles SSR, routing, auth middleware
  │
  ▼  (internal network)
FastAPI (Render)           ← REST API, business logic, auth
  │
  ├── PostgreSQL (Render)  ← users, ideas
  ├── MongoDB (Atlas)      ← flexible document storage
  └── Redis (Render)       ← refresh token store, caching
```

- **Server-side rendering** for fast initial loads and SEO-ready pages
- **httpOnly cookies** for tokens — not accessible to JavaScript, protected against XSS
- **Middleware-based route protection** — unauthenticated users redirected at the edge
- **Dockerised** for consistent local dev and production parity

---

## Running Locally

```bash
git clone https://github.com/ml-guppy-lab/idea-vault.git
cd idea-vault-code

# add your env vars (see .env.example files in backend/ and frontend/)
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000)

---

## Project Structure

```
idea-vault-code/
├── backend/          # FastAPI app (auth, ideas, profile APIs)
├── frontend/         # Next.js app (pages, components, API proxy routes)
└── docker-compose.yml
```

---

## Contributing

All features are developed in `feature/<name>` branches and merged into `dev`. `main` is production-only.

