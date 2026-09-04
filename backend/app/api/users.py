from typing import List
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select
# pyrefly: ignore [missing-import]
from app.core.dependencies import get_db, get_current_user, require_role
from app.models.user import User, UserRole
# pyrefly: ignore [missing-import]
from app.schemas.user import UserOut, UserUpdate, UserPasswordUpdate
from app.services import task_service

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


@router.patch("/me", response_model=UserOut)
async def update_me(
    data: UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    update_data = data.model_dump(exclude_unset=True)
    
    # Restrict users from updating their own role or active status
    update_data.pop("role", None)
    update_data.pop("is_active", None)
    update_data.pop("department", None)

    if "username" in update_data and update_data["username"] != current_user.username:
        # Check if username already exists
        existing = await db.execute(select(User).where(User.username == update_data["username"]))
        if existing.scalar_one_or_none():
            # pyrefly: ignore [missing-import]
            from fastapi import HTTPException, status
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username già in uso")

    if "email" in update_data and update_data["email"] and update_data["email"] != current_user.email:
        # Check if email already exists
        existing = await db.execute(select(User).where(User.email == update_data["email"]))
        if existing.scalar_one_or_none():
            # pyrefly: ignore [missing-import]
            from fastapi import HTTPException, status
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email già in uso")

    for key, value in update_data.items():
        setattr(current_user, key, value)
        
    await db.commit()
    await db.refresh(current_user)
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
        # pyrefly: ignore [missing-import]
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(user, key, value)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/{user_id}/reset-password", response_model=UserOut)
async def reset_user_password(
    user_id: str,
    data: UserPasswordUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        # pyrefly: ignore [missing-import]
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")

    from app.core.security import hash_password
    user.hashed_password = hash_password(data.new_password)
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
        # pyrefly: ignore [missing-import]
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")

    if user.username == "admin":
        # pyrefly: ignore [missing-import]
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non è possibile eliminare l'account amministratore principale")

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
    # pyrefly: ignore [missing-import]
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
                    
            actual_h = {}
            if getattr(task, 'actual_hours', None):
                try:
                    actual_h = json.loads(task.actual_hours)
                except:
                    pass
            actual_hours_today = actual_h.get(user_name, {}).get(today_date.strftime("%Y-%m-%d"), "")

            expected_hours_today = ""
            if task.start_date and task.end_date:
                from app.services.replanning_service import get_working_days_count
                try:
                    excluded = json.loads(task.excluded_dates) if task.excluded_dates else []
                except:
                    excluded = []
                wdays = get_working_days_count(task.start_date, task.end_date, excluded)
                if wdays > 0:
                    try:
                        val = worker_hours.get(user_name)
                        if val is None:
                            raise ValueError()
                        tot_worker = float(val)
                    except:
                        tot_worker = float(task.planned_hours or 0) / max(1, len(workers_list))
                    expected_hours_today = round(tot_worker / wdays, 1)

            t_out = task_service._task_to_out(task)
            my_tasks.append({
                "id": task.id,
                "text": task.text,
                "project_id": task.project_id,
                "project_name": task.project.name if task.project else "Sconosciuto",
                "progress": round((t_out.progress or 0) * 100),
                "planned_hours": task.planned_hours,
                "my_assigned_hours": worker_hours.get(user_name, None),
                "actual_hours_today": actual_hours_today,
                "expected_hours_today": expected_hours_today,
                "color": task.color
            })
            
    return my_tasks

@router.get("/conflicts")
async def get_worker_conflicts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Fetch all tasks that have start_date and end_date and might have workers
    # We join with project to get project name
    # pyrefly: ignore [missing-import]
    from sqlalchemy.orm import selectinload
    from app.services.replanning_service import is_weekend_or_holiday, get_working_days_count
    result = await db.execute(
        select(Task).options(selectinload(Task.project))
        .where(Task.type != TaskType.PROJECT)
        .where(Task.type != TaskType.MILESTONE)
        .where(Task.start_date.isnot(None))
        .where(Task.end_date.isnot(None))
    )
    tasks = result.scalars().all()
    
    # Map: worker_name -> date (string) -> list of tasks
    worker_timeline = defaultdict(lambda: defaultdict(list))
    
    for task in tasks:
        if task.project:
            p_status = task.project.status.value if hasattr(task.project.status, 'value') else str(task.project.status)
            if p_status in ("completed", "archived", "ProjectStatus.COMPLETED", "ProjectStatus.ARCHIVED"):
                continue

        try:
            workers_list = json.loads(task.workers) if task.workers else []
        except:
            workers_list = []
        
        if not workers_list:
            continue
            
        try:
            excluded_dates = json.loads(task.excluded_dates) if getattr(task, 'excluded_dates', None) else []
        except:
            excluded_dates = []

        current_date = task.start_date
        inclusive_end = task.end_date
        
        try:
            worker_hours_map = json.loads(getattr(task, 'worker_hours', '{}')) or {}
        except:
            worker_hours_map = {}
            
        duration_days = get_working_days_count(task.start_date, inclusive_end, excluded_dates)
            
        while current_date <= inclusive_end:
            if not is_weekend_or_holiday(current_date) and current_date.strftime("%Y-%m-%d") not in excluded_dates:
                date_str = current_date.isoformat()
                
                for worker_name in workers_list:
                    base_hours = worker_hours_map.get(worker_name)
                    if base_hours is not None:
                        try:
                            base_hours = float(base_hours)
                        except:
                            base_hours = float(task.planned_hours or 0.0) / len(workers_list)
                    else:
                        base_hours = float(task.planned_hours or 0.0) / len(workers_list)
                        
                    daily_hours = base_hours / duration_days
                    
                    worker_timeline[worker_name][date_str].append({
                        "task_id": task.id,
                        "task_name": task.text,
                        "project_id": task.project_id,
                        "project_name": task.project.name if task.project else "Sconosciuto",
                        "project_code": task.project.code if task.project else "—",
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
