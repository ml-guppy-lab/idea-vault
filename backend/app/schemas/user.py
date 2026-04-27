import re

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


class UserRead(BaseModel):
    # Only expose id and email — never return hashed_password or auth internals
    id: str
    email: EmailStr

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
