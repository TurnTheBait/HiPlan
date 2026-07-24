import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings

async def run():
    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.begin() as conn:
        try:
            await conn.exec_driver_sql("ALTER TABLE tickets ADD COLUMN custom_project_code VARCHAR(255);")
            print("Added custom_project_code to tickets")
        except Exception as e:
            print("Error:", e)
    await engine.dispose()

asyncio.run(run())
