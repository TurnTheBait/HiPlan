"""
Rescheduling Agent – Logica di ripianificazione automatica delle fasi.

Analizza costantemente:
1. Conflitti di sovrapposizione tra fasi dello stesso addetto (cross-commessa)
2. Conflitti con ferie degli addetti
3. Fasi in ritardo senza attività consuntivata

Propaga a cascata i ritardi alle fasi dipendenti (link FS).
"""
import json
import logging
from datetime import date, timedelta
from typing import Optional
from collections import defaultdict, deque

# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select, update
from app.models.task import Task, TaskType
from app.models.link import Link, LinkType
from app.models.project import Project
from app.models.vacation import Vacation
from app.models.agent_log import AgentLog, AgentActionType
from app.models.setting import Setting
from app.models.user import User
from app.models.notification import Notification, NotificationType
from app.models.base import AsyncSessionLocal

logger = logging.getLogger("rescheduling_agent")


# ---------------------------------------------------------------------------
# Helpers per i giorni lavorativi
# ---------------------------------------------------------------------------

def is_working_day(d: date) -> bool:
    """Restituisce True se il giorno è lun-ven."""
    return d.weekday() < 5  # 0=lun, 4=ven, 5=sab, 6=dom


def next_working_day(d: date) -> date:
    """Restituisce il primo giorno lavorativo >= d."""
    while not is_working_day(d):
        d += timedelta(days=1)
    return d


def add_working_days(d: date, n: int) -> date:
    """Aggiunge n giorni lavorativi a d."""
    if n <= 0:
        return d
    count = 0
    current = d
    while count < n:
        current += timedelta(days=1)
        if is_working_day(current):
            count += 1
    return current


def working_days_between(start: date, end: date) -> int:
    """Conta i giorni lavorativi tra start (escluso) e end (incluso)."""
    if end <= start:
        return 0
    count = 0
    current = start + timedelta(days=1)
    while current <= end:
        if is_working_day(current):
            count += 1
        current += timedelta(days=1)
    return count


def calendar_delta_from_working(start: date, working_days: int) -> int:
    """Calcola i giorni di calendario per coprire N giorni lavorativi a partire da start."""
    end = start
    added = 0
    while added < working_days:
        end += timedelta(days=1)
        if is_working_day(end):
            added += 1
    return (end - start).days


# ---------------------------------------------------------------------------
# Helpers per parsing JSON
# ---------------------------------------------------------------------------

def _parse_list(val) -> list:
    if not val:
        return []
    if isinstance(val, list):
        return val
    try:
        result = json.loads(val)
        return result if isinstance(result, list) else []
    except Exception:
        return []


def _parse_dict(val) -> dict:
    if not val:
        return {}
    if isinstance(val, dict):
        return val
    try:
        result = json.loads(val)
        return result if isinstance(result, dict) else {}
    except Exception:
        return {}


def _total_actual_hours(task: Task) -> float:
    """Somma tutte le ore consuntivate in actual_hours."""
    actual = _parse_dict(task.actual_hours)
    total = 0.0
    if isinstance(actual, dict):
        for day_map in actual.values():
            if isinstance(day_map, dict):
                for h in day_map.values():
                    try:
                        total += float(h or 0)
                    except (ValueError, TypeError):
                        pass
    return total


# ---------------------------------------------------------------------------
# Controllo stato agente (enabled/disabled)
# ---------------------------------------------------------------------------

async def is_agent_enabled(session: AsyncSession) -> bool:
    """Legge la setting 'agent_enabled' dal DB."""
    res = await session.execute(
        select(Setting).where(Setting.key == "agent_enabled")
    )
    setting = res.scalar_one_or_none()
    if not setting:
        return True  # default: abilitato
    return setting.value == "true"


