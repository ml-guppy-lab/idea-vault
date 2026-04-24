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

# 5. Start dev server
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
