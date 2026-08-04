import json
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable

# pyrefly: ignore [missing-import]
from fastapi import HTTPException
# pyrefly: ignore [missing-import]
from sqlalchemy import select
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import selectinload

from app.core.websocket_manager import manager
from app.models.activity_log import ActivityCategory, ActivityLog
from app.models.link import Link
from app.models.notification import Notification, NotificationType
from app.models.planning_run import PlanningRun
from app.models.project import Project
from app.models.project import ProjectStatus
from app.models.task import Task, TaskType
from app.models.user import User, UserRole
from app.models.vacation import Vacation
from app.utils.working_days import (
    count_working_days_in_range,
    get_working_days_in_range,
    is_working_day,
)

DAILY_CAPACITY = 8.0
MAX_SEARCH_DAYS = 730
logger = logging.getLogger(__name__)


def _json(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return default


def _date(value: Any) -> date | None:
    if value is None or isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _next_working_day(value: date) -> date:
    current = value + timedelta(days=1)
    while not is_working_day(current):
        current += timedelta(days=1)
    return current


def _add_working_days(value: date, amount: int) -> date:
    current = value
    if amount == 0:
        while not is_working_day(current):
            current += timedelta(days=1)
        return current
    direction = 1 if amount > 0 else -1
    remaining = abs(amount)
    while remaining:
        current += timedelta(days=direction)
        if is_working_day(current):
            remaining -= 1
    return current


def _task_state(task: Task) -> dict[str, Any]:
    return {
        "start_date": task.start_date.isoformat() if task.start_date else None,
        "end_date": task.end_date.isoformat() if task.end_date else None,
        "duration": int(task.duration or 0),
        "has_vacation_conflict": int(task.has_vacation_conflict or 0),
    }


def _state_matches(task: Task, expected: dict[str, Any]) -> bool:
    return _task_state(task) == expected


def _actual_hours(task: Task, worker: str | None = None) -> float:
    payload = _json(task.actual_hours, {})
    if not isinstance(payload, dict):
        return 0.0
    total = 0.0
    for worker_name, days in payload.items():
        if worker is not None and worker_name != worker:
            continue
        if not isinstance(days, dict):
            continue
        for hours in days.values():
            try:
                total += float(hours or 0)
            except (TypeError, ValueError):
                pass
    return total


def _worker_planned_hours(task: Task, worker: str, workers: list[str]) -> float:
    worker_hours = _json(task.worker_hours, {})
    if isinstance(worker_hours, dict) and worker_hours.get(worker) is not None:
        try:
            return max(0.0, float(worker_hours[worker]))
        except (TypeError, ValueError):
            pass
    return max(0.0, float(task.planned_hours or 0)) / max(1, len(workers))


def _is_completed(task: Task) -> bool:
    return bool(task.completed == 1 or (task.progress is not None and task.progress >= 1.0))


def _vacation_days_for_worker(
    worker: str,
    start: date,
    end: date,
    vacations_by_worker: dict[str, list[tuple[date, date]]],
) -> list[date]:
    days: set[date] = set()
    for vacation_start, vacation_end in vacations_by_worker.get(worker, []):
        overlap_start = max(start, vacation_start)
        overlap_end = min(end, vacation_end)
        if overlap_start <= overlap_end:
            days.update(get_working_days_in_range(overlap_start, overlap_end))
    return sorted(days)


async def _load_context(db: AsyncSession, project_id: str):
    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Commessa non trovata")

    task_result = await db.execute(select(Task).where(Task.project_id == project_id))
    tasks = list(task_result.scalars().all())
    link_result = await db.execute(select(Link).where(Link.project_id == project_id))
    links = list(link_result.scalars().all())
    user_result = await db.execute(select(User).where(User.is_active == True))
    users = list(user_result.scalars().all())
    vacation_result = await db.execute(select(Vacation))
    vacations = list(vacation_result.scalars().all())

    user_by_id = {str(user.id): user for user in users}
    aliases: dict[str, str] = {}
    for user in users:
        aliases[user.username] = user.username
        if user.full_name:
            aliases[user.full_name] = user.username

    vacations_by_worker: dict[str, list[tuple[date, date]]] = defaultdict(list)
    for vacation in vacations:
        user = user_by_id.get(str(vacation.user_id))
        if user:
            vacations_by_worker[user.username].append((vacation.start_date, vacation.end_date))

    return project, tasks, links, users, aliases, vacations_by_worker


def _detect_scenarios(
    tasks: Iterable[Task],
    aliases: dict[str, str],
    vacations_by_worker: dict[str, list[tuple[date, date]]],
    today: date,
) -> list[dict[str, Any]]:
    scenarios: list[dict[str, Any]] = []
    for task in tasks:
        if task.type == TaskType.MILESTONE or _is_completed(task) or not task.start_date:
            continue
        task_end = task.end_date or task.start_date
        workdays = get_working_days_in_range(task.start_date, task_end)
        if not workdays:
            continue

        workers = [str(worker) for worker in _json(task.workers, []) if worker]
        reasons: list[str] = []
        worker_missing: dict[str, float] = defaultdict(float)
        vacation_dates: set[date] = set()

        # L'esecuzione notturna valuta solo giornate concluse: le ore della
        # giornata corrente non devono risultare mancanti alle 01:15.
        elapsed_end = min(today - timedelta(days=1), task_end)
        elapsed_days = get_working_days_in_range(task.start_date, elapsed_end) if elapsed_end >= task.start_date else []
        if elapsed_days:
            elapsed_ratio = min(1.0, len(elapsed_days) / len(workdays))
            for worker in workers:
                planned = _worker_planned_hours(task, worker, workers)
                expected = planned * elapsed_ratio
                missing = max(0.0, expected - _actual_hours(task, worker))
                if missing >= 0.5:
                    worker_missing[worker] = max(worker_missing[worker], missing)
            total_delay = sum(worker_missing.values())
            if total_delay >= 0.5:
                reasons.append(f"{round(total_delay, 1)}h non consuntivate rispetto all'avanzamento atteso")

        for worker in workers:
            canonical = aliases.get(worker, worker)
            overlap = _vacation_days_for_worker(canonical, task.start_date, task_end, vacations_by_worker)
            if not overlap:
                continue
            planned = _worker_planned_hours(task, worker, workers)
            vacation_missing = planned / len(workdays) * len(overlap)
            worker_missing[worker] = max(worker_missing[worker], vacation_missing)
            vacation_dates.update(overlap)

        if vacation_dates:
            reasons.append(
                f"ferie sovrapposte in {len(vacation_dates)} "
                f"{'giorno lavorativo' if len(vacation_dates) == 1 else 'giorni lavorativi'}"
            )
        elif task.has_vacation_conflict:
            remaining = max(0.0, float(task.planned_hours or 0) - _actual_hours(task))
            if remaining >= 0.5:
                reasons.append("conflitto ferie precedentemente rilevato")
                if workers:
                    for worker in workers:
                        worker_missing[worker] = max(worker_missing[worker], remaining / len(workers))

        missing_hours = round(sum(worker_missing.values()), 1)
        if not reasons or missing_hours < 0.5:
            continue
        scenarios.append({
            "task_id": str(task.id),
            "task_name": task.text,
            "reason": "; ".join(reasons),
            "missing_hours": missing_hours,
            "workers": workers,
            "worker_missing": {worker: round(hours, 2) for worker, hours in worker_missing.items() if hours > 0},
            "start_date": task.start_date.isoformat(),
            "end_date": task_end.isoformat(),
            "actionable": bool(workers),
        })
    return scenarios


def _build_capacity(tasks: Iterable[Task], aliases: dict[str, str]) -> dict[tuple[str, date], float]:
    capacity: dict[tuple[str, date], float] = defaultdict(float)
    for task in tasks:
        if task.type == TaskType.MILESTONE or _is_completed(task) or not task.start_date:
            continue
        task_end = task.end_date or task.start_date
        dates = get_working_days_in_range(task.start_date, task_end)
        workers = [str(worker) for worker in _json(task.workers, []) if worker]
        if not dates or not workers:
            continue
        for worker in workers:
            canonical = aliases.get(worker, worker)
            daily = _worker_planned_hours(task, worker, workers) / len(dates)
            for work_date in dates:
                capacity[(canonical, work_date)] += daily
    return capacity


def _allocate_hours(
    worker: str,
    hours: float,
    search_start: date,
    capacity: dict[tuple[str, date], float],
    vacations_by_worker: dict[str, list[tuple[date, date]]],
) -> list[dict[str, Any]]:
    remaining = round(hours, 2)
    allocations: list[dict[str, Any]] = []
    current = search_start
    for _ in range(MAX_SEARCH_DAYS):
        if remaining <= 0.01:
            break
        if is_working_day(current) and not _vacation_days_for_worker(worker, current, current, vacations_by_worker):
            used = capacity[(worker, current)]
            available = max(0.0, DAILY_CAPACITY - used)
            assigned = min(remaining, available)
            if assigned > 0.01:
                assigned = round(assigned, 2)
                allocations.append({"date": current.isoformat(), "hours": assigned})
                capacity[(worker, current)] += assigned
                remaining = round(remaining - assigned, 2)
        current += timedelta(days=1)
    if remaining > 0.01:
        raise HTTPException(
            status_code=409,
            detail=f"Capacità insufficiente per ripianificare {hours}h dell'addetto {worker} nei prossimi {MAX_SEARCH_DAYS} giorni",
        )
    return allocations


def _block_overlaps_vacation(
    workers: list[str],
    start: date,
    end: date,
    aliases: dict[str, str],
    vacations_by_worker: dict[str, list[tuple[date, date]]],
) -> bool:
    return any(
        _vacation_days_for_worker(aliases.get(worker, worker), start, end, vacations_by_worker)
        for worker in workers
    )


def _valid_shifted_range(
    task: Task,
    requested_start: date,
    aliases: dict[str, str],
    vacations_by_worker: dict[str, list[tuple[date, date]]],
) -> tuple[date, date]:
    duration = max(1, count_working_days_in_range(task.start_date, task.end_date or task.start_date))
    start = _add_working_days(requested_start, 0)
    workers = [str(worker) for worker in _json(task.workers, []) if worker]
    for _ in range(MAX_SEARCH_DAYS):
        end = _add_working_days(start, duration - 1)
        if not _block_overlaps_vacation(workers, start, end, aliases, vacations_by_worker):
            return start, end
        start = _next_working_day(start)
    raise HTTPException(status_code=409, detail=f"Impossibile trovare un periodo libero per la fase '{task.text}'")


def _dependency_required_start(source: Task, target: Task, link: Link) -> date | None:
    if not source.start_date or not target.start_date:
        return None
    source_end = source.end_date or source.start_date
    target_end = target.end_date or target.start_date
    target_duration = max(1, count_working_days_in_range(target.start_date, target_end))
    lag = max(0, int(link.lag or 0))
    link_type = link.type.value if link.type else "0"
    if link_type == "0":  # Finish-to-Start
        required = _next_working_day(source_end)
        return _add_working_days(required, lag)
    if link_type == "1":  # Start-to-Start
        return _add_working_days(source.start_date, lag)
    if link_type == "2":  # Finish-to-Finish
        required_end = _add_working_days(source_end, lag)
        return _add_working_days(required_end, -(target_duration - 1))
    required_end = _add_working_days(source.start_date, lag)  # Start-to-Finish
    return _add_working_days(required_end, -(target_duration - 1))


def _serialize_run(run: PlanningRun) -> dict[str, Any]:
    snapshot = _json(run.snapshot_json, {})
    return {
        "id": str(run.id),
        "project_id": str(run.project_id),
        "status": run.status,
        "trigger_summary": run.trigger_summary,
        "solution_summary": run.solution_summary,
        "changes": snapshot.get("tasks", []),
        "allocations": _json(run.allocations_json, []),
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "created_by": (run.created_by.full_name or run.created_by.username) if run.created_by else "Agente HiPlan",
        "undone_at": run.undone_at.isoformat() if run.undone_at else None,
        "undone_by": (run.undone_by.full_name or run.undone_by.username) if run.undone_by else None,
    }


async def _active_allocations(db: AsyncSession, project_id: str) -> dict[tuple[str, str], float]:
    result = await db.execute(
        select(PlanningRun).where(
            PlanningRun.project_id == project_id,
            PlanningRun.status == "applied",
        )
    )
    allocated: dict[tuple[str, str], float] = defaultdict(float)
    for run in result.scalars().all():
        for allocation in _json(run.allocations_json, []):
            task_id = str(allocation.get("task_id") or "")
            worker = str(allocation.get("worker") or "")
            if task_id and worker:
                allocated[(task_id, worker)] += float(allocation.get("hours") or 0)
    return allocated


def _subtract_planned_recovery(
    scenarios: list[dict[str, Any]],
    allocated: dict[tuple[str, str], float],
) -> list[dict[str, Any]]:
    incremental: list[dict[str, Any]] = []
    for scenario in scenarios:
        already_planned = round(sum(
            allocated.get((scenario["task_id"], worker), 0.0)
            for worker in scenario["worker_missing"]
        ), 1)
        worker_missing = {
            worker: round(max(0.0, float(hours) - allocated.get((scenario["task_id"], worker), 0.0)), 2)
            for worker, hours in scenario["worker_missing"].items()
        }
        worker_missing = {worker: hours for worker, hours in worker_missing.items() if hours >= 0.5}
        missing_hours = round(sum(worker_missing.values()), 1)
        if missing_hours < 0.5:
            continue
        incremental.append({
            **scenario,
            "worker_missing": worker_missing,
            "missing_hours": missing_hours,
            "reason": (
                f"{scenario['reason']}; {already_planned}h già pianificate in recuperi precedenti"
                if already_planned > 0
                else scenario["reason"]
            ),
        })
    return incremental


async def analyze_project(db: AsyncSession, project_id: str) -> list[dict[str, Any]]:
    _, tasks, _, _, aliases, vacations = await _load_context(db, project_id)
    scenarios = _detect_scenarios(tasks, aliases, vacations, date.today())
    return _subtract_planned_recovery(scenarios, await _active_allocations(db, project_id))


async def list_runs(db: AsyncSession, project_id: str) -> list[dict[str, Any]]:
    result = await db.execute(
        select(PlanningRun)
        .where(PlanningRun.project_id == project_id)
        .options(selectinload(PlanningRun.created_by), selectinload(PlanningRun.undone_by))
        .order_by(PlanningRun.created_at.desc())
    )
    return [_serialize_run(run) for run in result.scalars().all()]


async def apply_rescheduling(
    db: AsyncSession,
    project_id: str,
    actor: User | None,
    selected_task_ids: list[str] | None = None,
    allow_when_paused: bool = False,
) -> dict[str, Any]:
    project, tasks, links, users, aliases, vacations = await _load_context(db, project_id)
    if project.planning_agent_paused and not allow_when_paused:
        raise HTTPException(status_code=409, detail="L'agente di pianificazione è in pausa per questa commessa")
    scenarios = _detect_scenarios(tasks, aliases, vacations, date.today())
    scenarios = _subtract_planned_recovery(scenarios, await _active_allocations(db, project_id))
    if selected_task_ids:
        selected = {str(task_id) for task_id in selected_task_ids}
        scenarios = [scenario for scenario in scenarios if scenario["task_id"] in selected]
    actionable = [scenario for scenario in scenarios if scenario["actionable"]]
    if not actionable:
        raise HTTPException(status_code=400, detail="Nessuno scenario ripianificabile con gli stessi addetti")

    tasks_by_id = {str(task.id): task for task in tasks}
    capacity = _build_capacity(tasks, aliases)
    before_states: dict[str, dict[str, Any]] = {}
    reasons_by_task: dict[str, list[str]] = defaultdict(list)
    allocations: list[dict[str, Any]] = []

    for scenario in actionable:
        task = tasks_by_id[scenario["task_id"]]
        before_states.setdefault(str(task.id), _task_state(task))
        search_start = _next_working_day(max(date.today(), task.end_date or task.start_date))
        latest_date = task.end_date or task.start_date
        for worker_label, hours in scenario["worker_missing"].items():
            canonical = aliases.get(worker_label, worker_label)
            worker_allocations = _allocate_hours(canonical, float(hours), search_start, capacity, vacations)
            if worker_allocations:
                latest_date = max(latest_date, date.fromisoformat(worker_allocations[-1]["date"]))
                allocations.append({
                    "task_id": str(task.id),
                    "task_name": task.text,
                    "worker": worker_label,
                    "hours": round(sum(item["hours"] for item in worker_allocations), 2),
                    "days": worker_allocations,
                })
        task.end_date = latest_date
        task.duration = max(1, count_working_days_in_range(task.start_date, latest_date))
        task.has_vacation_conflict = 0
        reasons_by_task[str(task.id)].append(scenario["reason"])

    # Propaga lo slittamento lungo tutte le dipendenze, senza cambiare addetti o ore.
    max_dependency_passes = max(1, len(tasks) * 2)
    for dependency_pass in range(max_dependency_passes):
        changed = False
        for link in links:
            source = tasks_by_id.get(str(link.source))
            target = tasks_by_id.get(str(link.target))
            if not source or not target or target.type == TaskType.MILESTONE and not target.start_date:
                continue
            required_start = _dependency_required_start(source, target, link)
            if not required_start or not target.start_date or required_start <= target.start_date:
                continue
            before_states.setdefault(str(target.id), _task_state(target))
            if target.type == TaskType.MILESTONE:
                shifted_start = _add_working_days(required_start, 0)
                target.start_date = shifted_start
                target.end_date = shifted_start
                target.duration = 0
            else:
                shifted_start, shifted_end = _valid_shifted_range(target, required_start, aliases, vacations)
                target.start_date = shifted_start
                target.end_date = shifted_end
                target.duration = max(1, count_working_days_in_range(shifted_start, shifted_end))
            reasons_by_task[str(target.id)].append(f"posticipata per rispettare la dipendenza dalla fase '{source.text}'")
            changed = True
        if not changed:
            break
        if dependency_pass == max_dependency_passes - 1:
            raise HTTPException(
                status_code=409,
                detail="Impossibile propagare le date: verificare che le dipendenze non contengano un ciclo",
            )

    changed_tasks = [task for task in tasks if str(task.id) in before_states and _task_state(task) != before_states[str(task.id)]]
    if not changed_tasks:
        raise HTTPException(status_code=400, detail="L'analisi non richiede modifiche alle date")

    project_before_end = project.end_date.isoformat() if project.end_date else None
    latest_project_end = max((task.end_date or task.start_date for task in tasks if task.start_date), default=project.end_date)
    if latest_project_end and (not project.end_date or latest_project_end > project.end_date):
        project.end_date = latest_project_end

    changes = []
    for task in changed_tasks:
        changes.append({
            "task_id": str(task.id),
            "task_name": task.text,
            "before": before_states[str(task.id)],
            "after": _task_state(task),
            "reason": "; ".join(dict.fromkeys(reasons_by_task[str(task.id)])),
        })

    trigger_summary = " | ".join(dict.fromkeys(scenario["reason"] for scenario in actionable))
    recovered_hours = round(sum(float(scenario["missing_hours"]) for scenario in actionable), 1)
    solution_summary = (
        f"Ripianificate {recovered_hours}h sugli stessi addetti; "
        f"aggiornate {len(changes)} fasi incluse quelle dipendenti."
    )
    snapshot = {
        "project": {
            "before_end": project_before_end,
            "after_end": project.end_date.isoformat() if project.end_date else None,
        },
        "tasks": changes,
    }
    run = PlanningRun(
        project_id=project_id,
        created_by_id=actor.id if actor else None,
        status="applied",
        trigger_summary=trigger_summary,
        solution_summary=solution_summary,
        snapshot_json=json.dumps(snapshot, ensure_ascii=False),
        allocations_json=json.dumps(allocations, ensure_ascii=False),
    )
    db.add(run)
    db.add(ActivityLog(
        project_id=project_id,
        user_id=actor.id if actor else None,
        category=ActivityCategory.PHASE_PROJECT_EDIT,
        action_text=f"[Agente pianificazione] {trigger_summary}. {solution_summary}",
    ))

    affected_usernames = {aliases.get(worker, worker) for scenario in actionable for worker in scenario["workers"]}
    notification_ids = {str(project.owner_id), str(project.responsible_id or "")}
    if actor:
        notification_ids.add(str(actor.id))
    for user in users:
        if user.username in affected_usernames or user.role in (UserRole.ADMIN, UserRole.EDITOR):
            notification_ids.add(str(user.id))
    for user_id in notification_ids:
        if not user_id:
            continue
        db.add(Notification(
            user_id=user_id,
            title="Pianificazione aggiornata dall'agente HiPlan",
            message=f"{project.name}: {trigger_summary}. {solution_summary}",
            type=NotificationType.UPDATE,
            project_id=project_id,
        ))

    await db.commit()
    result = await db.execute(
        select(PlanningRun)
        .where(PlanningRun.id == run.id)
        .options(selectinload(PlanningRun.created_by), selectinload(PlanningRun.undone_by))
    )
    saved_run = result.scalar_one()
    await manager.broadcast(project_id, {"action": "auto_reschedule_applied", "run_id": str(run.id)})
    return _serialize_run(saved_run)


async def undo_rescheduling(db: AsyncSession, project_id: str, run_id: str, actor: User) -> dict[str, Any]:
    result = await db.execute(
        select(PlanningRun)
        .where(PlanningRun.id == run_id, PlanningRun.project_id == project_id)
        .options(selectinload(PlanningRun.created_by), selectinload(PlanningRun.undone_by))
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Ripianificazione non trovata")
    if run.status != "applied":
        raise HTTPException(status_code=409, detail="Questa ripianificazione è già stata annullata")

    snapshot = _json(run.snapshot_json, {})
    task_snapshots = snapshot.get("tasks", [])
    task_ids = [item["task_id"] for item in task_snapshots]
    task_result = await db.execute(select(Task).where(Task.id.in_(task_ids)))
    tasks = {str(task.id): task for task in task_result.scalars().all()}
    conflicts = [
        item["task_name"] for item in task_snapshots
        if item["task_id"] not in tasks or not _state_matches(tasks[item["task_id"]], item["after"])
    ]
    project_result = await db.execute(select(Project).where(Project.id == project_id))
    project = project_result.scalar_one_or_none()
    expected_project_end = snapshot.get("project", {}).get("after_end")
    current_project_end = project.end_date.isoformat() if project and project.end_date else None
    if expected_project_end != current_project_end:
        conflicts.append("data finale della commessa")
    if conflicts:
        raise HTTPException(
            status_code=409,
            detail="Rollback bloccato perché sono presenti modifiche successive: " + ", ".join(conflicts),
        )

    for item in task_snapshots:
        task = tasks[item["task_id"]]
        before = item["before"]
        task.start_date = _date(before.get("start_date"))
        task.end_date = _date(before.get("end_date"))
        task.duration = int(before.get("duration") or 0)
        task.has_vacation_conflict = int(before.get("has_vacation_conflict") or 0)
    if project:
        project.end_date = _date(snapshot.get("project", {}).get("before_end"))

    run.status = "undone"
    run.undone_by_id = actor.id
    run.undone_at = datetime.now(timezone.utc)
    db.add(ActivityLog(
        project_id=project_id,
        user_id=actor.id,
        category=ActivityCategory.PHASE_PROJECT_EDIT,
        action_text=f"[Agente pianificazione] Annullata ripianificazione: {run.solution_summary}",
    ))
    db.add(Notification(
        user_id=actor.id,
        title="Ripianificazione automatica annullata",
        message=f"Sono state ripristinate {len(task_snapshots)} fasi della commessa {project.name if project else project_id}.",
        type=NotificationType.UPDATE,
        project_id=project_id,
    ))
    await db.commit()
    result = await db.execute(
        select(PlanningRun)
        .where(PlanningRun.id == run.id)
        .options(selectinload(PlanningRun.created_by), selectinload(PlanningRun.undone_by))
    )
    run = result.scalar_one()
    await manager.broadcast(project_id, {"action": "auto_reschedule_undone", "run_id": str(run.id)})
    return _serialize_run(run)


async def run_daily_rescheduling(session_factory=None) -> None:
    """Aggiorna in autonomia tutte le commesse attive che non hanno l'agente in pausa."""
    if session_factory is None:
        from app.models.base import AsyncSessionLocal
        session_factory = AsyncSessionLocal

    async with session_factory() as db:
        result = await db.execute(
            select(Project.id).where(
                Project.status.in_([ProjectStatus.PLANNING, ProjectStatus.ACTIVE]),
                Project.planning_agent_paused == False,
            )
        )
        project_ids = [str(project_id) for project_id in result.scalars().all()]

    for project_id in project_ids:
        async with session_factory() as db:
            try:
                scenarios = await analyze_project(db, project_id)
                if scenarios:
                    await apply_rescheduling(db, project_id, None)
                    logger.info("[PLANNING AGENT] Ripianificata automaticamente la commessa %s", project_id)
            except HTTPException as exc:
                await db.rollback()
                logger.warning("[PLANNING AGENT] Commessa %s non ripianificata: %s", project_id, exc.detail)
            except Exception:
                await db.rollback()
                logger.exception("[PLANNING AGENT] Errore durante la ripianificazione della commessa %s", project_id)
