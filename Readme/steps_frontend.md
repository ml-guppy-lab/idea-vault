# Frontend Steps

---

## Step 1 — Install Dependencies

```bash
cd frontend
npm install axios react-hook-form zod @hookform/resolvers next-auth
```

npm run dev

---

## Step 2 — Shared API Client

**`lib/api.ts`** — axios instance pointing to `NEXT_PUBLIC_API_URL` (set in `frontend/.env.local`).

---

## Step 3 — Sign Up Page (`/signup`)

**Files:**
- `components/auth/BackgroundOrbs.tsx` — decorative gradient orbs
- `components/auth/AuthCard.tsx` — glassmorphism card wrapper
- `components/auth/GoogleButton.tsx` — Google OAuth button
- `components/auth/SignupForm.tsx` — form with Zod validation + API call
- `app/(auth)/signup/page.tsx` — page entry point
- `app/globals.css` — added `auth-card-enter` fade-in animation

**API call:** `POST /api/auth/register` → `{ email, password }` → redirect to `/login` on success.

**Validation:**
- email — valid format
- password — min 8 chars, ≥1 uppercase, ≥1 number
- confirmPassword — must match password

**Testing:**

```bash
# Start backend
cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 8000

# Start frontend
cd frontend && npm run dev
```

1. Open `http://localhost:3000/signup`
2. Submit empty → inline validation errors appear
3. Register with valid data → redirects to `/login`
4. Confirm account exists:
```bash
curl -s -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "Secret123"}' | python3 -m json.tool
```
5. Try same email again → inline error: `Email already registered`

---

## Step 4 — Login Page (`/login`)

**Files:**
- `components/auth/LoginForm.tsx` — email + password form, Zod validation, Google button
- `app/(auth)/login/page.tsx` — same glass card design as signup

**API call:** `POST /api/auth/login` → `{ email, password }` → tokens stored in httpOnly cookies via `/api/auth/session` → redirect to `/dashboard`.

**Google button:** redirects browser to `GET /api/auth/google` on the backend, which starts the OAuth flow.

**Testing:**
1. Open `http://localhost:3000/login`
2. Submit empty → inline errors appear
3. Wrong password → inline error: `Invalid credentials`
4. Valid credentials → redirects to `/dashboard`
5. Click "Continue with Google" → redirects to Google account picker → lands on `/dashboard`

---

## Step 5 — httpOnly Cookie Session (`/api/auth/session`)

**File:** `app/api/auth/session/route.ts` — Next.js server-side route handler.

- `POST { access_token, refresh_token }` → sets both as `httpOnly`, `sameSite=lax` cookies. JS on the page can never read these (XSS mitigation).
- `DELETE` → clears both cookies (for logout).
- Cookie lifetimes match backend: access token 15 min, refresh token 180 days.

---

## Step 6 — Google OAuth Callback (`/auth/callback`)

**File:** `app/auth/callback/page.tsx`

After Google OAuth completes, the backend redirects to `/auth/callback?access_token=...&refresh_token=...`. This page:
1. Reads tokens from query params
2. Strips them from the URL immediately (`history.replaceState`) so they don't linger in browser history
3. POSTs to `/api/auth/session` to set httpOnly cookies
4. Redirects to `/dashboard` (or `/login?error=...` on failure)

**Testing:**
1. Click "Continue with Google" on `/login` or `/signup`
2. Complete Google sign-in
3. Verify you land on `/dashboard` (not stuck on `/auth/callback`)
4. DevTools → Application → Cookies → confirm `access_token` and `refresh_token` cookies are present and flagged `HttpOnly`

---

## Step 7 — Dashboard Placeholder (`/dashboard`)

**File:** `app/dashboard/page.tsx` — placeholder page so OAuth redirect doesn't 404.

Full dashboard UI is the next step.

---

## Step 8 — Route Protection Middleware

**Files:**
- `middleware.ts` — Next.js Edge middleware, runs before every matched request
- `frontend/.env.local` — added `JWT_SECRET` (same value as backend `SECRET_KEY`)

