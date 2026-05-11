from datetime import datetime, timedelta, timezone
import json
import uuid

import pkce
from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Depends, HTTPException, Response, status
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
from app.schemas.user import AccessToken, UserCreate, UserLogin, UserRead

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

# True in production (HTTPS), False in local development (HTTP).
# Controls the Secure flag on Set-Cookie headers.
_is_secure = settings.FRONTEND_URL.startswith("https://")

# Refresh-token cookie lifetime in seconds — mirrors the DB token expiry.
_REFRESH_COOKIE_MAX_AGE = settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60


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


@router.post("/login", response_model=AccessToken)
async def login(
    payload: UserLogin,
    response: Response,  # injected by FastAPI so we can set Set-Cookie
    db: AsyncSession = Depends(get_db),
    _: None = Depends(check_rate_limit),
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
    
    # Set the refresh token as an httpOnly cookie — never in the JSON body.
    # JavaScript (and therefore XSS) cannot read httpOnly cookies.
    response.set_cookie(
        key="refresh_token",
        value=raw_refresh,
        httponly=True,
        secure=_is_secure,
        samesite="lax",
        path="/",
        max_age=_REFRESH_COOKIE_MAX_AGE,
    )

    # Return only the short-lived access token.
    # The long-lived refresh token travels exclusively via Set-Cookie.
    return AccessToken(access_token=access_token)


@router.post("/refresh", response_model=AccessToken)
async def refresh(request: Request, db: AsyncSession = Depends(get_db)):
    # Read the refresh token from the httpOnly cookie.
    # The Next.js BFF forwards it as a Cookie header in a server-to-server call
    # so the raw value is never visible to browser JavaScript.
    refresh_token_val = request.cookies.get("refresh_token")
    if not refresh_token_val:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token == refresh_token_val)
    )
    record = result.scalar_one_or_none()

    token_invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not record:
        raise token_invalid

    if datetime.now(timezone.utc) > record.expires_at:
        await db.delete(record)
        await db.commit()
        raise token_invalid

    new_access_token = create_access_token(subject=record.user_id)
    return AccessToken(access_token=new_access_token)


@router.get("/me", response_model=UserRead)
async def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/logout", status_code=status.HTTP_200_OK)
async def logout(
    request: Request,
    response: Response,
    # JWT validation — ensures only authenticated users can revoke tokens.
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    # Read the refresh token from the httpOnly cookie (forwarded by Next.js BFF).
    refresh_token_val = request.cookies.get("refresh_token")

    if refresh_token_val:
        # Verify the token belongs to the authenticated user before revoking.
        # Prevents one user from invalidating another user's session.
        result = await db.execute(
            select(RefreshToken).where(
                RefreshToken.token == refresh_token_val,
                RefreshToken.user_id == current_user.id,
            )
        )
        record = result.scalar_one_or_none()
        if record:
            await db.delete(record)
            await db.commit()

    # Instruct the browser to expire the refresh_token cookie.
    # The Next.js BFF also clears its own copy of the cookie.
    response.delete_cookie(
        key="refresh_token",
        path="/",
        secure=_is_secure,
        httponly=True,
        samesite="lax",
    )
    # Idempotent — always 200, even if the token was already revoked.
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
    # Generate a PKCE code_verifier (128 chars, URL-safe random) and derive
    # the S256 code_challenge.  The verifier is stored server-side in the
    # signed session cookie — never exposed to the browser.
    code_verifier = pkce.generate_code_verifier(length=128)
    code_challenge = pkce.get_code_challenge(code_verifier)
    request.session["pkce_verifier"] = code_verifier

    # authlib also stores a random `state` in the session for CSRF protection.
    return await _oauth.google.authorize_redirect(
        request,
        settings.GOOGLE_REDIRECT_URI,
        code_challenge=code_challenge,
        code_challenge_method="S256",
    )


@router.get("/google/callback", include_in_schema=False)
async def google_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
):
    # Consume the PKCE verifier from the session (pop = one-time use).
    # Absence means the request didn't originate from our /auth/google flow.
    code_verifier = request.session.pop("pkce_verifier", None)
    if not code_verifier:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OAuth authentication failed. Please try again.",
        )

    # Exchange the authorization code for tokens.
    # Authlib validates `state` (CSRF) and sends `code_verifier` to Google,
    # which re-derives the challenge and rejects any mismatch.
    try:
        token = await _oauth.google.authorize_access_token(
            request, code_verifier=code_verifier
        )
    except Exception:
        # State mismatch, PKCE failure, code already used, or any other OAuth error
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

    # Store both tokens in Redis under a one-time UUID code (60-second TTL).
    # The redirect URL carries only the opaque code — no tokens in the URL,
    # so they never appear in browser history, server logs, or referrer headers.
    # The Next.js BFF exchanges the code for tokens in a server-to-server call.
    oauth_code = str(uuid.uuid4())
    await redis.setex(
        f"oauth_code:{oauth_code}",
        60,  # 60-second TTL — just long enough to survive the redirect handshake
        json.dumps({"access_token": access_token, "refresh_token": raw_refresh}),
    )
    return RedirectResponse(
        url=f"{settings.FRONTEND_URL}/auth/callback?code={oauth_code}"
    )


@router.get("/google/token", include_in_schema=False)
async def google_token(
    code: str,
    response: Response,
    redis: aioredis.Redis = Depends(get_redis),
):
    """Exchange a short-lived one-time OAuth code for auth tokens.

    Called server-to-server by the Next.js BFF — never directly by the browser.
    Consumes the code on first use (prevents replay). Sets refresh_token as an
    httpOnly cookie and returns access_token in the response body.
    """
    redis_key = f"oauth_code:{code}"
    data_raw = await redis.get(redis_key)
    if not data_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired OAuth code.",
        )

    # Delete before returning — one-time use prevents replay attacks.
    await redis.delete(redis_key)
    data = json.loads(data_raw)

    response.set_cookie(
        key="refresh_token",
        value=data["refresh_token"],
        httponly=True,
        secure=_is_secure,
        samesite="lax",
        path="/",
        max_age=_REFRESH_COOKIE_MAX_AGE,
    )
    return AccessToken(access_token=data["access_token"])
