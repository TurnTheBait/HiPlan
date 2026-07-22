import json
from typing import List, Optional
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select
from app.models.task import Task
from app.models.link import Link
from app.models.vacation import Vacation
from app.models.notification import Notification, NotificationType
from app.models.user import User
from datetime import timedelta, date
from app.schemas.task import TaskCreate, TaskUpdate, TaskOut, LinkCreate, LinkOut, GanttData
# pyrefly: ignore [missing-import]
from fastapi import HTTPException, status


def find_vacation_conflicts(task_start, task_end, vacations):
    if not vacations:
        return []
    conflict_days = 0
    current = task_start
    while current <= task_end:
        if current.weekday() < 5:
            for vacation in vacations:
                if vacation.get("start_date") and vacation.get("end_date"):
                    start = vacation["start_date"]
                    end = vacation["end_date"]
                    if start <= current <= end:
                        conflict_days += 1
                        break
        current = current + timedelta(days=1)
    return [{"date": task_start, "workdays": conflict_days}] if conflict_days else []


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
        budget_mode=task.budget_mode,
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
    # pyrefly: ignore [missing-import]
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
        budget_mode=data.budget_mode,
        completed=data.completed,
    )
    _compute_task_progress_and_completed(task, data.model_dump())

    # Controllo ferie per eventuali addetti assegnati
    try:
        workers_list = data.workers or []
    except Exception:
        workers_list = []

    total_shift_days = 0
    for worker_name in workers_list:
        u_res = await db.execute(select(User).where(User.username == worker_name))
        worker_user = u_res.scalar_one_or_none()
        if not worker_user:
            continue
        vac_res = await db.execute(select(Vacation).where(Vacation.user_id == worker_user.id))
        vacs = vac_res.scalars().all()
        vacation_payloads = [{"start_date": v.start_date, "end_date": v.end_date} for v in vacs]
        conflicts = find_vacation_conflicts(task.start_date, task.end_date or task.start_date, vacation_payloads)
        total_shift_days = max(total_shift_days, conflicts[0]["workdays"] if conflicts else 0)

    if total_shift_days > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assegnazione bloccata: esistono ferie nel periodo della fase")

    db.add(task)
    await db.commit()
    await db.refresh(task)

    # Notifiche per ferie sovrapposte
    if total_shift_days > 0:
        from app.models.project import Project
        proj_res = await db.execute(select(Project).where(Project.id == project_id))
        project = proj_res.scalar_one_or_none()
        for worker_name in (data.workers or []):
            u_res = await db.execute(select(User).where(User.username == worker_name))
            worker_user = u_res.scalar_one_or_none()
            if not worker_user:
                continue
            note = Notification(
                user_id=worker_user.id,
                title="Ferie rilevate - fase spostata",
                message=f"La fase '{task.text}' è stata spostata di {total_shift_days} giorni a causa di ferie sovrapposte.",
                type=NotificationType.ASSIGNMENT,
                project_id=project.id if project else None,
            )
            db.add(note)
        if project:
            resp_id = project.responsible_id or project.owner_id
            if resp_id:
                note = Notification(
                    user_id=resp_id,
                    title="Fase spostata per ferie",
                    message=f"La fase '{task.text}' nel progetto '{project.name}' è stata spostata di {total_shift_days} giorni.",
                    type=NotificationType.UPDATE,
                    project_id=project.id,
                )
                db.add(note)
        await db.commit()

    return _task_to_out(task)


