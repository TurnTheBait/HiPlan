import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
from app.core.config import settings
from app.models.ticket import Ticket

async def run():
    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    
    async with async_session() as session:
        try:
            res = await session.execute(select(Ticket))
            for ticket in res.scalars():
                print(f"Ticket ID: {ticket.id}")
                print(f"Assigned: {repr(ticket.assigned_to)}")
                print(f"Attachments: {repr(ticket.attachments)}")
                print(f"Status: {repr(ticket.status)}")
                print(f"Priority: {repr(ticket.priority)}")
        except Exception as e:
            print("Error:", e)

asyncio.run(run())