async def set_agent_enabled(session: AsyncSession, enabled: bool) -> None:
    res = await session.execute(
        select(Setting).where(Setting.key == "agent_enabled")
    )
    setting = res.scalar_one_or_none()
    if setting:
        setting.value = "true" if enabled else "false"
    else:
        session.add(Setting(key="agent_enabled", value="true" if enabled else "false"))
    
    # Aggiorna anche last_run_at
    res2 = await session.execute(
        select(Setting).where(Setting.key == "agent_last_toggled")
    )
    s2 = res2.scalar_one_or_none()
    from datetime import datetime, timezone
    now_str = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    if s2:
        s2.value = now_str
    else:
        session.add(Setting(key="agent_last_toggled", value=now_str))
    await session.commit()


async def get_agent_status(session: AsyncSession) -> dict:
    """Restituisce lo stato dell'agente."""
    keys_needed = ["agent_enabled", "agent_last_run", "agent_last_toggled"]
    res = await session.execute(
        select(Setting).where(Setting.key.in_(keys_needed))
    )
    settings_map = {s.key: s.value for s in res.scalars().all()}
    return {
        "enabled": settings_map.get("agent_enabled", "true") == "true",
        "last_run": settings_map.get("agent_last_run"),
        "last_toggled": settings_map.get("agent_last_toggled"),
    }


async def _update_last_run(session: AsyncSession) -> None:
    from datetime import datetime, timezone
    now_str = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    res = await session.execute(
        select(Setting).where(Setting.key == "agent_last_run")
    )
    s = res.scalar_one_or_none()
    if s:
        s.value = now_str
    else:
        session.add(Setting(key="agent_last_run", value=now_str))
    await session.commit()


# ---------------------------------------------------------------------------
# Funzione principale dell'agente
# ---------------------------------------------------------------------------

