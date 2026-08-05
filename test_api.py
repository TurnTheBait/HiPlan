import asyncio
import os
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import SessionLocal
from app.models.project import Project
from app.models.link import Link
from sqlalchemy import select

async def main():
    async with SessionLocal() as db:
        res = await db.execute(select(Link))
        links = res.scalars().all()
        print(f"Links in DB: {len(links)}")

asyncio.run(main())