**Install:** `npm install jose` (Edge-compatible JWT library — Node's built-in crypto doesn't run in the Edge runtime)

**What it does:**
- Reads the `access_token` httpOnly cookie and verifies the JWT signature + expiry using `jose`
- **Protected routes** (`/dashboard/*`): if token missing or expired → redirect to `/login?next=<original-path>`
- **Auth routes** (`/login`, `/signup`): if token valid → redirect to `/dashboard` (logged-in users can't revisit login)
- All other paths (API routes, static files) are skipped via the `matcher` config

**Testing:**
1. Clear all cookies in DevTools → visit `http://localhost:3000/dashboard` → should redirect to `/login`
2. Log in → visit `/login` again → should redirect straight to `/dashboard`
3. DevTools → Application → Cookies → manually delete `access_token` → refresh any `/dashboard` page → redirected to `/login`

---

## Running the full stack

```bash
# Everything via Docker (recommended)
docker compose up --build
# → frontend: http://localhost:3000
# → backend:  http://localhost:8000

# OR for hot-reload during development:
docker compose up          # runs DBs only if backend has volume mount
cd frontend && npm run dev # frontend with hot-reload on :3000 (or :3001 if 3000 is taken)
```

> If `npm run dev` starts on port 3001, update `FRONTEND_URL=http://localhost:3001` in `backend/.env` and restart uvicorn — otherwise Google OAuth redirects back to the wrong port.

---

## Step 9 — Dashboard (Server + Client)

**Files:**
- `app/dashboard/page.tsx` — server component: fetches ideas + user in parallel via `INTERNAL_API_URL`, passes to client
- `components/DashboardClient.tsx` — client component: search, filter pills, responsive card grid, empty state, skeleton loader
- `components/IdeaCard.tsx` — reusable idea card with glassmorphism, status/priority badges, tags, dark mode

**API call:** `GET /ideas/list?limit=100` — server-side with Bearer token from httpOnly cookie.

**Search & Filter:** client-side `useMemo` over all fetched ideas — no extra API calls. Filter by status, search across title + description + tags.

**Responsive grid:** `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`

---

## Step 10 — Create Idea Page (`/dashboard/ideas/new`)

**File:** `app/dashboard/ideas/new/page.tsx` — client component.

**API proxy:** `app/api/ideas/create/route.ts` — server route reads `access_token` cookie, forwards to backend with Bearer header.

**Tag handling:** tags entered comma-separated; pending tag flushed at submit time so the last tag is never lost.

**Sends lowercase** status/priority to match backend enum validation.

---

## Step 11 — Idea Detail / Edit / Delete (`/dashboard/ideas/[id]`)

**File:** `app/dashboard/ideas/[id]/page.tsx` — client component.

**API proxy:** `app/api/ideas/[id]/route.ts` — handles GET / PUT / DELETE.

Key fixes applied:
- `const { id } = use(params)` — Next.js 15+ makes page params a Promise; must use `React.use()`
- Tags in edit mode: `reset()` called explicitly on Edit button click (not in `useEffect`) to avoid stale state
- Pending `tagInput` flushed before PUT so last tag is never lost
- Delete uses shadcn `AlertDialog` for confirmation → `DELETE /ideas/delete/{id}` → redirect to `/dashboard`

---

## Step 12 — Docker Networking Fix

`NEXT_PUBLIC_API_URL` is baked at build time and works in browsers. Server-side Next.js code (API proxy routes, server components) cannot use `localhost` inside Docker — it resolves to the container's own loopback, not the backend service.

**Fix:** Added `INTERNAL_API_URL=http://backend:8000/api` to `docker-compose.yml` under the `frontend` service environment.

All server-side fetches use the fallback chain:
```ts
process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api"
```

---

## Step 13 — Dark Mode Fixes

**Problem:** Inline `style={{ color, background }}` always beats Tailwind className dark variants in CSS specificity.

**Fix:** Moved all color/background values for dark-mode-sensitive elements to Tailwind className utilities:
- IdeaCard tags: `className="bg-white/60 dark:bg-white/10 text-[#3d6678] dark:text-[#c8dff0]"` (no inline background)
- Search input: `bg-white/60 dark:bg-white/10`, `text-[#1a3a44] dark:text-[#8fafc8]`
- Auth page inputs: `color: "#1a3a44"` hardcoded inline (overrides theme inheritance intentionally)

**Auth pages forced to light mode:** `app/(auth)/layout.tsx` — client layout removes `dark` class from `document.documentElement` on mount, restores on unmount.

**Tailwind v4 dark variant syntax:** `@custom-variant dark (&:is(.dark *))` in `globals.css` — dark variants work via className only, never via inline `style={}`.

---

## Step 14 — CORS Configuration (Backend)

**File:** `backend/app/main.py`

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,   # ["http://localhost:3000"]
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
```

`allow_origins=["*"]` is never used — locks the API to the frontend origin only.

---

## Step 15 — Profile Page (`/dashboard/profile`)

**Backend changes:**
- `models/user.py` — added columns: `display_name`, `bio`, `gender`, `date_of_birth`, `avatar_url`
- `db/postgres.py` — idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` migrations run at startup (no Alembic needed for v1)
- `schemas/user.py` — added `ProfileRead`, `ProfileUpdate`, `AvatarUpload`, `ChangePasswordRequest`
- `api/profile.py` — new router: `GET/PATCH /profile/me`, `POST /profile/avatar`, `POST /profile/change-password`
- `main.py` — registered profile router at `/api`

**Frontend files:**
- `app/api/profile/route.ts` — proxy: GET + PATCH
- `app/api/profile/avatar/route.ts` — proxy: POST avatar (base64 data URL)
- `app/api/profile/change-password/route.ts` — proxy: POST change-password
- `app/dashboard/profile/page.tsx` — full profile page

**Profile page sections:**
1. **Avatar** — upload photo (converted to base64 data URL client-side, max 3 MB), preview shown immediately
2. **Personal info** — display name, bio (500 chars), gender (enum), date of birth, email (read-only)
3. **Change password** — current password + new password + confirm; hidden entirely for Google OAuth users

**Password change security:**
- Current password verified with bcrypt before accepting new one
- Same strength rules as registration (8+ chars, 1 uppercase, 1 number)
- On success: **all refresh tokens revoked** in DB → forces re-login on every device
- Frontend redirects to `/login` after 2.5 s
- Google OAuth users: section hidden in UI; backend also hard-blocks the endpoint

**Dashboard layout update:** `app/dashboard/layout.tsx` now passes `display_name` and `avatar_url` from `/auth/me` to Navbar so the avatar shows the uploaded photo.

---

## Step 16 — Settings Page (`/dashboard/settings`)

**File:** `app/dashboard/settings/page.tsx`

Sections:
- **Appearance** — Light / Dark theme toggle (persisted by `next-themes`)
- **About** — App name, version, tagline

---

## Step 17 — Navbar Responsive Fixes

**Changes to `components/Navbar.tsx`:**

- **Mobile:** only logo + "Idea Vault" text + hamburger visible. Everything else hidden.
- **Desktop:** full nav bar with links, theme toggle, avatar + dropdown.
- Removed `Explore` link and nav entry entirely.
- Nav links section B: replaced `style={{ display: "flex" }}` + `className="hidden md:flex"` with pure `className="hidden md:flex items-center gap-1"` — inline style was overriding the `hidden` class.
- Avatar + dropdown wrapper: `className="hidden md:flex"` — hidden on mobile.
- Hamburger panel contains: Dashboard, Profile, Settings links + theme toggle + user info + logout.
- "Idea Vault" logo text: always visible (removed `hidden sm:inline`).

**Horizontal scroll fix:**
- `app/layout.tsx` body: `overflow-x-hidden`
- `app/layout.tsx` html element: `overflow-x-hidden`
- Both needed — html is the scroll root, body alone is insufficient.

