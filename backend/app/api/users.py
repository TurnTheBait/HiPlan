from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.dependencies import get_db, get_current_user, require_role
from app.models.user import User, UserRole
from app.schemas.user import UserOut, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=List[UserOut])
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    return result.scalars().all()


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/{user_id}", response_model=UserOut)
async def update_user(
    user_id: str,
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(user, key, value)
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")

    await db.delete(user)
    await db.commit()
    return {"ok": True}

from app.models.task import Task, TaskType
from collections import defaultdict
from datetime import date, timedelta
import json

@router.get("/me/tasks/today")
async def get_my_tasks_today(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy.orm import selectinload
    
    # Get current user's username (was full_name or username, now username is the id in tasks)
    user_name = current_user.username
    
    result = await db.execute(
        select(Task).options(selectinload(Task.project))
        .where(Task.type != TaskType.PROJECT)
        .where(Task.start_date.isnot(None))
        .where(Task.end_date.isnot(None))
    )
    tasks = result.scalars().all()
    
    my_tasks = []
    today_date = date.today()
    
    for task in tasks:
        # Check if today is within task's active dates
        if not (task.start_date <= today_date <= task.end_date):
            continue
            
        try:
            workers_list = json.loads(task.workers) if task.workers else []
        except:
            workers_list = []
            
        if user_name in workers_list:
            worker_hours = {}
            if getattr(task, 'worker_hours', None):
                try:
                    worker_hours = json.loads(task.worker_hours)
                except:
                    pass
                    
            my_tasks.append({
                "id": task.id,
                "text": task.text,
                "project_id": task.project_id,
                "project_name": task.project.name if task.project else "Sconosciuto",
                "progress": round((task.progress or 0) * 100),
                "planned_hours": task.planned_hours,
                "my_assigned_hours": worker_hours.get(user_name, None)
            })
            
    return my_tasks

@router.get("/conflicts")
async def get_worker_conflicts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    # Fetch all tasks that have start_date and end_date and might have workers
    # We join with project to get project name
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Task).options(selectinload(Task.project))
        .where(Task.type != TaskType.PROJECT)
        .where(Task.start_date.isnot(None))
        .where(Task.end_date.isnot(None))
    )
    tasks = result.scalars().all()
    
    # Map: worker_name -> date (string) -> list of tasks
    worker_timeline = defaultdict(lambda: defaultdict(list))
    
    for task in tasks:
        try:
            workers_list = json.loads(task.workers) if task.workers else []
        except:
            workers_list = []
        
        if not workers_list:
            continue
            
        current_date = task.start_date
        end_date = task.end_date
        
        try:
            worker_hours_map = json.loads(getattr(task, 'worker_hours', '{}')) or {}
        except:
            worker_hours_map = {}
            
        while current_date <= end_date:
            date_str = current_date.isoformat()
            duration_days = task.duration if task.duration and task.duration > 0 else 1
            
            for worker_name in workers_list:
                base_hours = worker_hours_map.get(worker_name, task.planned_hours or 0.0)
                daily_hours = base_hours / duration_days
                
                worker_timeline[worker_name][date_str].append({
                    "task_id": task.id,
                    "task_name": task.text,
                    "project_id": task.project_id,
                    "project_name": task.project.name if task.project else "Sconosciuto",
                    "daily_hours": round(daily_hours, 1)
                })
            current_date += timedelta(days=1)
            
    # Now find conflicts
    conflicts = []
    today_str = date.today().isoformat()
    
    for worker_name, dates_map in worker_timeline.items():
        for date_str, assigned_tasks in dates_map.items():
            total_hours = sum(t.get("daily_hours", 0) for t in assigned_tasks)
            if date_str >= today_str and total_hours > 8.0:
                conflicts.append({
                    "date": date_str,
                    "worker": worker_name,
                    "total_hours": round(total_hours, 1),
                    "tasks": assigned_tasks
                })
                
    conflicts.sort(key=lambda x: (x["date"], x["worker"]))
    return conflicts
