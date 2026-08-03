import asyncio
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import sessionmaker
# pyrefly: ignore [missing-import]
from sqlalchemy import text
# pyrefly: ignore [missing-import]
from app.services import project_service
# pyrefly: ignore [missing-import]
from app.schemas.project import ProjectUpdate
# pyrefly: ignore [missing-import]
from app.models.user import User, UserRole

async def main():
    engine = create_async_engine("sqlite+aiosqlite:///ganttflow.db")
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as db:
        res = await db.execute(text("SELECT * FROM users WHERE username='admin'"))
        user_row = res.fetchone()
        admin_user = User(id=user_row.id, role=UserRole.ADMIN, username="admin")
        
        try:
            update = ProjectUpdate(notes="test notes 123")
            proj = await project_service.update_project(db, "a7279a72-df24-4f51-8660-cb406762c300", update, admin_user)
            print("OK notes:", proj.notes)
        except Exception as e:
            print("ERROR:", e)

if __name__ == "__main__":
    asyncio.run(main())
