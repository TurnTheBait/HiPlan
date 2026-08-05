import asyncio
from app.core.database import SessionLocal
from app.models.project import Project
from app.models.link import Link
from sqlalchemy import select

async def main():
    async with SessionLocal() as db:
        res = await db.execute(select(Link))
        links = res.scalars().all()
        print(f"Total links in DB: {len(links)}")
        for l in links:
            print(f"Link: {l.id} | {l.source} -> {l.target}")

asyncio.run(main())
