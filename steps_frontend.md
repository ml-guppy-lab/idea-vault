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
