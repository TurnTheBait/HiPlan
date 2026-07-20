import json
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.task import Task
from app.models.link import Link
from app.schemas.task import TaskCreate, TaskUpdate, TaskOut, LinkCreate, LinkOut, GanttData
from fastapi import HTTPException, status


def _parse_json(val, default):
    if not val:
        return default
    if isinstance(val, (list, dict)):
        return val
    try:
        return json.loads(val)
    except Exception:
        return default


def _task_to_out(task: Task) -> TaskOut:
    tot_eff = 0.0
    actual_map = _parse_json(task.actual_hours, {})
    if isinstance(actual_map, dict):
        for day_map in actual_map.values():
            if isinstance(day_map, dict):
                for h in day_map.values():
                    try:
                        tot_eff += float(h or 0)
                    except (ValueError, TypeError):
                        pass

    planned = float(task.planned_hours or 8.0)
    calc_progress = min(1.0, max(0.0, tot_eff / planned)) if planned > 0 else (1.0 if tot_eff > 0 else 0.0)
    
    is_comp = 1 if (task.completed == 1 or (task.completed != -1 and ((task.progress is not None and task.progress >= 1.0) or (calc_progress >= 1.0 and planned > 0)))) else (task.completed if task.completed is not None else 0)
    eff_progress = 1.0 if is_comp == 1 else (task.progress if task.progress is not None else calc_progress)

    return TaskOut(
        id=task.id,
        text=task.text,
        start_date=task.start_date.strftime("%Y-%m-%d 00:00") if task.start_date else "",
        end_date=task.end_date.strftime("%Y-%m-%d 00:00") if task.end_date else None,
        duration=task.duration,
        progress=eff_progress,
        type=task.type.value if task.type else "task",
        priority=task.priority.value if task.priority else "medium",
        parent=task.parent_id or "0",
        assigned_to=task.assigned_to,
        sort_order=task.sort_order,
        open=task.open,
        planned_hours=task.planned_hours or 8.0,
        workers=_parse_json(task.workers, []),
        worker_hours=_parse_json(task.worker_hours, {}),
        actual_hours=actual_map,
        color=task.color,
        department=task.department,
        completed=is_comp,
    )



def _compute_task_progress_and_completed(task: Task, update_data: Optional[dict] = None):
    # Calcola ore consuntivate totali
    tot_eff = 0.0
    actual_map = _parse_json(task.actual_hours, {})
    if isinstance(actual_map, dict):
        for day_map in actual_map.values():
            if isinstance(day_map, dict):
                for h in day_map.values():
                    try:
                        tot_eff += float(h or 0)
                    except (ValueError, TypeError):
                        pass

    planned = float(task.planned_hours or 8.0)
    if planned > 0:
        calc_progress = min(1.0, max(0.0, tot_eff / planned))
    else:
        calc_progress = 1.0 if tot_eff > 0 else 0.0

    explicit_completed = update_data.get("completed") if update_data and "completed" in update_data else None

    if explicit_completed is not None and int(explicit_completed) == 1:
        task.completed = 1
        task.progress = 1.0
    elif explicit_completed is not None and int(explicit_completed) == -1:
        task.completed = -1
        task.progress = min(0.99, calc_progress) if calc_progress >= 1.0 else calc_progress
    elif explicit_completed is not None and int(explicit_completed) == 0:
        if task.completed != -1 and calc_progress >= 1.0 and planned > 0:
            task.completed = 1
            task.progress = 1.0
        elif task.completed == 1 and calc_progress < 1.0:
            task.completed = 0
            task.progress = calc_progress
        elif task.completed != 1:
            if task.completed != -1:
                task.completed = 0
            task.progress = min(0.99, calc_progress) if calc_progress >= 1.0 else calc_progress
    else:
        if task.completed != -1 and calc_progress >= 1.0 and planned > 0:
            task.completed = 1
            task.progress = 1.0
        elif calc_progress < 1.0:
            if task.completed == 1:
                task.completed = 0
            if task.completed != 1:
                task.progress = calc_progress
            else:
                task.progress = 1.0


def _link_to_out(link: Link) -> LinkOut:
    return LinkOut(
        id=link.id,
        source=link.source,
        target=link.target,
        type=link.type.value if link.type else "0",
        lag=link.lag,
    )


async def get_gantt_data(db: AsyncSession, project_id: str) -> GanttData:
    tasks_result = await db.execute(
        select(Task).where(Task.project_id == project_id).order_by(Task.start_date.asc(), Task.sort_order.asc())
    )
    links_result = await db.execute(
        select(Link).where(Link.project_id == project_id)
    )
    return GanttData(
        tasks=[_task_to_out(t) for t in tasks_result.scalars().all()],
        links=[_link_to_out(l) for l in links_result.scalars().all()],
    )


