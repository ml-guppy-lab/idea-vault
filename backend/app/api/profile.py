"""
Profile API — view and update the authenticated user's profile.

All routes require a valid JWT via `get_current_user`.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_current_user, hash_password, verify_password
from app.db.postgres import get_db
from app.models.refresh_token import RefreshToken
from app.models.user import AuthProvider, User
from app.schemas.user import (
    AvatarUpload,
    ChangePasswordRequest,
    ProfileRead,
    ProfileUpdate,
)

router = APIRouter(prefix="/profile", tags=["profile"])

# Base64 data URL: roughly 1.37× the original file size.
# Cap at 4MB of base64 string ≈ ~3MB image file — generous enough for a profile pic.
_MAX_AVATAR_LEN = 4 * 1024 * 1024


# ── GET /profile/me ───────────────────────────────────────────────────────────

@router.get("/me", response_model=ProfileRead)
async def get_profile(current_user: User = Depends(get_current_user)):
    return current_user


# ── PATCH /profile/me ─────────────────────────────────────────────────────────

@router.patch("/me", response_model=ProfileRead)
async def update_profile(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    updates = payload.model_dump(exclude_none=True)
    for field, value in updates.items():
        setattr(current_user, field, value)

    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    return current_user


# ── POST /profile/avatar ──────────────────────────────────────────────────────

@router.post("/avatar", response_model=ProfileRead)
async def upload_avatar(
    payload: AvatarUpload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not payload.avatar_url.startswith("data:image/"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="avatar_url must be a valid image data URL (data:image/...;base64,...)",
        )

    if len(payload.avatar_url) > _MAX_AVATAR_LEN:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Image is too large. Please upload an image under 3 MB.",
        )

    current_user.avatar_url = payload.avatar_url
    db.add(current_user)
    await db.commit()
    await db.refresh(current_user)
    return current_user


# ── POST /profile/change-password ─────────────────────────────────────────────

@router.post("/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    providers = list(current_user.auth_providers or [])
    if not providers:
        providers = [current_user.auth_provider.value]

    # Allow password changes for any account that has local auth linked,
    # even if the latest login happened through Google.
    if AuthProvider.local.value not in providers or not current_user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password change is not available for accounts signed in with Google.",
        )

    # Verify the current password — use a generic error to avoid leaking info
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )

    # Prevent setting the same password again
    if verify_password(payload.new_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from your current password.",
        )

    # Hash and persist the new password
    current_user.hashed_password = hash_password(payload.new_password)
    db.add(current_user)

    # Revoke ALL refresh tokens for this user → forces re-login on every device.
    # This is a standard security practice after a password change.
    await db.execute(
        delete(RefreshToken).where(RefreshToken.user_id == current_user.id)
    )

    await db.commit()

    return {"detail": "Password updated. Please log in again with your new password."}
