# Idea Vault — Engineering Quality Charter

This project must be built and maintained as a production-grade system.

## Mission

Build software that is secure, reliable, maintainable, testable, and deployable by one engineer to professional standards.

## Non-Negotiable Standards

- Security first: least privilege, strict validation, safe defaults, no secret leakage
- Correctness first: predictable behavior, explicit error handling, no silent failure paths
- Reliability first: graceful degradation, retries/backoff where appropriate, observable failures
- Maintainability first: clear boundaries, simple APIs, readable code, low coupling
- Performance awareness: measure, then optimize hotspots

## Security Rules

- Never trust client input; validate every field at API boundary
- Enforce user isolation at query layer (`userId` scope on every data access)
- Store tokens in httpOnly cookies; avoid exposing sensitive tokens to JS
- Keep CORS minimal and explicit per environment
- Never hardcode secrets in code; use environment variables and secret managers
- Avoid verbose internal errors in client responses; log details server-side

## Code Quality Rules

- Prefer simple, explicit code over clever abstractions
- Keep functions small and single-purpose
- Add comments only when intent is not obvious from code
- Preserve consistent naming and data shape conventions
- Use typed schemas/contracts between layers
- Backward compatibility: avoid breaking API shapes without migration notes

## API + Data Rules

- Validate payloads with schema models
- Return stable response structures and status codes
- Make write operations idempotent where feasible
- Handle partial failures explicitly
- Keep DB indexes aligned with query patterns

## Frontend Rules

- UI must reflect loading, success, and error states clearly
- Avoid duplicate API logic; centralize auth/refresh behavior
- Keep components composable and focused
- Prefer optimistic updates only with rollback safeguards

## Observability Rules

- Log key decision points (intent, model tier, fallback usage, request failures)
- Keep logs structured and safe (no secrets/PII leakage)
- Include enough context to debug production incidents quickly

## Testing Rules

- Every critical flow has at least smoke coverage
- Regressions get tests that would have caught them
- Validate auth, permissions, and rate-limit behavior explicitly

## Deployment Rules

- Production env must be reproducible and documented
- Changes ship in small, reviewable increments
- Each release has rollback path
- Post-deploy smoke checks are mandatory

## Portfolio Outcome Goal

This repository should demonstrate ability to design, build, secure, deploy, and operate a real production-style system end-to-end as a solo engineer.