async def update_task(db: AsyncSession, task_id: str, data: TaskUpdate, user=None) -> TaskOut:
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task non trovato")

    if user:
        from app.models.project import Project
        from app.models.user import UserRole
        # pyrefly: ignore [missing-import]
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
                allowed_keys = {"actual_hours", "end_date", "duration"}
                if update_keys and not update_keys.issubset(allowed_keys):
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="In modalità consuntivazione puoi aggiornare solo le ore consuntivate o prolungare/ridurre i giorni (actual_hours, end_date, duration)")

    old_start = task.start_date
    old_end = task.end_date
    old_duration = task.duration

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key == "parent_id" and value == "0":
            value = None
        if key in ("workers", "worker_hours", "actual_hours"):
            value = json.dumps(value)
        setattr(task, key, value)
    _compute_task_progress_and_completed(task, update_data)
    # Se cambiano workers o date, ricalcoliamo impatti ferie
    try:
        workers_list = json.loads(task.workers) if task.workers else []
    except Exception:
        workers_list = []

    total_shift_days = 0
    for worker_name in workers_list:
        u_res = await db.execute(select(User).where(User.username == worker_name))
        worker_user = u_res.scalar_one_or_none()
        if not worker_user:
            continue
        vac_res = await db.execute(select(Vacation).where(Vacation.user_id == worker_user.id))
        vacs = vac_res.scalars().all()
        vacation_payloads = [{"start_date": v.start_date, "end_date": v.end_date} for v in vacs]
        conflicts = find_vacation_conflicts(task.start_date, task.end_date or task.start_date, vacation_payloads)
        total_shift_days = max(total_shift_days, conflicts[0]["workdays"] if conflicts else 0)

    # Salta il controllo ferie se si stanno solo aggiornando ore consuntivate o stato completamento
    # (non stiamo cambiando date o addetti, solo registrando ore effettive)
    _consuntivo_only_keys = {"actual_hours", "completed", "progress"}
    _changed_keys = set(update_data.keys())
    if not _changed_keys.issubset(_consuntivo_only_keys) and total_shift_days > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assegnazione bloccata: esistono ferie nel periodo della fase")

    # Propagazione a catena quando la data della fase viene modificata esplicitamente
    if "start_date" in update_data or "end_date" in update_data:
        async def propagate_shift(current_task, shift_days, visited=None):
            if shift_days <= 0:
                return
            if visited is None:
                visited = set()
            if current_task.id in visited:
                return
            visited.add(current_task.id)
            current_task.start_date = current_task.start_date + timedelta(days=shift_days) if current_task.start_date else current_task.start_date
            if current_task.end_date:
                current_task.end_date = current_task.end_date + timedelta(days=shift_days)
            if getattr(current_task, "duration", None) is not None:
                current_task.duration = (current_task.duration or 0) + shift_days
            await db.flush()
            links_result = await db.execute(select(Link).where(Link.source == current_task.id))
            for link in links_result.scalars().all():
                child_res = await db.execute(select(Task).where(Task.id == link.target))
                child = child_res.scalar_one_or_none()
                if child and child.id not in visited:
                    await propagate_shift(child, shift_days, visited)

        delta_days = 0
        if "start_date" in update_data and old_start and task.start_date:
            delta_days = (task.start_date - old_start).days
        elif "end_date" in update_data and old_end and task.end_date:
            delta_days = (task.end_date - old_end).days
        if delta_days != 0:
            await propagate_shift(task, delta_days)

        # Se ci sono ore consuntivate nella finestra di ferie, segnala criticità
        try:
            actual_map = _parse_json(task.actual_hours, {})
            if not isinstance(actual_map, dict):
                actual_map = {}
        except Exception:
            actual_map = {}
        had_hours_in_vac = False
        for d in actual_map.keys():
            try:
                d_date = date.fromisoformat(d)
            except Exception:
                continue
            for worker_name in workers_list:
                u_res = await db.execute(select(User).where(User.username == worker_name))
                worker_user = u_res.scalar_one_or_none()
                if not worker_user:
                    continue
                vac_res = await db.execute(select(Vacation).where(Vacation.user_id == worker_user.id))
                for v in vac_res.scalars().all():
                    if v.start_date <= d_date <= v.end_date:
                        had_hours_in_vac = True
                        break
                if had_hours_in_vac:
                    break

        # Notifiche
        from app.models.project import Project
        proj_res = await db.execute(select(Project).where(Project.id == task.project_id))
        project = proj_res.scalar_one_or_none()
        for worker_name in workers_list:
            u_res = await db.execute(select(User).where(User.username == worker_name))
            worker_user = u_res.scalar_one_or_none()
            if not worker_user:
                continue
            note = Notification(
                user_id=worker_user.id,
                title="Ferie rilevate - fase spostata",
                message=f"La fase '{task.text}' è stata spostata di {total_shift_days} giorni a causa di ferie sovrapposte.",
                type=NotificationType.ASSIGNMENT,
                project_id=project.id if project else None,
            )
            db.add(note)

        if had_hours_in_vac and project:
            resp_id = project.responsible_id or project.owner_id
            if resp_id:
                note = Notification(
                    user_id=resp_id,
                    title="Criticità: ore registrate in ferie",
                    message=f"La fase '{task.text}' ha ore registrate durante le ferie: durata estesa di {total_shift_days} giorni.",
                    type=NotificationType.DEADLINE,
                    project_id=project.id,
                )
                db.add(note)

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
    # pyrefly: ignore [missing-import]
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
