from datetime import datetime

from pydantic import BaseModel


class IdeaCreate(BaseModel):
    title: str
    content: str | None = None
    tags: str | None = None
    is_pinned: bool = False


class IdeaUpdate(BaseModel):
    title: str | None = None
    content: str | None = None
    tags: str | None = None
    is_pinned: bool | None = None


class IdeaRead(BaseModel):
    id: str
    title: str
    content: str | None
    tags: str | None
    is_pinned: bool
    owner_id: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
