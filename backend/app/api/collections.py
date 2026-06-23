from datetime import datetime, timezone
import re

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Response, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import get_current_user
from app.db.mongodb import get_mongo_db
from app.models.user import User
from app.schemas.collection import CollectionCreate, CollectionResponse, CollectionUpdate

router = APIRouter(prefix="/collections", tags=["collections"])


def _parse_object_id(collection_id: str) -> ObjectId:
    try:
        return ObjectId(collection_id)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )


def _serialize_collection(doc: dict) -> dict:
    doc["_id"] = str(doc["_id"])
    return doc


async def _count_ideas_for_collection(db: AsyncIOMotorDatabase, user_id: str, collection_id: ObjectId) -> int:
    return await db.ideas.count_documents({
        "userId": user_id,
        "collectionId": str(collection_id),
    })


async def _ensure_unique_collection_name(
    db: AsyncIOMotorDatabase,
    user_id: str,
    name: str,
    exclude_id: ObjectId | None = None,
) -> None:
    escaped_name = re.escape(name.strip())
    query: dict = {
        "userId": user_id,
        "name": {"$regex": f"^{escaped_name}$", "$options": "i"},
    }
    if exclude_id is not None:
        query["_id"] = {"$ne": exclude_id}

    existing = await db.collections.find_one(query, {"_id": 1})
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A collection with this name already exists",
        )


@router.post(
    "",
    response_model=CollectionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a collection",
)
@router.post(
    "/create",
    response_model=CollectionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a collection",
)
async def create_collection(
    payload: CollectionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),
) -> CollectionResponse:
    user_id = str(current_user.id)
    await _ensure_unique_collection_name(db, user_id, payload.name)

    now = datetime.now(timezone.utc)
    document = {
        "userId": user_id,
        "name": payload.name.strip(),
        "emoji": payload.emoji,
        "color": payload.color,
        "createdAt": now,
        "updatedAt": now,
    }

    result = await db.collections.insert_one(document)
    saved = await db.collections.find_one({"_id": result.inserted_id, "userId": user_id})
    if saved is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Collection was inserted but could not be retrieved",
        )

    payload_out = _serialize_collection(saved)
    payload_out["ideaCount"] = 0
    return CollectionResponse(**payload_out)


@router.get(
    "",
    response_model=list[CollectionResponse],
    status_code=status.HTTP_200_OK,
    summary="List all collections for the logged-in user",
)
@router.get(
    "/list",
    response_model=list[CollectionResponse],
    status_code=status.HTTP_200_OK,
    summary="List all collections for the logged-in user",
)
async def list_collections(
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),
) -> list[CollectionResponse]:
    user_id = str(current_user.id)
    docs = await db.collections.find({"userId": user_id}).sort("createdAt", -1).to_list(length=500)

    response: list[CollectionResponse] = []
    for doc in docs:
        payload = _serialize_collection(doc)
        payload["ideaCount"] = await _count_ideas_for_collection(db, user_id, doc["_id"])
        response.append(CollectionResponse(**payload))

    return response


@router.get(
    "/get/{collection_id}",
    response_model=CollectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Get one collection by ID",
)
async def get_collection(
    collection_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),
) -> CollectionResponse:
    oid = _parse_object_id(collection_id)
    doc = await db.collections.find_one({"_id": oid, "userId": str(current_user.id)})

    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    payload = _serialize_collection(doc)
    payload["ideaCount"] = await _count_ideas_for_collection(db, str(current_user.id), oid)
    return CollectionResponse(**payload)


@router.put(
    "/{collection_id}",
    response_model=CollectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Partially update a collection",
)
@router.put(
    "/update/{collection_id}",
    response_model=CollectionResponse,
    status_code=status.HTTP_200_OK,
    summary="Partially update a collection",
)
async def update_collection(
    collection_id: str,
    payload: CollectionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),
) -> CollectionResponse:
    oid = _parse_object_id(collection_id)
    doc = await db.collections.find_one({"_id": oid, "userId": str(current_user.id)})

    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates:
        await _ensure_unique_collection_name(db, str(current_user.id), updates["name"], exclude_id=oid)
        updates["name"] = updates["name"].strip()

    if not updates:
        current = _serialize_collection(doc)
        current["ideaCount"] = await _count_ideas_for_collection(db, str(current_user.id), oid)
        return CollectionResponse(**current)

    updates["updatedAt"] = datetime.now(timezone.utc)
    await db.collections.update_one({"_id": oid, "userId": str(current_user.id)}, {"$set": updates})

    updated = await db.collections.find_one({"_id": oid, "userId": str(current_user.id)})
    payload_out = _serialize_collection(updated)
    payload_out["ideaCount"] = await _count_ideas_for_collection(db, str(current_user.id), oid)
    return CollectionResponse(**payload_out)


@router.delete(
    "/{collection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a collection and uncategorise linked ideas",
)
@router.delete(
    "/delete/{collection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a collection and uncategorise linked ideas",
)
async def delete_collection(
    collection_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_mongo_db),
) -> Response:
    oid = _parse_object_id(collection_id)
    doc = await db.collections.find_one({"_id": oid, "userId": str(current_user.id)})

    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Collection not found",
        )

    # Keep ideas intact; deleting a collection sends linked ideas back to uncategorised.
    await db.ideas.update_many(
        {"userId": str(current_user.id), "collectionId": str(oid)},
        {"$set": {"collectionId": None, "updatedAt": datetime.now(timezone.utc)}},
    )
    await db.collections.delete_one({"_id": oid, "userId": str(current_user.id)})

    return Response(status_code=status.HTTP_204_NO_CONTENT)
