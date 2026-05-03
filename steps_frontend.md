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