async def run_rescheduling_agent(dry_run: bool = False) -> dict:
    """
    Entry point per l'agente. Viene chiamato dallo scheduler APScheduler o dall'API.
    Se dry_run=True, esegue l'analisi ma effettua rollback alla fine (nessuna modifica salvata).
    Ritorna un dict con statistiche sull'esecuzione.
    """
    stats = {
        "phases_rescheduled": 0,
        "cascade_rescheduled": 0,
        "conflicts_detected": 0,
        "vacation_conflicts": 0,
        "lag_detected": 0,
        "overbooking_resolved": 0,
        "errors": [],
    }

    async with AsyncSessionLocal() as session:
        try:
            # Controlla se l'agente è abilitato
            if not await is_agent_enabled(session):
                logger.info("[Agent] Agente disabilitato, skip.")
                return stats

            logger.info("[Agent] Avvio ciclo di ripianificazione...")

            # Carica tutti i dati necessari
            tasks_res = await session.execute(
                select(Task).where(Task.type != TaskType.PROJECT)
            )
            all_tasks: list[Task] = list(tasks_res.scalars().all())

            links_res = await session.execute(select(Link))
            all_links: list[Link] = list(links_res.scalars().all())

            vacations_res = await session.execute(select(Vacation))
            all_vacations: list[Vacation] = list(vacations_res.scalars().all())

            projects_res = await session.execute(select(Project))
            all_projects: list[Project] = list(projects_res.scalars().all())

            users_res = await session.execute(select(User))
            all_users: list[User] = list(users_res.scalars().all())

            # Mappe di supporto
            task_map: dict[str, Task] = {t.id: t for t in all_tasks}
            project_map: dict[str, Project] = {p.id: p for p in all_projects}
            user_map_by_name: dict[str, User] = {}
            for u in all_users:
                if u.full_name:
                    user_map_by_name[u.full_name.strip().lower()] = u
                user_map_by_name[u.username.strip().lower()] = u

            # Mappa ferie per addetto (username/full_name → lista vacanze)
            vacations_by_worker: dict[str, list[Vacation]] = defaultdict(list)
            for v in all_vacations:
                user = next((u for u in all_users if u.id == v.user_id), None)
                if user:
                    if user.full_name:
                        vacations_by_worker[user.full_name.strip().lower()].append(v)
                    vacations_by_worker[user.username.strip().lower()].append(v)

            # Grafo delle dipendenze: source_id → [target_id, ...]
            deps: dict[str, list[str]] = defaultdict(list)
            for link in all_links:
                if link.type == LinkType.FS:
                    deps[link.source].append(link.target)

            # Set di task già spostati in questo ciclo (evita loop)
            already_shifted: set[str] = set()

            today = date.today()

            # ---------------------------------------------------------------
            # 1. Rilevamento fasi in ritardo senza ore consuntivate
            # ---------------------------------------------------------------
            for task in all_tasks:
                if task.completed == 1:
                    continue
                if not task.start_date:
                    continue
                if task.start_date >= today:
                    continue
                # Fase iniziata nel passato
                if task.progress is not None and task.progress >= 1.0:
                    continue

                actual_hours = _total_actual_hours(task)
                planned_hours = float(task.planned_hours or 8.0)

                # Se non ha ore consuntivate e non è completata → spostala
                if actual_hours == 0 and (task.progress or 0.0) == 0.0:
                    days_late = (today - task.start_date).days
                    if days_late <= 0:
                        continue

                    workers = _parse_list(task.workers)
                    worker_str = ", ".join(workers) if workers else None

                    old_start = task.start_date
                    old_end = task.end_date
                    old_dur = task.duration

                    # Sposta a partire da oggi (primo giorno lavorativo)
                    new_start = next_working_day(today)
                    new_end = add_working_days(new_start, max(0, (task.duration or 1) - 1)) if task.duration else new_start

                    task.start_date = new_start
                    task.end_date = new_end
                    already_shifted.add(task.id)

                    project = project_map.get(task.project_id)
                    project_name = project.name if project else "N/A"
                    project_code = project.code if project else None

                    log = AgentLog(
                        action_type=AgentActionType.LAG_DETECTED.value,
                        task_id=task.id,
                        task_name=task.text,
                        project_id=task.project_id,
                        project_name=project_name,
                        project_code=project_code,
                        worker=worker_str,
                        old_start_date=old_start,
                        old_end_date=old_end,
                        old_duration=old_dur,
                        new_start_date=new_start,
                        new_end_date=new_end,
                        new_duration=task.duration,
                        reason=f"Fase in ritardo di {days_late} giorni senza ore consuntivate. Spostata a partire da oggi.",
                    )
                    session.add(log)
                    stats["lag_detected"] += 1
                    stats["phases_rescheduled"] += 1

                    # Notifica agli addetti
                    if not dry_run:
                        await _notify_workers(session, task, workers, user_map_by_name,
                                              f"📅 La fase '{task.text}' è stata ripianificata al {new_start.strftime('%d/%m/%Y')} dall'agente (era in ritardo).")

                    # Propaga a cascata
                    cascade = await _cascade_shift(
                        task_id=task.id,
                        delta_days=(new_start - old_start).days,
                        deps=deps,
                        task_map=task_map,
                        project_map=project_map,
                        session=session,
                        already_shifted=already_shifted,
                        user_map_by_name=user_map_by_name,
                        stats=stats,
                        dry_run=dry_run,
                    )
                    stats["cascade_rescheduled"] += cascade

            await session.flush()

            # ---------------------------------------------------------------
            # 2. Rilevamento conflitti ferie
            # ---------------------------------------------------------------
            for task in all_tasks:
                if task.completed == 1:
                    continue
                if not task.start_date or not task.end_date:
                    continue

                workers = _parse_list(task.workers)
                for worker in workers:
                    worker_key = worker.strip().lower()
                    vacations = vacations_by_worker.get(worker_key, [])
                    if not vacations:
                        continue

                    # Controlla se le ferie bloccano la fase
                    conflict_end = _find_vacation_end(task.start_date, task.end_date, vacations)
                    if conflict_end is None:
                        continue

                    # La fase deve iniziare dopo la fine delle ferie
                    new_start = next_working_day(conflict_end + timedelta(days=1))
                    if new_start <= task.start_date:
                        continue

                    if task.id in already_shifted:
                        # Già spostata, confronta e prendi il più tardi
                        if new_start <= task.start_date:
                            continue

                    old_start = task.start_date
                    old_end = task.end_date
                    old_dur = task.duration

                    duration = task.duration or 1
                    new_end = add_working_days(new_start, max(0, duration - 1))

                    task.start_date = new_start
                    task.end_date = new_end
                    already_shifted.add(task.id)

                    project = project_map.get(task.project_id)
                    project_name = project.name if project else "N/A"
                    project_code = project.code if project else None

                    log = AgentLog(
                        action_type=AgentActionType.VACATION_CONFLICT.value,
                        task_id=task.id,
                        task_name=task.text,
                        project_id=task.project_id,
                        project_name=project_name,
                        project_code=project_code,
                        worker=worker,
                        old_start_date=old_start,
                        old_end_date=old_end,
                        old_duration=old_dur,
                        new_start_date=new_start,
                        new_end_date=new_end,
                        new_duration=task.duration,
                        reason=f"Conflitto con ferie di {worker}. Fase spostata al {new_start.strftime('%d/%m/%Y')}.",
                    )
                    session.add(log)
                    stats["vacation_conflicts"] += 1
                    stats["phases_rescheduled"] += 1

                    if not dry_run:
                        await _notify_workers(session, task, [worker], user_map_by_name,
                                              f"🏖️ La fase '{task.text}' è stata spostata al {new_start.strftime('%d/%m/%Y')} per conflitto con le tue ferie.")

                    delta = (new_start - old_start).days
                    cascade = await _cascade_shift(
                        task_id=task.id,
                        delta_days=delta,
                        deps=deps,
                        task_map=task_map,
                        project_map=project_map,
                        session=session,
                        already_shifted=already_shifted,
                        user_map_by_name=user_map_by_name,
                        stats=stats,
                        dry_run=dry_run,
                    )
                    stats["cascade_rescheduled"] += cascade

            await session.flush()

            # ---------------------------------------------------------------
            # 3. Rilevamento conflitti di sovrapposizione (Overbooking > 8h)
            # ---------------------------------------------------------------
            for _ in range(5):  # Max 5 passate per risolvere overbooking a cascata
                overbooking_resolved_in_pass = False
                daily_hours = defaultdict(lambda: defaultdict(list))

                # Calcolo ore giornaliere per addetto
                for task in all_tasks:
                    if task.completed == 1:
                        continue
                    if not task.start_date or not task.end_date:
                        continue

                    duration = max(1, task.duration or 1)
                    workers = _parse_list(task.workers)
                    if not workers:
                        continue

                    planned_hours = float(task.planned_hours or 8.0)
                    hours_per_worker_per_day = (planned_hours / len(workers)) / duration

                    current_date = task.start_date
                    days_counted = 0
                    while days_counted < duration and current_date <= task.end_date:
                        if is_working_day(current_date):
                            for worker in workers:
                                worker_key = worker.strip().lower()
                                daily_hours[worker_key][current_date].append({
                                    "task": task,
                                    "hours": hours_per_worker_per_day
                                })
                            days_counted += 1
                        current_date += timedelta(days=1)

                # Individua giorni con overbooking e risolvi
                for worker_key, dates_map in daily_hours.items():
                    for d in sorted(dates_map.keys()):
                        tasks_on_day = dates_map[d]
                        total_hours = sum(t["hours"] for t in tasks_on_day)

                        if total_hours > 8.01:
                            # Overbooking! Spostiamo la task che inizia più tardi
                            tasks_on_day.sort(key=lambda t: (t["task"].start_date or date.min, t["task"].sort_order or 0), reverse=True)
                            task_to_shift = tasks_on_day[0]["task"]

                            old_start = task_to_shift.start_date
                            old_end = task_to_shift.end_date
                            old_dur = task_to_shift.duration

                            new_start = next_working_day(old_start + timedelta(days=1))
                            duration = task_to_shift.duration or 1
                            new_end = add_working_days(new_start, max(0, duration - 1))

                            task_to_shift.start_date = new_start
                            task_to_shift.end_date = new_end
                            already_shifted.add(task_to_shift.id)

                            project = project_map.get(task_to_shift.project_id)
                            project_name = project.name if project else "N/A"
                            project_code = project.code if project else None

                            worker_display = next((w for w in _parse_list(task_to_shift.workers) if w.strip().lower() == worker_key), worker_key)

                            log = AgentLog(
                                action_type=AgentActionType.OVERBOOKING_RESOLVED.value,
                                task_id=task_to_shift.id,
                                task_name=task_to_shift.text,
                                project_id=task_to_shift.project_id,
                                project_name=project_name,
                                project_code=project_code,
                                worker=worker_display,
                                old_start_date=old_start,
                                old_end_date=old_end,
                                old_duration=old_dur,
                                new_start_date=new_start,
                                new_end_date=new_end,
                                new_duration=task_to_shift.duration,
                                reason=(
                                    f"Sovraccarico di lavoro ({total_hours:.1f}h previste) per {worker_display} in data {d.strftime('%d/%m/%Y')}. "
                                    f"Fase spostata al {new_start.strftime('%d/%m/%Y')}."
                                ),
                            )
                            session.add(log)
                            stats["overbooking_resolved"] += 1
                            stats["conflicts_detected"] += 1
                            stats["phases_rescheduled"] += 1

                            if not dry_run:
                                await _notify_workers(
                                    session, task_to_shift, _parse_list(task_to_shift.workers),
                                    user_map_by_name,
                                    f"⚠️ La fase '{task_to_shift.text}' è stata riprogrammata al {new_start.strftime('%d/%m/%Y')} per evitare un sovraccarico di ore."
                                )

                            delta = (new_start - old_start).days
                            cascade = await _cascade_shift(
                                task_id=task_to_shift.id,
                                delta_days=delta,
                                deps=deps,
                                task_map=task_map,
                                project_map=project_map,
                                session=session,
                                already_shifted=already_shifted,
                                user_map_by_name=user_map_by_name,
                                stats=stats,
                                dry_run=dry_run,
                            )
                            stats["cascade_rescheduled"] += cascade
                            overbooking_resolved_in_pass = True
                            break
                    if overbooking_resolved_in_pass:
                        break

                if not overbooking_resolved_in_pass:
                    break

            await session.flush()
            if dry_run:
                await session.rollback()
                logger.info("[Agent] Dry-run completato (rollback effettuato).")
            else:
                await session.commit()
                await _update_last_run(session)

            logger.info(
                f"[Agent] Ciclo completato: "
                f"{stats['phases_rescheduled']} fasi spostate, "
                f"{stats['cascade_rescheduled']} propagazioni a cascata, "
                f"{stats['vacation_conflicts']} conflitti ferie, "
                f"{stats['lag_detected']} ritardi rilevati."
            )

        except Exception as e:
            logger.exception(f"[Agent] Errore durante l'esecuzione: {e}")
            stats["errors"].append(str(e))
            try:
                await session.rollback()
            except Exception:
                pass

    return stats


