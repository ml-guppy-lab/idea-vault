from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db.database import get_db
from app.models.idea import Idea
from app.models.user import User
from app.schemas.idea import IdeaCreate, IdeaRead, IdeaUpdate

router = APIRouter(prefix="/ideas", tags=["ideas"])
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme), db: AsyncSession = Depends(get_db)
) -> User:
    user_id = decode_access_token(token)
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token"
        )
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


@router.get("/", response_model=list[IdeaRead])
async def list_ideas(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(Idea).where(Idea.owner_id == current_user.id))
    return result.scalars().all()


@router.post("/", response_model=IdeaRead, status_code=status.HTTP_201_CREATED)
async def create_idea(
    payload: IdeaCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    idea = Idea(**payload.model_dump(), owner_id=current_user.id)
    db.add(idea)
    await db.commit()
    await db.refresh(idea)
    return idea


@router.get("/{idea_id}", response_model=IdeaRead)
async def get_idea(
    idea_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Idea).where(Idea.id == idea_id, Idea.owner_id == current_user.id)
    )
    idea = result.scalar_one_or_none()
    if not idea:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Idea not found")
    return idea


@router.patch("/{idea_id}", response_model=IdeaRead)
async def update_idea(
    idea_id: str,
    payload: IdeaUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Idea).where(Idea.id == idea_id, Idea.owner_id == current_user.id)
    )
    idea = result.scalar_one_or_none()
    if not idea:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Idea not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(idea, field, value)
    await db.commit()
    await db.refresh(idea)
    return idea


@router.delete("/{idea_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_idea(
    idea_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Idea).where(Idea.id == idea_id, Idea.owner_id == current_user.id)
    )
    idea = result.scalar_one_or_none()
    if not idea:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Idea not found")
    await db.delete(idea)
    await db.commit()
