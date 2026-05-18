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

from app.api import auth, ideas, profile, chat
from app.core.config import settings
from app.db.postgres import init_db
from app.db.mongodb import close_mongo_connection, connect_to_mongo
from app.db.redis import close_redis_connection, connect_to_redis

# Import SQLAlchemy models so they are registered with Base before create_all
# Only PostgreSQL models — ideas are stored in MongoDB, not here
from app.models import user, refresh_token  # noqa: F401


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
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# SessionMiddleware is required by authlib's starlette integration.
# During the OAuth flow, authlib stores the `state` parameter in the session cookie
# to verify the callback came from the same browser that started the login (CSRF protection).
# SECRET_KEY is used to cryptographically sign the session cookie via itsdangerous.
app.add_middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)

app.include_router(auth.router, prefix="/api")
app.include_router(ideas.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
app.include_router(chat.router, prefix="/api")


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}
