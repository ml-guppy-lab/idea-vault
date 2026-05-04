from datetime import datetime, timedelta, timezone

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request
from starlette.responses import RedirectResponse

import redis.asyncio as aioredis

from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.db.postgres import get_db
from app.db.redis import get_redis
from app.models.refresh_token import RefreshToken
from app.models.user import AuthProvider, User
from app.schemas.user import AccessToken, LogoutRequest, RefreshRequest, Token, UserCreate, UserLogin, UserRead

router = APIRouter(prefix="/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# OAuth client — configured once at module load time.
#
# server_metadata_url points to Google's OpenID Connect discovery document.
# Authlib fetches it on first use to learn Google's authorization endpoint,
# token endpoint, JWKS URL, etc. — we never have to hardcode those URLs.
# ---------------------------------------------------------------------------
_oauth = OAuth()
_oauth.register(
    name="google",
    client_id=settings.GOOGLE_CLIENT_ID,
    client_secret=settings.GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={
        # openid  — enables id_token (JWT with user claims)
        # email   — includes the user's email address
        # profile — includes name, picture, etc.
        "scope": "openid email profile",
    },
)

# ---------------------------------------------------------------------------
# Rate limiting dependency
#
# Uses Redis INCR + EXPIRE to track how many times a given IP has hit an
# endpoint within the current window (15 minutes by default).
#
# Key format: ratelimit:{endpoint}:{client_ip}
# Example:    ratelimit:register:127.0.0.1
#
# On the FIRST request in a window, INCR creates the key with value 1 and
# EXPIRE sets the TTL. On subsequent requests, INCR increments the counter
# but EXPIRE is NOT called again — so the TTL only starts once, not per
# request. The window resets naturally when the key expires.
# ---------------------------------------------------------------------------


async def check_rate_limit(
    request: Request,
    redis: aioredis.Redis = Depends(get_redis),
) -> None:
    """Dependency — enforces per-IP rate limiting using Redis.

    Injects into a route via `Depends(check_rate_limit)`. The endpoint name
    is extracted from the request path so the same function works for both
    /register and /login with separate counters per endpoint.
    """
    # Use the real client IP. X-Forwarded-For is checked first in case the
    # app sits behind a proxy (e.g. nginx). Falls back to direct connection IP.
    client_ip = request.headers.get("X-Forwarded-For", request.client.host)

    # Strip the /api prefix and use the last path segment as the endpoint label
    # e.g. /api/auth/register → "register", /api/auth/login → "login"
    endpoint = request.url.path.rstrip("/").rsplit("/", 1)[-1]

    redis_key = f"ratelimit:{endpoint}:{client_ip}"

    # Atomically increment the counter. Returns the new value after increment.
    current_count = await redis.incr(redis_key)

    if current_count == 1:
        # First request in this window — set the TTL so the key expires
        # automatically after the window closes. We only set it once so the
        # window doesn't slide on every request.
        await redis.expire(redis_key, settings.RATE_LIMIT_WINDOW_SECONDS)

    if current_count > settings.RATE_LIMIT_MAX_ATTEMPTS:
        # Calculate how many seconds remain on this key so we can tell the
        # caller exactly when they can try again.
        ttl = await redis.ttl(redis_key)
        minutes = ttl // 60
        seconds = ttl % 60

        # Retry-After header is a standard HTTP mechanism to tell clients
        # how long to wait before retrying (value is in seconds).
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"Too many attempts. Try again in "
                f"{minutes}m {seconds}s."
            ),
            headers={"Retry-After": str(ttl)},
        )


# get_current_user is defined in app.core.security and imported above.
# Use it in any route as:  current_user: User = Depends(get_current_user)


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def register(
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(check_rate_limit),  # enforces 5 attempts per IP per 15 min
):
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
async def login(
    payload: UserLogin,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(check_rate_limit),  # enforces 5 attempts per IP per 15 min
):
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


@router.get("/me", response_model=UserRead)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/logout", status_code=status.HTTP_200_OK)
async def logout(
    payload: LogoutRequest,
    # get_current_user validates the JWT, fetches the User row, and returns it.
    # If the token is missing, expired, or invalid — 401 is raised automatically.
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    # Find the specific refresh token AND confirm it belongs to the calling user.
    # current_user.id is the verified identity from the JWT — prevents one user
    # from revoking another user's session.
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token == payload.refresh_token,
            RefreshToken.user_id == current_user.id,
        )
    )
    record = result.scalar_one_or_none()

    if record:
        # Delete only this specific token — other sessions on other devices are unaffected
        await db.delete(record)
        await db.commit()

    # Always return 200, even if the token wasn't found.
    # Idempotent logout: calling this twice should not be an error from the client's perspective.
    return {"message": "Logged out successfully"}


# ---------------------------------------------------------------------------
# Google OAuth — Authorization Code Flow
#
# Step 1: Browser visits GET /auth/google
#         → Backend generates a random `state` value, stores it in the signed
#           session cookie (via SessionMiddleware), and redirects the browser
#           to Google's authorization URL.
#
# Step 2: User logs in with Google and consents.
#
# Step 3: Google redirects the browser to GET /auth/google/callback?code=...&state=...
#         → Backend validates the state from the session (CSRF protection),
#           exchanges the code for tokens, fetches user info, creates or finds
#           the user in PostgreSQL, issues our own JWT + refresh token, and
#           redirects the browser to the frontend with those tokens in the URL.
# ---------------------------------------------------------------------------


@router.get("/google", include_in_schema=False)
async def google_login(request: Request):
    # Build the redirect URL that Google will send the browser back to after login.
    # authlib stores a random `state` value in the session cookie here so it can
    # verify the callback isn't forged (CSRF).
    return await _oauth.google.authorize_redirect(
        request, settings.GOOGLE_REDIRECT_URI
    )


@router.get("/google/callback", include_in_schema=False)
async def google_callback(request: Request, db: AsyncSession = Depends(get_db)):
    # Exchange the authorization code Google sent us for an access token + id_token.
    # Authlib also validates the `state` from the session cookie here.
    try:
        token = await _oauth.google.authorize_access_token(request)
    except Exception:
        # State mismatch, code already used, or any other OAuth error
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OAuth authentication failed. Please try again.",
        )

    # With the `openid` scope, authlib automatically parses the id_token and
    # populates `userinfo` with verified claims (email, name, picture, etc.).
    user_info = token.get("userinfo")
    if not user_info or not user_info.get("email"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not retrieve email from Google. Make sure email scope is granted.",
        )

    email: str = user_info["email"]

    # --- Find or create the user in PostgreSQL ---

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()

    if not user:
        # First time this Google account has logged in — create a new user row.
        # hashed_password is None because OAuth users never set a password with us.
        user = User(
            email=email,
            hashed_password=None,
            auth_provider=AuthProvider.google,
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)  # reload to get the generated id

    # Reject disabled accounts even for OAuth logins
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is disabled",
        )

    # --- Issue our own tokens (same as /login) ---

    access_token = create_access_token(subject=user.id)

    raw_refresh = create_refresh_token()
    refresh_expires = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )

    db.add(
        RefreshToken(
            user_id=user.id,
            token=raw_refresh,
            expires_at=refresh_expires,
        )
    )
    await db.commit()

    # Redirect the browser to the frontend callback page with both tokens in the
    # query string. The frontend reads them from the URL and stores them in memory
    # or localStorage, then strips them from the URL bar.
    redirect_url = (
        f"{settings.FRONTEND_URL}/auth/callback"
        f"?access_token={access_token}"
        f"&refresh_token={raw_refresh}"
    )
    return RedirectResponse(url=redirect_url)
