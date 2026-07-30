import asyncio
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from app.services import project_service
from app.schemas.project import ProjectUpdate
from app.models.user import User, UserRole

async def main():
    engine = create_async_engine("sqlite+aiosqlite:///ganttflow.db")
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as db:
        res = await db.execute(text("SELECT * FROM users WHERE username='pluto'"))
        user_row = res.fetchone()
        pluto_user = User(id=user_row.id, role=UserRole.EDITOR, username="pluto")
        
        try:
            update = ProjectUpdate(notes="pluto's notes")
            proj = await project_service.update_project(db, "a7279a72-df24-4f51-8660-cb406762c300", update, pluto_user)
            print("OK notes:", proj.notes)
        except Exception as e:
            print("ERROR:", e)

if __name__ == "__main__":
    asyncio.run(main())
