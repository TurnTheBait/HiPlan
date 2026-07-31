import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text

async def main():
    engine = create_async_engine("sqlite+aiosqlite:///backend/ganttflow.db")
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as db:
        res = await db.execute(text("SELECT id, username FROM users"))
        for row in res.fetchall():
            print(row.id, row.username)

if __name__ == "__main__":
    asyncio.run(main())
