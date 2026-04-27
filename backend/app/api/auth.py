from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token, create_refresh_token, hash_password, verify_password
from app.db.postgres import get_db
from app.models.refresh_token import RefreshToken
from app.models.user import AuthProvider, User
from app.schemas.user import AccessToken, RefreshRequest, Token, UserCreate, UserLogin, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    # Pydantic has already validated email format and password strength by this point

    # Check if a user with this email already exists
    result = await db.execute(select(User).where(User.email == payload.email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    # Hash the password — the plain text password is never stored
    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        auth_provider=AuthProvider.local,  # default for email/password signup
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )

    # Persist to PostgreSQL
    db.add(user)
    await db.commit()
    await db.refresh(user)  # reload from DB to get the generated id

    # UserRead only returns id and email — hashed_password is never exposed
    return user


@router.post("/login", response_model=Token)
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db)):
    # Look up the user by email
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()

    # Use a single generic error for any authentication failure.
    # Never reveal whether the email or the password was wrong — that leaks account existence.
    invalid_credentials = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Reject if user not found or they signed up via OAuth (no stored password hash)
    if not user or not user.hashed_password:
        raise invalid_credentials

    # Reject if bcrypt verification fails
    if not verify_password(payload.password, user.hashed_password):
        raise invalid_credentials

    # Reject disabled accounts separately — different HTTP status, not 401
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
        )

    # --- tokens ---

    # Short-lived JWT — carries user identity, verified without a DB round-trip
    access_token = create_access_token(subject=user.id)

    # Long-lived opaque random string — stored in DB so it can be revoked server-side
    raw_refresh = create_refresh_token()
    refresh_expires = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )

    # Persist the refresh token record
    db.add(
        RefreshToken(
            user_id=user.id,
            token=raw_refresh,
            expires_at=refresh_expires,
        )
    )
    await db.commit()

    return Token(access_token=access_token, refresh_token=raw_refresh)


@router.post("/refresh", response_model=AccessToken)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    # Look up the refresh token in the database by its raw value
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token == payload.refresh_token)
    )
    record = result.scalar_one_or_none()

    # Use a single generic 401 for all failure cases — don't reveal whether
    # the token was never issued vs already expired vs belongs to someone else
    token_invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Reject if the token was never stored (not issued by us)
    if not record:
        raise token_invalid

    # Reject if the token has passed its expiry date
    if datetime.now(timezone.utc) > record.expires_at:
        # Clean up the expired row — no need to keep dead tokens in the DB
        await db.delete(record)
        await db.commit()
        raise token_invalid

    # Token is valid — issue a fresh short-lived JWT for the associated user.
    # The refresh token itself is NOT rotated here; it stays alive until logout
    # or until it naturally expires after 180 days.
    new_access_token = create_access_token(subject=record.user_id)

    return AccessToken(access_token=new_access_token)
