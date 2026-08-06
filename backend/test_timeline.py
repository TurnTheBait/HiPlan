import asyncio
import json
from datetime import date, timedelta
from app.models.base import AsyncSessionLocal
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from app.models.task import Task, TaskType
from app.services.replanning_service import is_weekend_or_holiday

async def main():
    async with AsyncSessionLocal() as db:
        tasks_res = await db.execute(
            select(Task).options(joinedload(Task.project))
            .where(Task.completed == 0)
            .where(Task.type != TaskType.PROJECT)
        )
        tasks = tasks_res.scalars().all()
        
        timeline = {}
        for task in tasks:
            if not task.start_date or not task.end_date: continue
            
            duration_days = 0
            cur = task.start_date
            while cur <= task.end_date:
                if not is_weekend_or_holiday(cur):
                    duration_days += 1
                cur += timedelta(days=1)
                
            if duration_days == 0: duration_days = 1
            
            try: workers = json.loads(task.workers) if task.workers else []
            except: workers = []
            
            try: worker_hours = json.loads(task.worker_hours) if task.worker_hours else {}
            except: worker_hours = {}
            
            cur = task.start_date
            while cur <= task.end_date:
                if not is_weekend_or_holiday(cur):
                    if cur not in timeline: timeline[cur] = {}
                    for w in workers:
                        if w not in timeline[cur]: timeline[cur][w] = []
                        total_h = float(worker_hours.get(w, task.planned_hours or 0))
                        daily_h = total_h / duration_days
                        timeline[cur][w].append((task.text, daily_h))
                cur += timedelta(days=1)
                
        for d in sorted([d for d in timeline.keys() if d >= date.today()]):
            for w, w_tasks in timeline[d].items():
                total_h = sum(h for _, h in w_tasks)
                if total_h > 8.0:
                    print(d, w, total_h)

asyncio.run(main())
