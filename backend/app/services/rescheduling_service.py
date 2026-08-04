import json
import logging
import math
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional

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


def _date(value: Any) -> Optional[date]:
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


def _actual_hours(
    task: Task,
    worker: Optional[str] = None,
    through_date: Optional[date] = None,
) -> float:
    payload = _json(task.actual_hours, {})
    if not isinstance(payload, dict):
        return 0.0
    total = 0.0
    for worker_name, days in payload.items():
        if worker is not None and worker_name != worker:
            continue
        if not isinstance(days, dict):
            continue
        for day_label, hours in days.items():
            if through_date is not None:
                try:
                    logged_day = date.fromisoformat(str(day_label)[:10])
                except ValueError:
                    continue
                if logged_day > through_date:
                    continue
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


def _forward_working_day_distance(start: Optional[date], end: Optional[date]) -> int:
    if not start or not end or end <= start:
        return 0
    return len(get_working_days_in_range(start + timedelta(days=1), end))


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
                missing = max(0.0, expected - _actual_hours(task, worker, elapsed_end))
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
            "project_id": str(task.project_id),
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


def _serialize_run(run: PlanningRun) -> dict[str, Any]:
    snapshot = _json(run.snapshot_json, {})
    return {
        "id": str(run.id),
        "batch_id": run.batch_id,
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


async def _active_allocations(
    db: AsyncSession,
    project_id: Optional[str] = None,
) -> dict[tuple[str, str], float]:
    query = select(PlanningRun).where(PlanningRun.status == "applied")
    if project_id is not None:
        query = query.where(PlanningRun.project_id == project_id)
    result = await db.execute(query)
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


async def analyze_all_projects(
    db: AsyncSession,
    include_paused_project_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Analizza lo stato corrente globale, con un'eventuale commessa in pausa inclusa manualmente."""
    project_result = await db.execute(
        select(Project).where(Project.status.in_([ProjectStatus.PLANNING, ProjectStatus.ACTIVE]))
    )
    projects = list(project_result.scalars().all())
    project_ids = [
        str(project.id)
        for project in projects
        if not project.planning_agent_paused or str(project.id) == str(include_paused_project_id or "")
    ]
    if not project_ids:
        return []

    task_result = await db.execute(select(Task).where(Task.project_id.in_(project_ids)))
    tasks = list(task_result.scalars().all())
    user_result = await db.execute(select(User).where(User.is_active == True))
    users = list(user_result.scalars().all())
    aliases: dict[str, str] = {}
    users_by_id = {}
    for user in users:
        users_by_id[str(user.id)] = user
        aliases[user.username] = user.username
        if user.full_name:
            aliases[user.full_name] = user.username

    vacation_result = await db.execute(select(Vacation))
    vacations_by_worker: dict[str, list[tuple[date, date]]] = defaultdict(list)
    for vacation in vacation_result.scalars().all():
        vacation_user = users_by_id.get(str(vacation.user_id))
        if vacation_user:
            vacations_by_worker[vacation_user.username].append((vacation.start_date, vacation.end_date))

    scenarios = _detect_scenarios(tasks, aliases, vacations_by_worker, date.today())
    return _subtract_planned_recovery(scenarios, await _active_allocations(db))


async def schedule_assignment_at_earliest_capacity(
    db: AsyncSession,
    task: Task,
    exclude_task_id: Optional[str] = None,
) -> dict[str, Any]:
    """Pianifica le ore assegnate nei primi slot liberi, saltando ferie e festivi."""
    user_result = await db.execute(select(User).where(User.is_active == True))
    users = list(user_result.scalars().all())
    aliases: dict[str, str] = {}
    users_by_id = {}
    for user in users:
        users_by_id[str(user.id)] = user
        aliases[user.username] = user.username
        if user.full_name:
            aliases[user.full_name] = user.username

    vacation_result = await db.execute(select(Vacation))
    vacations_by_worker: dict[str, list[tuple[date, date]]] = defaultdict(list)
    for vacation in vacation_result.scalars().all():
        vacation_user = users_by_id.get(str(vacation.user_id))
        if vacation_user:
            vacations_by_worker[vacation_user.username].append((vacation.start_date, vacation.end_date))

    scheduled_query = (
        select(Task)
        .join(Project, Task.project_id == Project.id)
        .where(Project.status.in_([ProjectStatus.PLANNING, ProjectStatus.ACTIVE]))
    )
    if exclude_task_id:
        scheduled_query = scheduled_query.where(Task.id != exclude_task_id)
    scheduled_result = await db.execute(scheduled_query)
    capacity = _build_capacity(scheduled_result.scalars().all(), aliases)

    workers = [str(worker) for worker in _json(task.workers, []) if worker]
    allocations: list[dict[str, Any]] = []
    earliest_date: Optional[date] = None
    latest_date = task.end_date or task.start_date
    for worker_label in workers:
        canonical = aliases.get(worker_label, worker_label)
        hours = _worker_planned_hours(task, worker_label, workers)
        if hours <= 0:
            continue
        worker_allocations = _allocate_hours(
            canonical,
            hours,
            task.start_date,
            capacity,
            vacations_by_worker,
        )
        if worker_allocations:
            first_allocation_date = date.fromisoformat(worker_allocations[0]["date"])
            earliest_date = min(earliest_date, first_allocation_date) if earliest_date else first_allocation_date
            latest_date = max(latest_date, date.fromisoformat(worker_allocations[-1]["date"]))
            allocations.append({
                "worker": worker_label,
                "hours": round(sum(item["hours"] for item in worker_allocations), 2),
                "days": worker_allocations,
            })
    return {
        "start_date": earliest_date or task.start_date,
        "end_date": latest_date,
        "allocations": allocations,
    }


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
    actor: Optional[User],
    selected_task_ids: Optional[list[str]] = None,
    allow_when_paused: bool = False,
    precomputed_scenarios: Optional[list[dict[str, Any]]] = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    trigger_project, trigger_tasks, _, users, aliases, vacations = await _load_context(db, project_id)
    if trigger_project.planning_agent_paused and not allow_when_paused:
        raise HTTPException(status_code=409, detail="L'agente di pianificazione è in pausa per questa commessa")

    if precomputed_scenarios is None:
        scenarios = _detect_scenarios(trigger_tasks, aliases, vacations, date.today())
        scenarios = _subtract_planned_recovery(scenarios, await _active_allocations(db, project_id))
    else:
        scenarios = list(precomputed_scenarios)
    if selected_task_ids:
        selected = {str(task_id) for task_id in selected_task_ids}
        scenarios = [scenario for scenario in scenarios if scenario["task_id"] in selected]
    actionable = [scenario for scenario in scenarios if scenario["actionable"]]
    if not actionable:
        raise HTTPException(status_code=400, detail="Nessuno scenario ripianificabile con gli stessi addetti")

    # Il ritardo appartiene all'addetto: carichiamo tutte le commesse operative
    # sulle quali l'agente è attivo e ripianifichiamo la sua capacità globale.
    project_result = await db.execute(
        select(Project).where(Project.status.in_([ProjectStatus.PLANNING, ProjectStatus.ACTIVE]))
    )
    projects = list(project_result.scalars().all())
    eligible_projects = {
        str(item.id): item
        for item in projects
        if not item.planning_agent_paused or (str(item.id) == str(project_id) and allow_when_paused)
    }
    eligible_projects.setdefault(str(trigger_project.id), trigger_project)
    eligible_project_ids = list(eligible_projects)

    task_result = await db.execute(select(Task).where(Task.project_id.in_(eligible_project_ids)))
    tasks = list(task_result.scalars().all())
    link_result = await db.execute(select(Link).where(Link.project_id.in_(eligible_project_ids)))
    links = list(link_result.scalars().all())
    tasks_by_id = {str(task.id): task for task in tasks}

    before_states: dict[str, dict[str, Any]] = {}
    reasons_by_task: dict[str, list[str]] = defaultdict(list)
    allocations: list[dict[str, Any]] = []
    recovery_capacity: dict[tuple[str, date], float] = defaultdict(float)
    worker_missing_hours: dict[str, float] = defaultdict(float)
    task_shift_days: dict[str, int] = {}
    origin_task_ids = {scenario["task_id"] for scenario in actionable}

    for scenario in actionable:
        for worker_label, hours in scenario["worker_missing"].items():
            canonical = aliases.get(worker_label, worker_label)
            worker_missing_hours[canonical] += float(hours)

    for scenario in actionable:
        task = tasks_by_id[scenario["task_id"]]
        before_states.setdefault(str(task.id), _task_state(task))
        # Le ore saltate vengono inserite subito dopo la pianificazione
        # corrente della fase, spostandone la coda senza sovrascriverla.
        search_start = max(date.today(), _next_working_day(task.end_date or task.start_date))
        search_start = _add_working_days(search_start, 0)
        latest_date = task.end_date or task.start_date
        scenario_shift_days = 0
        for worker_label, hours in scenario["worker_missing"].items():
            canonical = aliases.get(worker_label, worker_label)
            scenario_shift_days = max(scenario_shift_days, math.ceil(float(hours) / DAILY_CAPACITY))
            worker_allocations = _allocate_hours(
                canonical,
                float(hours),
                search_start,
                recovery_capacity,
                vacations,
            )
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
        original_end = (
            _date(before_states[str(task.id)]["end_date"])
            or _date(before_states[str(task.id)]["start_date"])
        )
        scenario_shift_days = max(
            scenario_shift_days,
            _forward_working_day_distance(original_end, latest_date),
        )
        task_shift_days[str(task.id)] = max(task_shift_days.get(str(task.id), 0), scenario_shift_days)
        reasons_by_task[str(task.id)].append(scenario["reason"])

    worker_shift_days = {
        worker: max(1, math.ceil(hours / DAILY_CAPACITY))
        for worker, hours in worker_missing_hours.items()
        if hours > 0
    }

    # Sposta tutte le fasi correnti e future degli addetti coinvolti, anche se
    # appartengono a commesse diverse da quella che ha generato il ritardo.
    for task in tasks:
        if (
            str(task.id) in origin_task_ids
            or task.type == TaskType.MILESTONE
            or _is_completed(task)
            or not task.start_date
            or (task.end_date or task.start_date) < date.today()
        ):
            continue
        task_workers = [str(worker) for worker in _json(task.workers, []) if worker]
        affected_workers = {
            aliases.get(worker, worker): worker
            for worker in task_workers
            if aliases.get(worker, worker) in worker_shift_days
        }
        if not affected_workers:
            continue
        shift_days = max(worker_shift_days[worker] for worker in affected_workers)
        before_states.setdefault(str(task.id), _task_state(task))
        requested_start = _add_working_days(task.start_date, shift_days)
        shifted_start, shifted_end = _valid_shifted_range(task, requested_start, aliases, vacations)
        task.start_date = shifted_start
        task.end_date = shifted_end
        task.duration = max(1, count_working_days_in_range(shifted_start, shifted_end))
        original_start = _date(before_states[str(task.id)]["start_date"])
        actual_shift_days = _forward_working_day_distance(original_start, shifted_start)
        task_shift_days[str(task.id)] = max(task_shift_days.get(str(task.id), 0), actual_shift_days)
        worker_details = ", ".join(
            f"{label} ({round(worker_missing_hours[canonical], 1)}h)"
            for canonical, label in affected_workers.items()
        )
        reasons_by_task[str(task.id)].append(
            f"posticipata per recuperare la capacità persa dagli addetti: {worker_details}"
        )

    # Propaga il solo delta lungo la catena. Una fase sovrapposta resta
    # sovrapposta: non viene forzata interamente dopo la fase sorgente.
    impacted_task_ids = set(before_states)
    max_dependency_passes = max(1, len(tasks) * 2)
    for dependency_pass in range(max_dependency_passes):
        changed = False
        for link in links:
            source = tasks_by_id.get(str(link.source))
            target = tasks_by_id.get(str(link.target))
            if (
                not source
                or not target
                or str(source.id) not in impacted_task_ids
                or target.type == TaskType.MILESTONE and not target.start_date
            ):
                continue
            source_shift_days = task_shift_days.get(str(source.id), 0)
            target_shift_days = task_shift_days.get(str(target.id), 0)
            additional_shift = source_shift_days - target_shift_days
            if additional_shift <= 0 or not target.start_date:
                continue
            before_states.setdefault(str(target.id), _task_state(target))
            if target.type == TaskType.MILESTONE:
                shifted_start = _add_working_days(target.start_date, additional_shift)
                target.start_date = shifted_start
                target.end_date = shifted_start
                target.duration = 0
            else:
                requested_start = _add_working_days(target.start_date, additional_shift)
                shifted_start, shifted_end = _valid_shifted_range(target, requested_start, aliases, vacations)
                target.start_date = shifted_start
                target.end_date = shifted_end
                target.duration = max(1, count_working_days_in_range(shifted_start, shifted_end))
            task_shift_days[str(target.id)] = source_shift_days
            reasons_by_task[str(target.id)].append(
                f"posticipata di {source_shift_days} "
                f"{'giorno lavorativo' if source_shift_days == 1 else 'giorni lavorativi'} "
                f"per la dipendenza dalla fase '{source.text}'"
            )
            impacted_task_ids.add(str(target.id))
            changed = True
        if not changed:
            break
        if dependency_pass == max_dependency_passes - 1:
            raise HTTPException(
                status_code=409,
                detail="Impossibile propagare le date: verificare che le dipendenze non contengano un ciclo",
            )

    changed_tasks = [
        task for task in tasks
        if str(task.id) in before_states and _task_state(task) != before_states[str(task.id)]
    ]
    if not changed_tasks:
        raise HTTPException(status_code=400, detail="L'analisi non richiede modifiche alle date")

    project_before_ends = {
        project_key: item.end_date.isoformat() if item.end_date else None
        for project_key, item in eligible_projects.items()
    }
    changed_by_project: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for task in changed_tasks:
        changed_by_project[str(task.project_id)].append({
            "task_id": str(task.id),
            "task_name": task.text,
            "before": before_states[str(task.id)],
            "after": _task_state(task),
            "reason": "; ".join(dict.fromkeys(reasons_by_task[str(task.id)])),
        })

    for affected_project_id in changed_by_project:
        affected_project = eligible_projects[affected_project_id]
        project_tasks = [task for task in tasks if str(task.project_id) == affected_project_id and task.start_date]
        latest_project_end = max(
            (task.end_date or task.start_date for task in project_tasks),
            default=affected_project.end_date,
        )
        if latest_project_end and (not affected_project.end_date or latest_project_end > affected_project.end_date):
            affected_project.end_date = latest_project_end

    trigger_summary = " | ".join(dict.fromkeys(scenario["reason"] for scenario in actionable))
    recovered_hours = round(sum(float(scenario["missing_hours"]) for scenario in actionable), 1)
    affected_project_count = len(changed_by_project)
    solution_summary = (
        f"Ripianificate {recovered_hours}h sugli stessi addetti; "
        f"aggiornate {len(changed_tasks)} fasi su {affected_project_count} "
        f"{'commessa' if affected_project_count == 1 else 'commesse'}, incluse quelle dipendenti."
    )
    if dry_run:
        preview_projects = []
        preview_changes = []
        for affected_project_id, changes in changed_by_project.items():
            affected_project = eligible_projects[affected_project_id]
            enriched_changes = [
                {
                    **change,
                    "project_id": affected_project_id,
                    "project_name": affected_project.name,
                    "project_code": affected_project.code,
                }
                for change in changes
            ]
            preview_changes.extend(enriched_changes)
            preview_projects.append({
                "project_id": affected_project_id,
                "project_name": affected_project.name,
                "project_code": affected_project.code,
                "before_end": project_before_ends[affected_project_id],
                "after_end": affected_project.end_date.isoformat() if affected_project.end_date else None,
                "changes": enriched_changes,
            })
        preview = {
            "has_changes": True,
            "trigger_summary": trigger_summary,
            "solution_summary": solution_summary,
            "recovered_hours": recovered_hours,
            "affected_project_count": affected_project_count,
            "scenarios": actionable,
            "allocations": allocations,
            "changes": preview_changes,
            "projects": preview_projects,
        }
        # La simulazione usa le stesse mutazioni del motore reale, poi le
        # annulla integralmente prima di restituire l'anteprima.
        await db.rollback()
        return preview

    batch_id = str(uuid.uuid4())
    runs: dict[str, PlanningRun] = {}
    for affected_project_id, changes in changed_by_project.items():
        affected_project = eligible_projects[affected_project_id]
        snapshot = {
            "project": {
                "before_end": project_before_ends[affected_project_id],
                "after_end": affected_project.end_date.isoformat() if affected_project.end_date else None,
            },
            "tasks": changes,
        }
        project_allocations = [
            allocation for allocation in allocations
            if str(tasks_by_id[allocation["task_id"]].project_id) == affected_project_id
        ]
        run = PlanningRun(
            batch_id=batch_id,
            project_id=affected_project_id,
            created_by_id=actor.id if actor else None,
            status="applied",
            trigger_summary=trigger_summary,
            solution_summary=solution_summary,
            snapshot_json=json.dumps(snapshot, ensure_ascii=False),
            allocations_json=json.dumps(project_allocations, ensure_ascii=False),
        )
        runs[affected_project_id] = run
        db.add(run)
        db.add(ActivityLog(
            project_id=affected_project_id,
            user_id=actor.id if actor else None,
            category=ActivityCategory.PHASE_PROJECT_EDIT,
            action_text=f"[Agente pianificazione] {trigger_summary}. {solution_summary}",
        ))

    affected_usernames = {aliases.get(worker, worker) for scenario in actionable for worker in scenario["workers"]}
    for affected_project_id in changed_by_project:
        affected_project = eligible_projects[affected_project_id]
        notification_ids = {str(affected_project.owner_id), str(affected_project.responsible_id or "")}
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
                title="Pianificazione multi-commessa aggiornata",
                message=f"{affected_project.name}: {trigger_summary}. {solution_summary}",
                type=NotificationType.UPDATE,
                project_id=affected_project_id,
            ))

    await db.commit()
    primary_run = runs.get(str(project_id)) or next(iter(runs.values()))
    result = await db.execute(
        select(PlanningRun)
        .where(PlanningRun.id == primary_run.id)
        .options(selectinload(PlanningRun.created_by), selectinload(PlanningRun.undone_by))
    )
    saved_run = result.scalar_one()
    for affected_project_id, run in runs.items():
        await manager.broadcast(
            affected_project_id,
            {"action": "auto_reschedule_applied", "run_id": str(run.id), "batch_id": batch_id},
        )
    return _serialize_run(saved_run)


