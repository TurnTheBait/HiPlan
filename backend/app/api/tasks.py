# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.dependencies import get_db, get_current_user
from app.models.user import User
from app.models.task import TaskType
from app.schemas.task import TaskCreate, TaskUpdate, TaskOut, LinkCreate, LinkOut, GanttData
from app.services import task_service

router = APIRouter(prefix="/api/projects/{project_id}", tags=["tasks"])


@router.get("/gantt", response_model=GanttData)
async def get_gantt_data(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await task_service.get_gantt_data(db, project_id)


def validate_budget_capacity(data):
    if data.type == TaskType.MILESTONE:
        return
    mode = data.budget_mode or 'start_days'
    if mode in ['start_days_hours', 'end_days_hours']:
        duration = data.duration if data.duration is not None else 1
        max_hours = duration * 8.0
        planned = data.planned_hours if data.planned_hours is not None else 8.0
        workers = data.workers or []
        worker_hours = data.worker_hours or {}
        
        if not workers:
            if planned > max_hours:
                raise HTTPException(
                    status_code=400,
                    detail=f"Le ore previste ({planned}h) superano la capacità massima per {duration} giorni ({max_hours}h)."
                )
        else:
            has_explicit = any(float(worker_hours.get(w, 0) or 0) > 0 for w in workers)
            if has_explicit:
                for w in workers:
                    h = float(worker_hours.get(w, 0) or 0)
                    if h > max_hours:
                        raise HTTPException(
                            status_code=400,
                            detail=f"L'addetto {w} ha {h}h assegnate, che superano la capacità massima per {duration} giorni ({max_hours}h)."
                        )
            else:
                avg = planned / len(workers)
                if avg > max_hours:
                    raise HTTPException(
                        status_code=400,
                        detail=f"La media di {avg:.1f}h per addetto supera la capacità massima per {duration} giorni ({max_hours}h)."
                    )


@router.post("/tasks", response_model=TaskOut, status_code=201)
async def create_task(
    project_id: str,
    data: TaskCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    validate_budget_capacity(data)
    return await task_service.create_task(db, project_id, data, current_user)


@router.put("/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: str,
    data: TaskUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    validate_budget_capacity(data)
    return await task_service.update_task(db, task_id, data, current_user)


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await task_service.delete_task(db, task_id, current_user)


@router.post("/links", response_model=LinkOut, status_code=201)
async def create_link(
    project_id: str,
    data: LinkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await task_service.create_link(db, project_id, data, current_user)


@router.delete("/links/{link_id}", status_code=204)
async def delete_link(
    project_id: str,
    link_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await task_service.delete_link(db, link_id, current_user)
