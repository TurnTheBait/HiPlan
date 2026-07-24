import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings

async def run():
    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.begin() as conn:
        print("Migrating tickets...")
        await conn.exec_driver_sql("UPDATE tickets SET status = 'Da gestire' WHERE status = 'open'")
        await conn.exec_driver_sql("UPDATE tickets SET status = 'Completato' WHERE status = 'closed'")
        print("Migration complete!")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(run())
