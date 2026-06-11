# Idea Vault — V4 Readiness Checklist

Use this before starting Version 4. Mark each item done.

## A) Baseline Stability

- [ ] Backend starts cleanly (no startup exceptions in logs)
- [ ] Frontend builds and serves without runtime errors
- [ ] Core auth flow works: signup, verify email, login, logout, token refresh
- [ ] Chat flow works end-to-end from UI to backend SSE stream
- [ ] Idea CRUD works: create, read, update, delete
- [ ] Task CRUD works inside idea detail page

## B) Environment + Deploy Readiness

- [ ] Render backend env vars are complete and non-empty
- [ ] `REDIS_URL` uses correct TCP URL with scheme (`redis://` or `rediss://`)
- [ ] Atlas network access allows Render traffic
- [ ] PostgreSQL URL points to production DB (not localhost)
- [ ] CORS origin list includes production frontend URL only
- [ ] Google OAuth redirect URI matches production backend callback exactly
- [ ] Resend configuration is valid (`EMAIL_OVERRIDE_TO` kept until domain verified)

## C) AI/RAG Readiness

- [ ] Intent classification returns one of expected intents
- [ ] Compound query decomposition handles multi-part prompts
- [ ] Model tier routing logs show selected intent/tier/model
- [ ] OpenRouter model IDs are currently active (no 404)
- [ ] Fallback model is different from primary tier model and provider pool if possible
- [ ] 429 behavior is graceful (no app crash, user gets controlled error/degraded path)

## D) Data + Security Readiness

- [ ] All idea/task DB queries are user-scoped (`userId` enforced)
- [ ] No secrets committed in git history or docs
- [ ] Request validation exists for all write endpoints
- [ ] Rate limiting exists on sensitive/costly endpoints
- [ ] File upload validation checks MIME/magic bytes and size limits
- [ ] Error responses avoid leaking internal implementation details

## E) Frontend API/BFF Readiness

- [ ] Next.js API routes proxy backend requests consistently
- [ ] Cookie refresh logic is centralized and reused
- [ ] 401 retry flow avoids infinite loops
- [ ] DELETE/204 and non-JSON response paths handled safely
- [ ] Loading/error states shown in UI for all async actions

## F) Testing + Verification

- [ ] Smoke tests pass locally for auth, ideas, tasks, chat
- [ ] At least one regression test exists for each V3 critical bug fix
- [ ] Manual production smoke test documented and re-runnable
- [ ] Logs include enough context to debug failures quickly

## G) V4 Planning Gate

Start V4 only when all are true:

- [ ] No known P0/P1 bugs open
- [ ] Deployment is repeatable from clean environment
- [ ] Feature scope for V4 is split into small milestones
- [ ] Rollback strategy is clear for each milestone

## Suggested First Prompt For New Chat

"Audit current V3 codebase against Readme/v4_readiness_checklist.md and produce a phased V4 implementation plan with risk controls, tests, and rollback notes."
