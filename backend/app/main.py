from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth, ideas
from app.core.config import settings
from app.db.postgres import init_db
from app.db.mongodb import close_mongo_connection, connect_to_mongo

# Import all SQLAlchemy models so they are registered with Base before create_all
from app.models import user, refresh_token  # noqa: F401


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_to_mongo()
    await init_db()
    yield
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
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(ideas.router, prefix="/api")


@app.get("/health", tags=["health"])
async def health_check():
    return {"status": "ok", "version": settings.APP_VERSION}
