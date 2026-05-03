from pydantic import BaseModel, Field, field_validator
from typing import Optional
from enum import Enum
from datetime import datetime, timezone


# --- Enums ---

class IdeaStatus(str, Enum):
    raw = "raw"
    exploring = "exploring"
    validated = "validated"
    building = "building"
    shipped = "shipped"
    abandoned = "abandoned"


class IdeaPriority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


# --- Request Schema (what the user sends when CREATING an idea) ---

class IdeaCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    tags: Optional[list[str]] = Field(default=[])
    status: Optional[IdeaStatus] = Field(default=IdeaStatus.raw)
    priority: Optional[IdeaPriority] = Field(default=IdeaPriority.low)

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, tags: list[str]) -> list[str]:
        """
        Each tag must be a non-empty string, max 50 chars, no duplicates.
        Tags are stripped of surrounding whitespace before validation.
        """
        if tags is None:
            return []
        cleaned = []
        seen = set()
        for tag in tags:
            tag = tag.strip()
            if not tag:
                raise ValueError("Tags must not be empty strings")
            if len(tag) > 50:
                raise ValueError(f"Tag '{tag}' exceeds 50 characters")
            lower = tag.lower()
            if lower in seen:
                raise ValueError(f"Duplicate tag: '{tag}'")
            seen.add(lower)
            cleaned.append(tag)
        return cleaned


# --- Request Schema (what the user sends when UPDATING an idea) ---
# All fields are Optional here — user can update just one field if they want

class IdeaUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    tags: Optional[list[str]] = Field(default=None)
    status: Optional[IdeaStatus] = Field(default=None)
    priority: Optional[IdeaPriority] = Field(default=None)


# --- Response Schema (what your API sends BACK to the frontend) ---
# This is the full idea as stored in MongoDB

class IdeaResponse(BaseModel):
    id: str = Field(alias="_id")
    userId: str
    title: str
    description: Optional[str] = None
    tags: list[str] = []
    status: IdeaStatus
    priority: IdeaPriority
    createdAt: datetime
    updatedAt: datetime

    model_config = {"populate_by_name": True}


# --- Internal Schema (the full document as saved in MongoDB) ---
# This is what you build before inserting into the database

class IdeaInDB(BaseModel):
    userId: str
    title: str
    description: Optional[str] = None
    tags: list[str] = []
    status: IdeaStatus = IdeaStatus.raw
    priority: IdeaPriority = IdeaPriority.low
    createdAt: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    updatedAt: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )