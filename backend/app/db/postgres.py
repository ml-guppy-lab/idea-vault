from urllib.parse import urlparse, urlencode, parse_qs, urlunparse

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


def _build_engine_url(raw_url: str) -> tuple[str, dict]:
    """
    Normalise a PostgreSQL connection URL for asyncpg.

    Neon (and other providers) give URLs with psycopg2-style query params
    (sslmode=require, channel_binding=require) that asyncpg rejects outright.
    This strips those params from the URL and returns the SSL flag separately
    so it can be passed via connect_args instead, which is the correct path
    for the asyncpg dialect.
    """
    parsed = urlparse(raw_url)

    # Ensure the scheme is asyncpg-compatible
    scheme = parsed.scheme
    if scheme == "postgresql" or scheme == "postgres":
        scheme = "postgresql+asyncpg"

    # Strip params that asyncpg doesn't accept in the URL
    _UNSUPPORTED = {"sslmode", "channel_binding", "ssl"}
    qs = parse_qs(parsed.query, keep_blank_values=True)
    ssl_requested = (
        qs.pop("sslmode", [""])[0] in ("require", "verify-ca", "verify-full")
        or qs.pop("ssl", [""])[0] in ("require", "true", "1")
    )
    qs.pop("channel_binding", None)  # always strip; asyncpg handles this internally

    clean_url = urlunparse((
        scheme,
        parsed.netloc,
        parsed.path,
        parsed.params,
        urlencode(qs, doseq=True),
        parsed.fragment,
    ))

    connect_args: dict = {}
    if ssl_requested:
        import ssl as _ssl
        ctx = _ssl.create_default_context()
        connect_args["ssl"] = ctx

    return clean_url, connect_args


_db_url, _connect_args = _build_engine_url(settings.DATABASE_URL)
engine = create_async_engine(_db_url, echo=False, connect_args=_connect_args)

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
            # Linked-auth columns (v4)
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_providers TEXT[] NOT NULL DEFAULT '{}'::TEXT[]",
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
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_google_id "
            "ON users (google_id) WHERE google_id IS NOT NULL"
        ))
        await conn.execute(text(
            "UPDATE users "
            "SET auth_providers = ARRAY[auth_provider::text] "
            "WHERE auth_providers IS NULL OR cardinality(auth_providers) = 0"
        ))
