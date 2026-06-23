# Idea Vault — V5 Readiness Checklist

Use this before starting Version 5. Mark each item done.

## A) Baseline Product Stability

- [ ] Backend starts cleanly (no startup exceptions, no hidden migration failures)
- [ ] Frontend builds and serves without runtime crashes
- [ ] Auth flow works end-to-end: signup, verify email, login, refresh, logout
- [ ] Vault AI chat works end-to-end (status events + streamed response + safe error handling)
- [ ] AI Agent flow works end-to-end (propose, accept, reject)
- [ ] Idea CRUD works across dashboard and detail pages
- [ ] Task CRUD works inside idea detail page
- [ ] Profile flows work (view/update profile, avatar, password change rules)

## B) Environment + Deployment Readiness

- [ ] Render env vars are complete and non-empty for backend and frontend
- [ ] `DATABASE_URL` points to production Postgres and connects on startup
- [ ] `REDIS_URL` uses valid scheme (`redis://` or `rediss://`)
- [ ] MongoDB Atlas network access allows Render backend traffic
- [ ] Cloudinary keys are valid and upload endpoint succeeds from production
- [ ] Resend config is valid for current delivery mode (`EMAIL_OVERRIDE_TO` policy explicit)
- [ ] OAuth redirect URIs match production URLs exactly
- [ ] CORS allowlist is minimal and production-correct

## C) AI + Agent Reliability Readiness

- [ ] Intent classification returns only expected labels
- [ ] Compound query decomposition handles multi-intent prompts correctly
- [ ] Model tier logs show intent, selected tier, and selected model
- [ ] Primary + fallback model IDs are active and available
- [ ] 429 handling is graceful for both Vault AI and Agent endpoints
- [ ] Agent returns controlled errors when provider limits are exceeded
- [ ] Agent read-tool retrieval never incorrectly claims vault is empty when fallback context exists

## D) Agentic Workflow Readiness

- [ ] Proposal schemas are stable and validated (`idea_update`, `idea_creation`, `task_creation`)
- [ ] `/api/agent` is proposal-only (no unintended writes)
- [ ] `/api/agent/decide` enforces accept/reject contract strictly
- [ ] Accept path requires full proposal payload and ID consistency
- [ ] Reject path is side-effect free
- [ ] Ownership checks are enforced before applying proposal writes
- [ ] Diff UI clearly shows before/after values for update proposals
- [ ] Agent page and Vault AI page remain clearly separated in navigation/UX

## E) Data + Security Readiness

- [ ] Every idea/task query is user-scoped (`userId` enforced in read and write paths)
- [ ] Input validation exists on all write endpoints and BFF routes
- [ ] No secrets committed in code, docs, or git history
- [ ] Sensitive/costly endpoints have rate limiting
- [ ] Upload validation enforces file type via magic bytes and size limits
- [ ] Client-facing errors are sanitized (no internal trace/details leakage)
- [ ] Token handling remains cookie-based and httpOnly where required

## F) Frontend BFF + UX Readiness

- [ ] Next.js API routes proxy backend requests consistently
- [ ] Centralized refresh logic is reused (no duplicated ad-hoc auth forwarding)
- [ ] 401 retry behavior avoids loops and stale-token edge cases
- [ ] Non-JSON and empty-body proxy responses are handled safely
- [ ] Loading, success, and error states are explicit for async user actions
- [ ] Agent proposal cards handle accept/reject state transitions cleanly
- [ ] Mobile responsiveness is verified for chat, agent, task, and profile views

## G) Testing + Operational Readiness

- [ ] Local smoke tests pass for auth, ideas, tasks, Vault AI, and Agent mode
- [ ] At least one regression test exists for each major historical bug class
- [ ] Production smoke test checklist is documented and repeatable
- [ ] Logs include enough context to debug failures quickly
- [ ] Rollback approach is known for backend, frontend, and env changes

## H) V5 Planning Gate

Start V5 only when all are true:

- [ ] No known P0 or P1 bugs open
- [ ] Current deployment is repeatable from a clean environment
- [ ] V5 scope is split into small milestones with clear acceptance criteria
- [ ] Risk controls are defined for each milestone (failure mode + mitigation)
- [ ] Test plan and rollback note exist for each milestone

