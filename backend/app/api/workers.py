from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.dependencies import get_db, get_current_user, require_role
from app.models.user import User, UserRole
from app.models.worker import PhaseWorker
from app.schemas.worker import PhaseWorkerCreate, PhaseWorkerOut
from app.models.task import Task, TaskType
from app.models.project import Project
import json
from datetime import date, timedelta
from collections import defaultdict

router = APIRouter(prefix="/api/workers", tags=["workers"])

DEFAULT_WORKERS = []


@router.get("", response_model=List[PhaseWorkerOut])
async def list_workers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workers = (await db.execute(select(PhaseWorker).where(PhaseWorker.is_active == True).order_by(PhaseWorker.name))).scalars().all()
    if not workers and (await db.execute(select(PhaseWorker))).scalars().first() is None:
        # Se la tabella è completamente vuota all'inizio, inseriamo i predefiniti
        for name in DEFAULT_WORKERS:
            w = PhaseWorker(name=name)
            db.add(w)
        await db.commit()
        workers = (await db.execute(select(PhaseWorker).where(PhaseWorker.is_active == True).order_by(PhaseWorker.name))).scalars().all()
    return workers


@router.post("", response_model=PhaseWorkerOut, status_code=status.HTTP_201_CREATED)
async def create_worker(
    data: PhaseWorkerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    name_clean = data.name.strip()
    if not name_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Il nome dell'addetto non può essere vuoto")

    existing = (await db.execute(select(PhaseWorker).where(PhaseWorker.name == name_clean))).scalar_one_or_none()
    if existing:
        if not existing.is_active:
            existing.is_active = True
            await db.commit()
            await db.refresh(existing)
            return existing
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Questo addetto esiste già nel sistema")

    worker = PhaseWorker(name=name_clean)
    db.add(worker)
    await db.commit()
    await db.refresh(worker)
    return worker


@router.delete("/{worker_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_worker(
    worker_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    result = await db.execute(select(PhaseWorker).where(PhaseWorker.id == worker_id))
    worker = result.scalar_one_or_none()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Addetto non trovato")
    await db.delete(worker)
    await db.commit()
    await db.commit()
    return None


@router.get("/me/tasks/today")
async def get_my_tasks_today(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy.orm import selectinload
    
    # Get current user's name
    user_name = current_user.full_name or current_user.username
    
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
                # Usa le ore specifiche se presenti, altrimenti fallback sulle ore totali divise
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
            # Calcola il totale delle ore per questa data
            total_hours = sum(t.get("daily_hours", 0) for t in assigned_tasks)
            
            # Un conflitto avviene se le ore totali superano 8
            if date_str >= today_str and total_hours > 8.0:
                conflicts.append({
                    "date": date_str,
                    "worker": worker_name,
                    "total_hours": round(total_hours, 1),
                    "tasks": assigned_tasks
                })
                
    # Sort by date then worker
    conflicts.sort(key=lambda x: (x["date"], x["worker"]))
    return conflicts
