import json
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.dependencies import get_db, get_current_user
from app.models.user import User
from app.models.vacation import Vacation
from app.models.task import Task
from app.models.project import Project
from app.models.notification import Notification, NotificationType
from pydantic import BaseModel
from datetime import date
from app.utils.working_days import get_working_days_in_range

router = APIRouter(prefix="/api/vacations", tags=["vacations"])


class VacationCreate(BaseModel):
    start_date: date
    end_date: date
    reason: str | None = None


def _parse_json(val, default):
    if not val:
        return default
    if isinstance(val, (list, dict)):
        return val
    try:
        return json.loads(val)
    except Exception:
        return default


async def _compute_recovery_for_user(db: AsyncSession, user: User, vacation: Vacation) -> list:
    """
    For a given vacation period, find tasks assigned to the user that overlap,
    compute how many planned hours fall in the vacation working days,
    and return a list of recovery items.
    """
    vac_start = vacation.start_date
    vac_end = vacation.end_date

    # All tasks where user is in workers list
    tasks_res = await db.execute(select(Task))
    all_tasks = tasks_res.scalars().all()

    recovery_items = []
    for task in all_tasks:
        workers = _parse_json(task.workers, [])
        if user.username not in workers:
            continue
        if not task.start_date or not task.end_date:
            continue

        # Overlap between task period and vacation period
        overlap_start = max(task.start_date, vac_start)
        overlap_end = min(task.end_date, vac_end)
        if overlap_start > overlap_end:
            continue

        # Count working days in overlap
        overlap_days = get_working_days_in_range(overlap_start, overlap_end)
        if not overlap_days:
            continue

        # Total working days in the full task
        task_working_days = get_working_days_in_range(task.start_date, task.end_date)
        if not task_working_days:
            continue

        # Hours assigned to this worker
        worker_hours_map = _parse_json(task.worker_hours, {})
        if user.username in worker_hours_map and worker_hours_map[user.username] is not None:
            assigned_h = float(worker_hours_map[user.username])
        else:
            n_workers = len(workers) if workers else 1
            assigned_h = float(task.planned_hours or 8.0) / n_workers

        daily_h = assigned_h / len(task_working_days)
        hours_to_recover = round(daily_h * len(overlap_days), 1)

        if hours_to_recover <= 0:
            continue

        # Get project name
        proj_res = await db.execute(select(Project).where(Project.id == task.project_id))
        project = proj_res.scalar_one_or_none()

        recovery_items.append({
            "task_id": task.id,
            "task_name": task.text,
            "project_id": task.project_id,
            "project_name": project.name if project else "—",
            "hours_to_recover": hours_to_recover,
            "vacation_days": [str(d) for d in overlap_days],
            "vacation_start": str(vac_start),
            "vacation_end": str(vac_end),
        })

    return recovery_items


@router.get("/me", response_model=list)
async def list_my_vacations(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Vacation).where(Vacation.user_id == current_user.id).order_by(Vacation.start_date.desc()))
    vacations = result.scalars().all()
    return [
        {
            "id": v.id,
            "user_id": v.user_id,
            "start_date": str(v.start_date),
            "end_date": str(v.end_date),
            "reason": v.reason,
            "created_at": v.created_at.isoformat() if v.created_at else None,
            "updated_at": v.updated_at.isoformat() if v.updated_at else None,
        }
        for v in vacations
    ]


@router.post("/me", status_code=201)
async def create_my_vacation(data: VacationCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if data.end_date < data.start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_date must be >= start_date")
    vac = Vacation(user_id=current_user.id, start_date=data.start_date, end_date=data.end_date, reason=data.reason)
    db.add(vac)
    await db.commit()
    await db.refresh(vac)

    # Compute recovery items for this vacation
    recovery_items = await _compute_recovery_for_user(db, current_user, vac)

    # Notification to the user confirming vacation creation
    note = Notification(
        user_id=current_user.id,
        title="Ferie inserite",
        message=f"Ferie dal {data.start_date} al {data.end_date} registrate.",
        type=NotificationType.UPDATE,
    )
    db.add(note)

    # Notifications for ore da recuperare
    for item in recovery_items:
        note_recovery = Notification(
            user_id=current_user.id,
            title="⚠️ Ore da recuperare per ferie",
            message=(
                f"Hai {item['hours_to_recover']}h da recuperare sulla fase \"{item['task_name']}\" "
                f"(progetto: {item['project_name']}) "
                f"a causa delle ferie dal {data.start_date} al {data.end_date}."
            ),
            type=NotificationType.DEADLINE,
            project_id=item["project_id"],
        )
        db.add(note_recovery)

        # Notify project responsible/owner too
        proj_res = await db.execute(select(Project).where(Project.id == item["project_id"]))
        project = proj_res.scalar_one_or_none()
        if project:
            resp_id = project.responsible_id or project.owner_id
            if resp_id and resp_id != current_user.id:
                note_resp = Notification(
                    user_id=resp_id,
                    title=f"⚠️ Ferie: ore scoperte su \"{item['task_name']}\"",
                    message=(
                        f"{current_user.username} è in ferie dal {data.start_date} al {data.end_date}. "
                        f"Sono scoperte {item['hours_to_recover']}h sulla fase \"{item['task_name']}\" "
                        f"nel progetto \"{item['project_name']}\"."
                    ),
                    type=NotificationType.DEADLINE,
                    project_id=item["project_id"],
                )
                db.add(note_resp)

    await db.commit()
    return {"ok": True, "id": vac.id, "recovery_items": recovery_items}


@router.delete("/me/{vacation_id}")
async def delete_my_vacation(vacation_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Vacation).where(Vacation.id == vacation_id, Vacation.user_id == current_user.id))
    vac = result.scalar_one_or_none()
    if not vac:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vacanza non trovata")
    await db.delete(vac)
    await db.commit()
    return {"ok": True}


@router.get("/me/recovery", response_model=list)
async def get_my_recovery_hours(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Return all 'ore da recuperare' for the current user based on their future/current vacations."""
    vac_res = await db.execute(
        select(Vacation).where(Vacation.user_id == current_user.id).order_by(Vacation.start_date.asc())
    )
    vacations = vac_res.scalars().all()

    all_items = []
    for vac in vacations:
        items = await _compute_recovery_for_user(db, current_user, vac)
        all_items.extend(items)

    # Deduplicate by task_id (sum hours if same task appears across multiple vacation periods)
    deduped: dict = {}
    for item in all_items:
        key = item["task_id"]
        if key in deduped:
            deduped[key]["hours_to_recover"] = round(deduped[key]["hours_to_recover"] + item["hours_to_recover"], 1)
            deduped[key]["vacation_days"] = list(set(deduped[key]["vacation_days"] + item["vacation_days"]))
        else:
            deduped[key] = item

    return list(deduped.values())


@router.get("/all", response_model=list)
async def list_all_vacations(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = select(Vacation, User.username).join(User, Vacation.user_id == User.id)
    result = await db.execute(query)
    rows = result.all()
    return [
        {
            "id": v.id,
            "username": u,
            "start_date": str(v.start_date),
            "end_date": str(v.end_date)
        }
        for v, u in rows
    ]
