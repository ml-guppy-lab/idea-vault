from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.api import auth, ideas, profile
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


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}
