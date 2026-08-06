import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.services.replanning_service import run_replanning
from app.core.config import settings

async def main():
    engine = create_async_engine(settings.DATABASE_URL)
    session = async_sessionmaker(engine)()
    try:
        await run_replanning(session)
        print("Success")
    except Exception as e:
        import traceback
        traceback.print_exc()

asyncio.run(main())
