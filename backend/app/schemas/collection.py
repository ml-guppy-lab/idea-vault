from datetime import datetime
from pydantic import BaseModel, Field, field_validator


class CollectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    emoji: str = Field(default="📁", min_length=1, max_length=8)
    color: str = Field(default="#6366f1", min_length=7, max_length=7)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Collection name is required")
        if len(cleaned) > 50:
            raise ValueError("Collection name must be 50 characters or fewer")
        return cleaned

    @field_validator("color")
    @classmethod
    def validate_hex_color(cls, value: str) -> str:
        if len(value) != 7 or not value.startswith("#"):
            raise ValueError("Color must be a valid hex value like #6366f1")
        hex_part = value[1:]
        if any(c not in "0123456789abcdefABCDEF" for c in hex_part):
            raise ValueError("Color must be a valid hex value like #6366f1")
        return value.lower()


class CollectionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    emoji: str | None = Field(default=None, min_length=1, max_length=8)
    color: str | None = Field(default=None, min_length=7, max_length=7)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Collection name must not be empty")
        if len(cleaned) > 50:
            raise ValueError("Collection name must be 50 characters or fewer")
        return cleaned

    @field_validator("color")
    @classmethod
    def validate_hex_color(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if len(value) != 7 or not value.startswith("#"):
            raise ValueError("Color must be a valid hex value like #6366f1")
        hex_part = value[1:]
        if any(c not in "0123456789abcdefABCDEF" for c in hex_part):
            raise ValueError("Color must be a valid hex value like #6366f1")
        return value.lower()


class CollectionResponse(BaseModel):
    id: str = Field(alias="_id")
    userId: str
    name: str
    emoji: str
    color: str
    ideaCount: int
    createdAt: datetime
    updatedAt: datetime

    model_config = {"populate_by_name": True}
