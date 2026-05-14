"""
Run this script to verify Redis is reachable:
    python test_redis.py
Expected output: PONG
"""
import asyncio
import redis.asyncio as aioredis

REDIS_URL = "redis://localhost:6379"


async def main():
    client = aioredis.from_url(REDIS_URL, decode_responses=True)
    response = await client.ping()
    print(f"Redis response: {response}")  # should print: Redis response: True (PONG)
    await client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
