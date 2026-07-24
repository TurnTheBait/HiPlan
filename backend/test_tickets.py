import asyncio
from app.models.base import AsyncSessionLocal
from app.models.ticket import Ticket
from sqlalchemy import select

async def run():
    async with AsyncSessionLocal() as session:
        try:
            tickets = await session.execute(select(Ticket))
            print("First ticket:", tickets.scalars().first())
        except Exception as e:
            print("ERROR:", e)

asyncio.run(run())
