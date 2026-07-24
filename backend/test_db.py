import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select
from app.core.config import settings
from app.models.ticket import Ticket
from app.models.project import Project
from app.models.user import User

async def run():
    engine = create_async_engine(settings.DATABASE_URL)
    async_session = sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
    
    async with async_session() as session:
        try:
            # First join with project
            stmt = select(Ticket, Project.name, Project.code, User.username, User.full_name)\
                .outerjoin(Project, Ticket.project_id == Project.id)\
                .join(User, Ticket.author_id == User.id)\
                .order_by(Ticket.created_at.desc())
            res = await session.execute(stmt)
            for row in res:
                print(row)
            print("Query OK")
        except Exception as e:
            print("DB Query Error:", e)

asyncio.run(run())
