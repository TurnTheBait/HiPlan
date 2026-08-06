import asyncio
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from app.core.database import DATABASE_URL
from app.services.replanning_service import get_replanning_suggestions

async def main():
    engine = create_async_engine(DATABASE_URL)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as db:
        try:
            suggestions = await get_replanning_suggestions(db)
            print("OK", len(suggestions))
        except Exception as e:
            import traceback
            traceback.print_exc()

asyncio.run(main())