async def preview_rescheduling(db: AsyncSession, project_id: str) -> dict[str, Any]:
    """Simula il batch globale corrente senza persistere date, log o notifiche."""
    scenarios = await analyze_all_projects(db, include_paused_project_id=project_id)
    actionable = [scenario for scenario in scenarios if scenario["actionable"]]
    if not actionable:
        return {
            "has_changes": False,
            "trigger_summary": "",
            "solution_summary": "Nessuna modifica necessaria nello scenario attuale.",
            "recovered_hours": 0,
            "affected_project_count": 0,
            "scenarios": [],
            "allocations": [],
            "changes": [],
            "projects": [],
            "error": None,
        }
    try:
        preview = await apply_rescheduling(
            db,
            project_id,
            None,
            allow_when_paused=True,
            precomputed_scenarios=actionable,
            dry_run=True,
        )
        preview["error"] = None
        return preview
    except HTTPException as exc:
        await db.rollback()
        return {
            "has_changes": False,
            "trigger_summary": " | ".join(dict.fromkeys(item["reason"] for item in actionable)),
            "solution_summary": "Impossibile generare una proposta applicabile.",
            "recovered_hours": round(sum(float(item["missing_hours"]) for item in actionable), 1),
            "affected_project_count": 0,
            "scenarios": actionable,
            "allocations": [],
            "changes": [],
            "projects": [],
            "error": str(exc.detail),
        }


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

    if run.batch_id:
        batch_result = await db.execute(
            select(PlanningRun)
            .where(PlanningRun.batch_id == run.batch_id, PlanningRun.status == "applied")
            .options(selectinload(PlanningRun.created_by), selectinload(PlanningRun.undone_by))
        )
        batch_runs = list(batch_result.scalars().all())
    else:
        batch_runs = [run]

    snapshots_by_run = {str(item.id): _json(item.snapshot_json, {}) for item in batch_runs}
    task_snapshots = [
        task_snapshot
        for item in batch_runs
        for task_snapshot in snapshots_by_run[str(item.id)].get("tasks", [])
    ]
    task_ids = [item["task_id"] for item in task_snapshots]
    task_result = await db.execute(
        select(Task).where(Task.id.in_(task_ids)).execution_options(populate_existing=True)
    )
    tasks = {str(task.id): task for task in task_result.scalars().all()}
    conflicts = [
        item["task_name"] for item in task_snapshots
        if item["task_id"] not in tasks or not _state_matches(tasks[item["task_id"]], item["after"])
    ]
    affected_project_ids = [str(item.project_id) for item in batch_runs]
    project_result = await db.execute(
        select(Project)
        .where(Project.id.in_(affected_project_ids))
        .execution_options(populate_existing=True)
    )
    projects = {str(item.id): item for item in project_result.scalars().all()}
    for batch_run in batch_runs:
        snapshot = snapshots_by_run[str(batch_run.id)]
        batch_project = projects.get(str(batch_run.project_id))
        expected_project_end = snapshot.get("project", {}).get("after_end")
        current_project_end = batch_project.end_date.isoformat() if batch_project and batch_project.end_date else None
        if expected_project_end != current_project_end:
            conflicts.append(f"data finale della commessa {batch_project.name if batch_project else batch_run.project_id}")
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
    undone_at = datetime.now(timezone.utc)
    for batch_run in batch_runs:
        snapshot = snapshots_by_run[str(batch_run.id)]
        batch_project = projects.get(str(batch_run.project_id))
        if batch_project:
            batch_project.end_date = _date(snapshot.get("project", {}).get("before_end"))
        batch_run.status = "undone"
        batch_run.undone_by_id = actor.id
        batch_run.undone_at = undone_at
        db.add(ActivityLog(
            project_id=batch_run.project_id,
            user_id=actor.id,
            category=ActivityCategory.PHASE_PROJECT_EDIT,
            action_text=f"[Agente pianificazione] Annullata ripianificazione multi-commessa: {batch_run.solution_summary}",
        ))
        db.add(Notification(
            user_id=actor.id,
            title="Ripianificazione multi-commessa annullata",
            message=(
                f"Ripristinate {len(task_snapshots)} fasi su {len(batch_runs)} "
                f"{'commessa' if len(batch_runs) == 1 else 'commesse'}."
            ),
            type=NotificationType.UPDATE,
            project_id=batch_run.project_id,
        ))
    await db.commit()
    result = await db.execute(
        select(PlanningRun)
        .where(PlanningRun.id == run.id)
        .options(selectinload(PlanningRun.created_by), selectinload(PlanningRun.undone_by))
    )
    run = result.scalar_one()
    for batch_run in batch_runs:
        await manager.broadcast(
            str(batch_run.project_id),
            {"action": "auto_reschedule_undone", "run_id": str(batch_run.id), "batch_id": run.batch_id},
        )
    return _serialize_run(run)


async def run_daily_rescheduling(session_factory=None) -> None:
    """Esegue un unico batch globale sulle commesse operative non in pausa."""
    if session_factory is None:
        from app.models.base import AsyncSessionLocal
        session_factory = AsyncSessionLocal

    async with session_factory() as db:
        try:
            scenarios = await analyze_all_projects(db)
            actionable = [scenario for scenario in scenarios if scenario["actionable"]]
            if not actionable:
                return
            trigger_project_id = actionable[0]["project_id"]
            result = await apply_rescheduling(
                db,
                trigger_project_id,
                None,
                precomputed_scenarios=actionable,
            )
            logger.info(
                "[PLANNING AGENT] Batch globale %s applicato a %s scenari",
                result.get("batch_id"),
                len(actionable),
            )
        except HTTPException as exc:
            await db.rollback()
            logger.warning("[PLANNING AGENT] Batch globale non applicato: %s", exc.detail)
        except Exception:
            await db.rollback()
            logger.exception("[PLANNING AGENT] Errore durante la ripianificazione globale")
