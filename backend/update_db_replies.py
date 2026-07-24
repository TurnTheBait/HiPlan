import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings

async def run():
    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.begin() as conn:
        try:
            await conn.exec_driver_sql("ALTER TABLE ticket_replies ADD COLUMN action_type VARCHAR(50);")
            print("Added action_type to ticket_replies")
        except Exception as e:
            print("Error:", e)
    await engine.dispose()

asyncio.run(run())
