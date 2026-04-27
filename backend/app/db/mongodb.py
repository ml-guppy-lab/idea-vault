from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import settings

client: AsyncIOMotorClient = None


async def connect_to_mongo():
    global client
    client = AsyncIOMotorClient(settings.MONGO_URI)
    db = client[settings.MONGO_DB_NAME]
    await db.ideas.create_index("userId")


async def close_mongo_connection():
    global client
    if client:
        client.close()


def get_mongo_db() -> AsyncIOMotorDatabase:
    return client[settings.MONGO_DB_NAME]