# ---------------------------------------------------------------------------
# Propagazione a cascata
# ---------------------------------------------------------------------------

async def _cascade_shift(
    task_id: str,
    delta_days: int,
    deps: dict,
    task_map: dict,
    project_map: dict,
    session: AsyncSession,
    already_shifted: set,
    user_map_by_name: dict,
    stats: dict,
    dry_run: bool = False,
) -> int:
    """
    Propaga lo spostamento di delta_days a tutte le fasi dipendenti (BFS).
    Ritorna il numero di fasi spostate a cascata.
    """
    if delta_days <= 0:
        return 0

    cascade_count = 0
    queue = deque([(task_id, delta_days)])

    while queue:
        current_id, shift = queue.popleft()
        dependent_ids = deps.get(current_id, [])

        for dep_id in dependent_ids:
            if dep_id in already_shifted:
                continue
            dep_task = task_map.get(dep_id)
            if not dep_task:
                continue
            if dep_task.completed == 1:
                continue
            if not dep_task.start_date:
                continue

            old_start = dep_task.start_date
            old_end = dep_task.end_date
            old_dur = dep_task.duration

            # Sposta esattamente dello stesso delta in giorni di calendario
            new_start = old_start + timedelta(days=shift)
            # Assicura che sia un giorno lavorativo
            new_start = next_working_day(new_start)
            actual_shift = (new_start - old_start).days

            if actual_shift <= 0:
                continue

            new_end = (old_end + timedelta(days=actual_shift)) if old_end else None

            dep_task.start_date = new_start
            dep_task.end_date = new_end
            already_shifted.add(dep_id)

            project = project_map.get(dep_task.project_id)
            project_name = project.name if project else "N/A"
            project_code = project.code if project else None

            workers = _parse_list(dep_task.workers)
            worker_str = ", ".join(workers) if workers else None

            log = AgentLog(
                action_type=AgentActionType.CASCADE_RESCHEDULED.value,
                task_id=dep_task.id,
                task_name=dep_task.text,
                project_id=dep_task.project_id,
                project_name=project_name,
                project_code=project_code,
                worker=worker_str,
                old_start_date=old_start,
                old_end_date=old_end,
                old_duration=old_dur,
                new_start_date=new_start,
                new_end_date=new_end,
                new_duration=dep_task.duration,
                reason=(
                    f"Spostamento a cascata di +{actual_shift} giorni "
                    f"dalla fase predecessore (ID: {current_id})."
                ),
            )
            session.add(log)
            cascade_count += 1

            if not dry_run:
                await _notify_workers(session, dep_task, workers, user_map_by_name,
                                      f"🔗 La fase '{dep_task.text}' è stata spostata a cascata al {new_start.strftime('%d/%m/%Y')}.")

            # Continua la propagazione dal nodo appena spostato
            queue.append((dep_id, actual_shift))

    return cascade_count


