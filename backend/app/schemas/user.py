import re
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator

from app.models.user import AuthProvider


class UserCreate(BaseModel):
    # EmailStr validates proper email format automatically
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        # Must be at least 8 characters
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        # Must contain at least one uppercase letter
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        # Must contain at least one digit
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one number")
        return v


class UserLogin(BaseModel):
    # Plain JSON body — no password strength check on login, just verify against hash
    email: EmailStr
    password: str


class UserRead(BaseModel):
    # Returned by /auth/me — includes profile fields for navbar + profile page bootstrap
    id: str
    email: EmailStr
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    auth_provider: str = "local"

    model_config = {"from_attributes": True}


class ProfileRead(BaseModel):
    id: str
    email: EmailStr
    display_name: Optional[str] = None
    bio: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[date] = None
    avatar_url: Optional[str] = None
    auth_provider: str = "local"
    created_at: datetime

    model_config = {"from_attributes": True}


class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    bio: Optional[str] = None
    gender: Optional[str] = None
    date_of_birth: Optional[date] = None

    @field_validator("display_name")
    @classmethod
    def validate_display_name(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v.strip()) > 100:
            raise ValueError("Display name must be 100 characters or fewer")
        return v.strip() if v else v

    @field_validator("bio")
    @classmethod
    def validate_bio(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 500:
            raise ValueError("Bio must be 500 characters or fewer")
        return v

    @field_validator("gender")
    @classmethod
    def validate_gender(cls, v: Optional[str]) -> Optional[str]:
        allowed = {"male", "female", "non_binary", "prefer_not_to_say"}
        if v is not None and v not in allowed:
            raise ValueError("Invalid gender value")
        return v


class AvatarUpload(BaseModel):
    avatar_url: str  # base64 data URL: "data:image/jpeg;base64,..."


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one number")
        return v


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    # The opaque refresh token string returned by /login
    refresh_token: str


class AccessToken(BaseModel):
    # Returned by /refresh — only a new access token, refresh token is unchanged
    access_token: str
    token_type: str = "bearer"


class LogoutRequest(BaseModel):
    # The specific refresh token to revoke — allows targeted logout per device
    # without affecting sessions on other devices
    refresh_token: str
