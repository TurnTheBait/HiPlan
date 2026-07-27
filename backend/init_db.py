import asyncio
from app.models.base import engine, Base
import app.models

async def init_models():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

asyncio.run(init_models())
