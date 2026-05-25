from pydantic import BaseModel, Field, field_validator
from typing import Optional
from enum import Enum
from datetime import datetime, timezone

from app.schemas.task import TaskInDB, TaskResponse


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

# all-MiniLM-L6-v2 has a 256-token limit (~1 300 chars / ~190 words).
# The summary field is the ONLY text embedded for vector search — keeping it
# short and dense ensures high-quality embeddings with no silent truncation.
SUMMARY_MAX_WORDS = 190


class IdeaCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    # summary: required, ≤190 words — embedded for RAG/semantic search
    summary: str = Field(..., min_length=1, max_length=1300,
                         description="Concise idea summary (≤190 words). Used for semantic search.")
    description: Optional[str] = Field(default=None, max_length=50000)
    tags: Optional[list[str]] = Field(default=[])
    status: Optional[IdeaStatus] = Field(default=IdeaStatus.raw)
    priority: Optional[IdeaPriority] = Field(default=IdeaPriority.low)
    imageUrl: Optional[str] = Field(default=None)  # Cloudinary URL set after upload

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
    summary: Optional[str] = Field(default=None, min_length=1, max_length=1300)
    description: Optional[str] = Field(default=None, max_length=50000)
    tags: Optional[list[str]] = Field(default=None)
    status: Optional[IdeaStatus] = Field(default=None)
    priority: Optional[IdeaPriority] = Field(default=None)
    imageUrl: Optional[str] = Field(default=None)  # Cloudinary URL; None = unchanged


# --- Response Schema (what your API sends BACK to the frontend) ---
# This is the full idea as stored in MongoDB

class IdeaResponse(BaseModel):
    id: str = Field(alias="_id")
    userId: str
    title: str
    summary: str
    description: Optional[str] = None
    tags: list[str] = []
    status: IdeaStatus
    priority: IdeaPriority
    imageUrl: Optional[str] = None  # Cloudinary HTTPS URL; absent when no image uploaded
    # Tasks embedded in this idea document — empty list for ideas with no tasks yet
    tasks: list[TaskResponse] = []
    createdAt: datetime
    updatedAt: datetime

    model_config = {"populate_by_name": True}


# --- Internal Schema (the full document as saved in MongoDB) ---
# This is what you build before inserting into the database

class IdeaInDB(BaseModel):
    userId: str
    title: str
    summary: str
    description: Optional[str] = None
    tags: list[str] = []
    status: IdeaStatus = IdeaStatus.raw
    priority: IdeaPriority = IdeaPriority.low
    imageUrl: Optional[str] = None
    # Tasks are embedded — new ideas start with an empty list
    tasks: list[TaskInDB] = []
    createdAt: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    updatedAt: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc)
    )


# --- Paginated list response (what GET /ideas returns) ---
# Wraps a page of IdeaResponse items with pagination metadata.

class IdeaListResponse(BaseModel):
    items: list[IdeaResponse]   # the ideas on this page
    total: int                  # total matching documents in MongoDB (across all pages)
    page: int                   # current page number (1-based)
    limit: int                  # max items per page