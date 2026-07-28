import asyncio
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.base import AsyncSessionLocal
from app.api.activity_logs import get_activity_logs
from app.models.user import User

async def main():
    async with AsyncSessionLocal() as session:
        # pyrefly: ignore [missing-import]
        from sqlalchemy import select
        user = (await session.execute(select(User).limit(1))).scalar_one()
        from app.models.project import Project
        project = (await session.execute(select(Project).limit(1))).scalar_one()
        try:
            res = await get_activity_logs(project_id=project.id, db=session, current_user=user)
            print("Success:", res)
        except Exception as e:
            import traceback
            traceback.print_exc()

asyncio.run(main())
