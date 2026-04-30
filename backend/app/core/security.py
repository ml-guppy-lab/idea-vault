import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.postgres import get_db


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token() -> str:
    # Opaque cryptographically secure random string — NOT a JWT.
    # Stored in the DB so it can be validated and revoked server-side.
    return secrets.token_urlsafe(64)


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        return payload.get("sub")
    except JWTError:
        return None


# ---------------------------------------------------------------------------
# Reusable authentication dependency
#
# Usage in any route:
#
#   from app.core.security import get_current_user
#   from app.models.user import User
#
#   @router.get("/me")
#   async def me(current_user: User = Depends(get_current_user)):
#       return {"id": current_user.id, "email": current_user.email}
#
# FastAPI automatically runs this before the route handler. If the token is
# missing, invalid, or the user no longer exists, the route is never reached
# and 401/403 is returned to the caller.
# ---------------------------------------------------------------------------

# HTTPBearer reads the "Authorization: Bearer <token>" header.
# FastAPI returns 403 automatically if the header is absent entirely.
_bearer = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
):
    """Dependency — verifies the JWT and returns the authenticated User row.

    Import this into any route file and inject it via Depends():

        current_user: User = Depends(get_current_user)

    The User model is imported inside the function body to avoid a circular
    import (models → db → security would create a cycle if we imported at
    the module level here).
    """
    # Import here to avoid circular import:
    # security.py ← models/user.py ← db/postgres.py ← security.py (would loop)
    from app.models.user import User  # noqa: PLC0415

    # Decode the JWT and extract the `sub` claim (the user's UUID).
    # decode_access_token returns None for expired, tampered, or malformed tokens.
    user_id = decode_access_token(credentials.credentials)

    # Use a single consistent 401 for any token failure — never reveal why.
    # This prevents attackers from learning whether a token was expired vs forged.
    _unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired access token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not user_id:
        raise _unauthorized

    # Look up the user by the ID encoded in the token.
    # This also catches the case where a user was deleted after the token was issued.
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if not user:
        # Token was valid but the user no longer exists in the database
        raise _unauthorized

    # A disabled account should not be able to access protected resources,
    # even with a technically valid token. Use 403 (not 401) because the
    # identity is confirmed — they just don't have permission.
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
        )

    return user
