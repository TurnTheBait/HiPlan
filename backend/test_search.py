import asyncio
import logging
from app.api.search import global_search
from app.models.base import AsyncSessionLocal
from app.models.user import User

logging.basicConfig(level=logging.DEBUG)

async def main():
    async with AsyncSessionLocal() as db:
        user = await db.get(User, "12b10195-6fbe-4b1d-a7c4-f610394bc621")
        if not user:
            print("User not found!")
            return
        results = await global_search("silos", db, user)
        print(f"Results: {len(results)}")
        for r in results:
            print(r)

if __name__ == "__main__":
    asyncio.run(main())
