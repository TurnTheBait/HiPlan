import asyncio
from app.models.base import AsyncSessionLocal
from app.services.replanning_service import get_replanning_suggestions
import app.services.replanning_service

async def main():
    async with AsyncSessionLocal() as db:
        res = await app.services.replanning_service.get_replanning_suggestions(db)
        print("OK", [r for r in res])

asyncio.run(main())
