import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy import select
from app.models.user import User, UserRole
from app.core.config import settings

async def main():
    engine = create_async_engine(settings.DATABASE_URL)
    session = async_sessionmaker(engine)()
    res = await session.execute(select(User).where(User.username=="admin"))
    u = res.scalar_one()
    print("Role:", u.role)
    print("Role == UserRole.ADMIN:", u.role == UserRole.ADMIN)

asyncio.run(main())
