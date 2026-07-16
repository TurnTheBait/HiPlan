import json
from typing import List
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
    return TaskOut(
        id=task.id,
        text=task.text,
        start_date=task.start_date.strftime("%Y-%m-%d 00:00") if task.start_date else "",
        end_date=task.end_date.strftime("%Y-%m-%d 00:00") if task.end_date else None,
        duration=task.duration,
        progress=task.progress,
        type=task.type.value if task.type else "task",
        priority=task.priority.value if task.priority else "medium",
        parent=task.parent_id or "0",
        assigned_to=task.assigned_to,
        sort_order=task.sort_order,
        open=task.open,
        planned_hours=task.planned_hours or 8.0,
        workers=_parse_json(task.workers, []),
        worker_hours=_parse_json(task.worker_hours, {}),
        actual_hours=_parse_json(task.actual_hours, {}),
        color=task.color,
        department=task.department,
    )


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
        select(Task).where(Task.project_id == project_id).order_by(Task.sort_order)
    )
    links_result = await db.execute(
        select(Link).where(Link.project_id == project_id)
    )
    return GanttData(
        tasks=[_task_to_out(t) for t in tasks_result.scalars().all()],
        links=[_link_to_out(l) for l in links_result.scalars().all()],
    )


async def create_task(db: AsyncSession, project_id: str, data: TaskCreate) -> TaskOut:
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
    )

    db.add(task)
    await db.commit()
    await db.refresh(task)
    return _task_to_out(task)


async def update_task(db: AsyncSession, task_id: str, data: TaskUpdate) -> TaskOut:
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task non trovato")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key == "parent_id" and value == "0":
            value = None
        if key in ("workers", "worker_hours", "actual_hours"):
            value = json.dumps(value)
        setattr(task, key, value)
    await db.commit()
    await db.refresh(task)
    return _task_to_out(task)



async def delete_task(db: AsyncSession, task_id: str):
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task non trovato")

    # Elimina anche i link collegati
    await db.execute(
        select(Link).where((Link.source == task_id) | (Link.target == task_id))
    )
    from sqlalchemy import delete as sql_delete
    await db.execute(sql_delete(Link).where((Link.source == task_id) | (Link.target == task_id)))

    await db.delete(task)
    await db.commit()


async def create_link(db: AsyncSession, project_id: str, data: LinkCreate) -> LinkOut:
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


async def delete_link(db: AsyncSession, link_id: str):
    result = await db.execute(select(Link).where(Link.id == link_id))
    link = result.scalar_one_or_none()
    if not link:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link non trovato")
    await db.delete(link)
    await db.commit()
