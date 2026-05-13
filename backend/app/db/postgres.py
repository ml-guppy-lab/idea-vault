from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine = create_async_engine(settings.DATABASE_URL, echo=False)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent column additions for upgrades on existing DBs (no Alembic needed for v1)
        migrations = [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(100)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(500)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(30)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT",
            # Email verification columns (v2)
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_hash VARCHAR(64)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_expires TIMESTAMPTZ",
            # Password reset columns (v2)
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash VARCHAR(64)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMPTZ",
        ]
        for stmt in migrations:
            await conn.execute(text(stmt))