# ---------------------------------------------------------------------------
# Rilevamento conflitti con ferie
# ---------------------------------------------------------------------------

def _find_vacation_end(task_start: date, task_end: date, vacations: list[Vacation]) -> Optional[date]:
    """
    Restituisce la data di fine del periodo di ferie che si sovrappone
    alla fase, oppure None se non ci sono conflitti.
    Prende la fine più tarda in caso di ferie multiple consecutive.
    """
    latest_end: Optional[date] = None
    for v in vacations:
        v_start = v.start_date
        v_end = v.end_date
        # Sovrapposizione: le ferie si sovrappongono alla fase
        if v_start <= task_end and v_end >= task_start:
            if latest_end is None or v_end > latest_end:
                latest_end = v_end
    return latest_end


# ---------------------------------------------------------------------------
# Notifiche agli addetti
# ---------------------------------------------------------------------------

async def _notify_workers(
    session: AsyncSession,
    task: Task,
    workers: list[str],
    user_map_by_name: dict,
    message: str,
) -> None:
    """Invia una notifica in-app a tutti gli addetti della fase."""
    notified_ids: set[str] = set()
    for w in workers:
        user = user_map_by_name.get(w.strip().lower())
        if user and user.id not in notified_ids:
            notif = Notification(
                user_id=user.id,
                title="🤖 Agente Ripianificazione",
                message=message,
                type=NotificationType.DEADLINE,
                project_id=task.project_id,
                task_id=task.id,
            )
            session.add(notif)
            notified_ids.add(user.id)


# ---------------------------------------------------------------------------
# Revoca di un'azione
# ---------------------------------------------------------------------------

async def revert_agent_log(log_id: str, admin_username: str) -> dict:
    """
    Revoca l'azione loggata ripristinando le date originali della fase.
    Ritorna un dict con l'esito.
    """
    from datetime import datetime

    async with AsyncSessionLocal() as session:
        # Carica il log
        log_res = await session.execute(
            select(AgentLog).where(AgentLog.id == log_id)
        )
        log: Optional[AgentLog] = log_res.scalar_one_or_none()
        if not log:
            return {"ok": False, "error": "Log non trovato"}
        if log.reverted:
            return {"ok": False, "error": "Azione già revocata"}

        # Ripristina le date della fase
        if log.task_id:
            task_res = await session.execute(
                select(Task).where(Task.id == log.task_id)
            )
            task: Optional[Task] = task_res.scalar_one_or_none()
            if task:
                task.start_date = log.old_start_date
                task.end_date = log.old_end_date
                if log.old_duration is not None:
                    task.duration = log.old_duration

        # Aggiorna il log
        log.reverted = 1
        from datetime import datetime, timezone
        log.reverted_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        log.reverted_by = admin_username

        await session.commit()
        return {"ok": True}
