import asyncio
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.base import AsyncSessionLocal
from app.models.user import User
from app.api.task_collaboration import add_comment
from app.schemas.task_collaboration import TaskCommentCreate

async def main():
    async with AsyncSessionLocal() as session:
        # Get a user
        from sqlalchemy import select
        user = (await session.execute(select(User).limit(1))).scalar_one()
        from app.models.project import Project
        project = (await session.execute(select(Project).limit(1))).scalar_one()
        from app.models.task import Task
        task = (await session.execute(select(Task).limit(1))).scalar_one()
        
        try:
            res = await add_comment(
                project_id=project.id,
                task_id=task.id,
                data=TaskCommentCreate(content="@pluto porv"),
                db=session,
                current_user=user
            )
            print("Success:", res)
        except Exception as e:
            import traceback
            traceback.print_exc()

asyncio.run(main())
