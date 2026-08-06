import asyncio
from app.models.base import AsyncSessionLocal
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from app.models.task import Task, TaskType
from datetime import date

async def main():
    async with AsyncSessionLocal() as db:
        tasks_res = await db.execute(
            select(Task).options(selectinload(Task.project))
            .where(Task.completed == 0)
            .where(Task.type != TaskType.PROJECT)
            .where(Task.type != TaskType.MILESTONE)
        )
        tasks = tasks_res.scalars().all()
        for t in tasks:
            if t.workers and 'minnie' in t.workers:
                print(t.text, t.start_date, t.end_date, t.actual_hours)

asyncio.run(main())
