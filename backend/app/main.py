from contextlib import asynccontextmanager
import logging
import sys

from fastapi import FastAPI

# ---------------------------------------------------------------------------
# Logging — must be configured BEFORE uvicorn loads.
#
# Uvicorn calls logging.config.dictConfig() at startup which replaces the root
# logger's handlers. Any logger that relies on root propagation (including
# app.services.email_service) ends up with no handler and silently drops logs.
#
# Fix: give the "app" namespace its own StreamHandler pointing to stdout so it
# works regardless of what uvicorn does to the root logger.
# ---------------------------------------------------------------------------
_app_log = logging.getLogger("app")
if not _app_log.handlers:
    _h = logging.StreamHandler(sys.stdout)
    _h.setFormatter(
        logging.Formatter(
            "%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    _app_log.addHandler(_h)
    _app_log.setLevel(logging.DEBUG)  # DEBUG in dev; raise to INFO in prod
    _app_log.propagate = False  # avoid double-printing via root

from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.api import auth, ideas, profile, chat, tasks, agent, collections, ai
from app.core.config import settings
from app.db.postgres import init_db
from app.db.mongodb import close_mongo_connection, connect_to_mongo
from app.db.redis import close_redis_connection, connect_to_redis

# Import SQLAlchemy models so they are registered with Base before create_all
# Only PostgreSQL models — ideas are stored in MongoDB, not here
from app.models import user, refresh_token  # noqa: F401


# ── Sentry error tracking — inert unless SENTRY_DSN is set ─────────────────────
# Initialised before the app is created so it wraps startup and every request.
# FastAPI/Starlette integrations are auto-enabled by sentry-sdk. We never send
# PII (send_default_pii=False) so tokens, cookies, and request bodies stay out.
if settings.SENTRY_DSN:
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.SENTRY_ENVIRONMENT,
        release=settings.SENTRY_RELEASE or None,
        # Performance tracing (enables frontend→backend distributed traces).
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        # Never ship request bodies, cookies, or user PII to Sentry.
        send_default_pii=False,
    )
    _app_log.info("Sentry initialised (environment=%s)", settings.SENTRY_ENVIRONMENT)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Configure Cloudinary before any request can reach the image upload endpoint.
    settings.configure_cloudinary()
    await connect_to_redis()
    await connect_to_mongo()
    await init_db()

    # Log email config at startup so misconfiguration is immediately visible.
    _app_log.info("Email sender : %s", settings.EMAIL_FROM)
    _app_log.info(
        "Email override: %s",
        settings.EMAIL_OVERRIDE_TO or "(none — emails sent to real recipients)",
    )
    _app_log.info("Resend API key set: %s", bool(settings.RESEND_API_KEY))

    yield
    # Flush any buffered Langfuse events so nothing is lost on shutdown.
    from app.core.langfuse_client import get_langfuse  # noqa: PLC0415

    _lf = get_langfuse()
    if _lf is not None:
        _lf.flush()
    await close_redis_connection()
    await close_mongo_connection()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# SessionMiddleware is required by authlib's starlette integration.
# During the OAuth flow, authlib stores the `state` parameter in the session cookie
# to verify the callback came from the same browser that started the login (CSRF protection).
# SECRET_KEY is used to cryptographically sign the session cookie via itsdangerous.
app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)

app.include_router(auth.router, prefix="/api")
app.include_router(ideas.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(agent.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(collections.router, prefix="/api")


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}


# Temporary endpoint to confirm errors reach Sentry. Only mounted in DEBUG mode
# (never in production). Hitting it raises on purpose; remove once verified.
if settings.DEBUG:

    @app.get("/api/debug/sentry-test", include_in_schema=False)
    async def _sentry_test():
        raise RuntimeError("Sentry test error — intentional, safe to ignore.")