async def _check_task_manage_permissions(db: AsyncSession, project_id: str, user):
    if not user:
        return
    from app.models.project import Project
    from app.models.user import UserRole
    from sqlalchemy.orm import selectinload
    proj_res = await db.execute(select(Project).options(selectinload(Project.responsible)).where(Project.id == project_id))
    project = proj_res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Progetto non trovato")
    can_manage = (
        user.role in (UserRole.ADMIN, UserRole.EDITOR)
        or user.id == project.owner_id
        or user.id == project.responsible_id
        or (project.responsible and project.responsible.username == user.username)
    )
    if not can_manage:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo owner/responsabile/editor possono creare o eliminare fasi e collegamenti")


async def create_task(db: AsyncSession, project_id: str, data: TaskCreate, user=None) -> TaskOut:
    await _check_task_manage_permissions(db, project_id, user)
    from app.models.task import TaskType
    task = Task(
        project_id=project_id,
        text=data.text,
        start_date=data.start_date,
        end_date=data.end_date,
        duration=0 if data.type == TaskType.MILESTONE else data.duration,
        progress=data.progress,
        type=data.type,
        priority=data.priority,
        parent_id=data.parent_id,
        assigned_to=data.assigned_to,
        sort_order=data.sort_order,
        open=data.open,
        planned_hours=data.planned_hours,
        workers=json.dumps(data.workers),
        worker_hours=json.dumps(data.worker_hours),
        actual_hours=json.dumps(data.actual_hours),
        color=data.color,
        department=data.department,
        completed=data.completed,
    )
    _compute_task_progress_and_completed(task, data.model_dump())

    db.add(task)
    await db.commit()
    await db.refresh(task)
    return _task_to_out(task)


async def update_task(db: AsyncSession, task_id: str, data: TaskUpdate, user=None) -> TaskOut:
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task non trovato")

    if user:
        from app.models.project import Project
        from app.models.user import UserRole
        from sqlalchemy.orm import selectinload
        proj_res = await db.execute(select(Project).options(selectinload(Project.responsible)).where(Project.id == task.project_id))
        project = proj_res.scalar_one_or_none()
        if project:
            can_manage = (
                user.role in (UserRole.ADMIN, UserRole.EDITOR)
                or user.id == project.owner_id
                or user.id == project.responsible_id
                or (project.responsible and project.responsible.username == user.username)
            )
            if not can_manage:
                task_workers = _parse_json(task.workers, [])
                proj_workers = _parse_json(project.assigned_workers, []) if project.assigned_workers else []
                is_worker = (
                    user.username in task_workers or (user.full_name and user.full_name in task_workers)
                    or user.username in proj_workers or (user.full_name and user.full_name in proj_workers)
                )
                if not is_worker:
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non hai i permessi per modificare questa fase")
                update_keys = set(data.model_dump(exclude_unset=True).keys())
                if update_keys and update_keys != {"actual_hours"}:
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="In modalità sola lettura puoi aggiornare solo le ore consuntivate (actual_hours)")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key == "parent_id" and value == "0":
            value = None
        if key in ("workers", "worker_hours", "actual_hours"):
            value = json.dumps(value)
        setattr(task, key, value)
    _compute_task_progress_and_completed(task, update_data)
    await db.commit()
    await db.refresh(task)
    return _task_to_out(task)


async def delete_task(db: AsyncSession, task_id: str, user=None):
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task non trovato")

    await _check_task_manage_permissions(db, task.project_id, user)

    # Elimina anche i link collegati
    await db.execute(
        select(Link).where((Link.source == task_id) | (Link.target == task_id))
    )
    from sqlalchemy import delete as sql_delete
    await db.execute(sql_delete(Link).where((Link.source == task_id) | (Link.target == task_id)))

    await db.delete(task)
    await db.commit()


async def create_link(db: AsyncSession, project_id: str, data: LinkCreate, user=None) -> LinkOut:
    await _check_task_manage_permissions(db, project_id, user)
    from app.models.link import LinkType
    link = Link(
        project_id=project_id,
        source=data.source,
        target=data.target,
        type=LinkType(data.type),
        lag=data.lag,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return _link_to_out(link)


async def delete_link(db: AsyncSession, link_id: str, user=None):
    result = await db.execute(select(Link).where(Link.id == link_id))
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link non trovato")
    await _check_task_manage_permissions(db, link.project_id, user)
    await db.delete(link)
    await db.commit()
