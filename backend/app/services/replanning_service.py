import json
from datetime import date, timedelta, datetime, timezone
import logging
import math
from uuid import uuid4
from typing import Any, Dict, List
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select, or_
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import selectinload

from app.models.task import Task, TaskType
from app.models.link import Link, LinkType
from app.models.vacation import Vacation
from app.models.user import User
from app.models.setting import Setting
from app.models.replan_log import ReplanLog, ReplanActionType
from app.core.websocket_manager import manager

logger = logging.getLogger(__name__)

async def check_replanning_enabled(db: AsyncSession) -> bool:
    res = await db.execute(select(Setting).where(Setting.key == "replanning_agent_enabled"))
    setting = res.scalar_one_or_none()
    return setting is not None and setting.value == "true"


def is_weekend_or_holiday(d: date) -> bool:
    return d.weekday() >= 5


def add_working_days(start: date, days: int) -> date:
    cur = start
    while is_weekend_or_holiday(cur):
        cur += timedelta(days=1)
    
    count = 0
    while count < days:
        cur += timedelta(days=1)
        if not is_weekend_or_holiday(cur):
            count += 1
    return cur


def get_working_days_count(start: date, end: date) -> int:
    if not start or not end or start > end:
        return 1
    count = 0
    cur = start
    while cur <= end:
        if not is_weekend_or_holiday(cur):
            count += 1
        cur += timedelta(days=1)
    return max(1, count)


async def get_replanning_suggestions(db: AsyncSession):
    today = date.today()
    suggestions: List[Dict[str, Any]] = []
    
    # 1. Fetch data
    tasks_res = await db.execute(
        select(Task)
        .options(selectinload(Task.project))
        .where(Task.type != TaskType.PROJECT)
        .where(Task.type != TaskType.MILESTONE)
        .where(Task.completed == 0)
    )
    all_tasks = tasks_res.scalars().all()
    
    vacs_res = await db.execute(select(Vacation))
    vacations = vacs_res.scalars().all()
    
    users_res = await db.execute(select(User))
    users = users_res.scalars().all()
    username_to_id = {u.username: str(u.id) for u in users}
    fullname_to_id = {u.full_name: str(u.id) for u in users if u.full_name}
    
    def get_user_id(name: str):
        return fullname_to_id.get(name) or username_to_id.get(name)

    vacation_dates_by_uid = {}
    for v in vacations:
        uid = str(v.user_id)
        if uid not in vacation_dates_by_uid:
            vacation_dates_by_uid[uid] = set()
        cur = v.start_date
        while cur <= v.end_date:
            vacation_dates_by_uid[uid].add(cur)
            cur += timedelta(days=1)

    max_daily_hours = 8.0
    timeline = {}
    
    for task in all_tasks:
        if not task.start_date or not task.end_date:
            continue
            
        # Controllo: fine fase oltre fine commessa
        if task.project and task.project.end_date and task.end_date > task.project.end_date:
            diff = (task.end_date - task.project.end_date).days
            sugg_id = str(uuid4())
            suggestions.append({
                "id": sugg_id,
                "type": "project_end_exceeded",
                "task_id": str(task.id),
                "task_name": task.text,
                "project_id": str(task.project_id),
                "project_name": task.project.name,
                "worker": None,
                "date": str(task.end_date),
                "reason": f"La fase termina il {task.end_date.strftime('%d/%m/%Y')}, superando la scadenza della commessa ({task.project.end_date.strftime('%d/%m/%Y')}).",
                "action_type": ReplanActionType.EXTEND_PROJECT.value,
                "action_payload": {
                    "project_id": str(task.project_id),
                    "new_end_date": str(task.end_date)
                },
                "action_label": f"Estendi commessa al {task.end_date.strftime('%d/%m/%Y')}"
            })

        # Ritardo Critico (Motore Semafori)
        # Parse actual_hours
        try:
            actual_h_map = json.loads(task.actual_hours) if task.actual_hours else {}
        except:
            actual_h_map = {}
            
        tot_eff = 0
        for day_map in actual_h_map.values():
            if isinstance(day_map, dict):
                for h in day_map.values():
                    try:
                        tot_eff += float(h)
                    except:
                        pass
                        
        planned_h = float(task.planned_hours or 8.0)
        
        # 1. Sforamento
        if planned_h > 0 and tot_eff > planned_h:
            sugg_id = str(uuid4())
            suggestions.append({
                "id": sugg_id,
                "type": "delay_conflict",
                "task_id": str(task.id),
                "task_name": task.text,
                "project_id": str(task.project_id),
                "project_name": task.project.name if task.project else "-",
                "worker": None,
                "date": str(task.end_date),
                "reason": f"La fase ha superato le ore previste ({round(tot_eff, 1)}h consuntivate su {planned_h}h previste).",
                "action_type": ReplanActionType.SHIFT_DELAY.value,
                "action_payload": {
                    "task_id": str(task.id),
                    "shift_days": 1,
                    "add_hours": round(tot_eff - planned_h, 1)
                },
                "action_label": f"Estendi '{task.text}' di 1 giorno e adegua ore"
            })
        else:
            # 2. Ritardo Giornaliero
            working_days = get_working_days_count(task.start_date, task.end_date)
            ore_gg = planned_h / working_days
            
            cur_d = task.start_date
            has_critical_delay = False
            first_delayed_date = None
            
            while cur_d <= task.end_date and cur_d <= today:
                if not is_weekend_or_holiday(cur_d):
                    date_str = cur_d.strftime("%Y-%m-%d")
                    tot_day_eff = 0
                    for day_map in actual_h_map.values():
                        if isinstance(day_map, dict) and date_str in day_map:
                            try:
                                tot_day_eff += float(day_map[date_str])
                            except:
                                pass
                                
                    if tot_day_eff < (ore_gg * 0.5) or (tot_day_eff == 0 and ore_gg > 0):
                        has_critical_delay = True
                        first_delayed_date = cur_d
                        break
                cur_d += timedelta(days=1)
                
            if has_critical_delay:
                tot_expected_so_far = 0
                tot_actual_so_far = 0
                c_d = task.start_date
                while c_d <= today and c_d <= task.end_date:
                    if not is_weekend_or_holiday(c_d):
                        tot_expected_so_far += ore_gg
                        date_str = c_d.strftime("%Y-%m-%d")
                        for day_map in actual_h_map.values():
                            if isinstance(day_map, dict) and date_str in day_map:
                                try:
                                    tot_actual_so_far += float(day_map[date_str])
                                except:
                                    pass
                    c_d += timedelta(days=1)
                lost_hours = tot_expected_so_far - tot_actual_so_far
                days_to_add = math.ceil(lost_hours / ore_gg) if (ore_gg > 0 and lost_hours > 0) else 1
                if days_to_add <= 0: days_to_add = 1

                sugg_id = str(uuid4())
                suggestions.append({
                    "id": sugg_id,
                    "type": "delay_conflict",
                    "task_id": str(task.id),
                    "task_name": task.text,
                    "project_id": str(task.project_id),
                    "project_name": task.project.name if task.project else "-",
                    "worker": None,
                    "date": str(first_delayed_date),
                    "reason": f"Ritardo critico: mancano all'appello circa {round(lost_hours, 1)}h rispetto al piano.",
                    "action_type": ReplanActionType.SHIFT_DELAY.value,
                    "action_payload": {
                        "task_id": str(task.id),
                        "shift_days": days_to_add,
                        "add_hours": round(lost_hours, 1)
                    },
                    "action_label": f"Estendi '{task.text}' di {days_to_add} { 'giorno' if days_to_add == 1 else 'giorni' } per recuperare"
                })
            elif task.end_date < today:
                # Fallback: scaduta e non in sforamento / ritardo critico specifico
                days_to_add = get_working_days_count(task.end_date, today)
                if days_to_add <= 0: days_to_add = 1
                sugg_id = str(uuid4())
                suggestions.append({
                    "id": sugg_id,
                    "type": "delay_conflict",
                    "task_id": str(task.id),
                    "task_name": task.text,
                    "project_id": str(task.project_id),
                    "project_name": task.project.name if task.project else "-",
                    "worker": None,
                    "date": str(task.end_date),
                    "reason": f"La fase è scaduta il {task.end_date.strftime('%d/%m/%Y')} ma non risulta completata.",
                    "action_type": ReplanActionType.SHIFT_DELAY.value,
                    "action_payload": {
                        "task_id": str(task.id),
                        "shift_days": days_to_add,
                        "add_hours": 0
                    },
                    "action_label": f"Estendi '{task.text}' di {days_to_add} { 'giorno' if days_to_add == 1 else 'giorni' } fino ad oggi"
                })

        try:
            workers = json.loads(task.workers) if task.workers else []
        except Exception:
            workers = []
            
        if not workers:
            continue
            
        try:
            worker_hours = json.loads(task.worker_hours) if task.worker_hours else {}
        except Exception:
            worker_hours = {}
            
        duration_days = get_working_days_count(task.start_date, task.end_date)
        
        cur = task.start_date
        while cur <= task.end_date:
            if not is_weekend_or_holiday(cur):
                if cur not in timeline:
                    timeline[cur] = {}
                    
                for w in workers:
                    if w not in timeline[cur]:
                        timeline[cur][w] = []
                        
                    if w in worker_hours and worker_hours[w] is not None:
                        try:
                            total_h = float(worker_hours[w])
                        except Exception:
                            total_h = float(task.planned_hours or 0) / len(workers)
                    else:
                        total_h = float(task.planned_hours or 0) / len(workers)
                        
                    daily_h = total_h / duration_days
                    
                    timeline[cur][w].append((task, daily_h))
            cur += timedelta(days=1)

    # Controlla conflitti operativi
    sorted_dates = sorted([d for d in timeline.keys() if d >= today])
    for d in sorted_dates:
        for w, w_tasks in timeline[d].items():
            w_id = get_user_id(w)
            
            # Ferie
            if w_id and w_id in vacation_dates_by_uid and d in vacation_dates_by_uid[w_id]:
                conflict_tasks = [t for t, _ in w_tasks]
                for t in conflict_tasks:
                    old_start = t.start_date
                    if old_start <= d:
                        target_start = add_working_days(d, 1)
                        shift_days = get_working_days_count(old_start, target_start) - 1
                    else:
                        shift_days = 1
                    if shift_days <= 0: shift_days = 1
                    
                    sugg_id = str(uuid4())
                    suggestions.append({
                        "id": sugg_id,
                        "type": "vacation_conflict",
                        "task_id": str(t.id),
                        "task_name": t.text,
                        "project_id": str(t.project_id),
                        "project_name": t.project.name if t.project else "-",
                        "worker": w,
                        "date": str(d),
                        "reason": f"L'addetto {w} è in ferie il {d.strftime('%d/%m/%Y')}.",
                        "action_type": ReplanActionType.SHIFT_VACATION.value,
                        "action_payload": {
                            "task_id": str(t.id),
                            "shift_days": shift_days
                        },
                        "action_label": f"Sposta '{t.text}' in avanti di {shift_days}gg lavorativi"
                    })
                continue
                
            # Sovraccarico
            total_h = sum(h for _, h in w_tasks)
            if total_h > max_daily_hours:
                conflict_tasks = [t for t, _ in w_tasks]
                conflict_tasks.sort(key=lambda t: (t.start_date, t.id))
                t_to_shift = conflict_tasks[-1] # Proponiamo di spostare l'ultima arrivata/iniziata
                
                old_start = t_to_shift.start_date
                if old_start <= d:
                    target_start = add_working_days(d, 1)
                    shift_days = get_working_days_count(old_start, target_start) - 1
                else:
                    shift_days = 1
                if shift_days <= 0: shift_days = 1
                
                sugg_id = str(uuid4())
                suggestions.append({
                    "id": sugg_id,
                    "type": "overload_conflict",
                    "task_id": str(t_to_shift.id),
                    "task_name": t_to_shift.text,
                    "project_id": str(t_to_shift.project_id),
                    "project_name": t_to_shift.project.name if t_to_shift.project else "-",
                    "worker": w,
                    "date": str(d),
                    "reason": f"L'addetto {w} ha un carico di {round(total_h, 1)}h (limite {max_daily_hours}h) il {d.strftime('%d/%m/%Y')}.",
                    "action_type": ReplanActionType.SHIFT_OVERLOAD.value,
                    "action_payload": {
                        "task_id": str(t_to_shift.id),
                        "shift_days": shift_days
                    },
                    "action_label": f"Sposta '{t_to_shift.text}' in avanti di {shift_days}gg lavorativi"
                })

    return suggestions


async def execute_suggestion(db: AsyncSession, action_type: str, payload: dict, current_user: User):
    if action_type == ReplanActionType.EXTEND_PROJECT.value:
        from app.models.project import Project
        project_id = payload.get("project_id")
        new_end_date_str = payload.get("new_end_date")
        if not project_id or not new_end_date_str:
            return False
            
        proj_res = await db.execute(select(Project).where(Project.id == project_id))
        project = proj_res.scalar_one_or_none()
        if not project:
            return False
            
        old_end = project.end_date
        new_end = datetime.strptime(new_end_date_str, "%Y-%m-%d").date()
        project.end_date = new_end
        
        log = ReplanLog(
            action_type=ReplanActionType.EXTEND_PROJECT,
            project_id=project.id,
            reason=f"Estesa la data fine commessa dal {old_end.strftime('%d/%m/%Y') if old_end else 'N/D'} al {new_end.strftime('%d/%m/%Y')} per ospitare le fasi prolungate.",
            old_end_date=old_end,
            new_end_date=new_end
        )
        db.add(log)
        await db.commit()
        await manager.broadcast(str(project.id), {"action": "project_updated"})
        return True

    if action_type in (ReplanActionType.SHIFT_VACATION.value, ReplanActionType.SHIFT_OVERLOAD.value, ReplanActionType.SHIFT_DELAY.value, ReplanActionType.WARNING_UNACCOUNTED.value):
        task_id = payload.get("task_id")
        shift_days = payload.get("shift_days", 1)
        if not task_id:
            return False
            
        task_res = await db.execute(select(Task).where(Task.id == task_id))
        t_to_shift = task_res.scalar_one_or_none()
        if not t_to_shift:
            return False
            
        old_start = t_to_shift.start_date
        old_end = t_to_shift.end_date
        
        if action_type == ReplanActionType.SHIFT_DELAY.value:
            new_start = old_start
            new_end = add_working_days(old_end, shift_days)
            add_hours = payload.get("add_hours", 0)
            if add_hours > 0:
                t_to_shift.planned_hours = (t_to_shift.planned_hours or 0) + add_hours
        else:
            new_start = add_working_days(old_start, shift_days)
            dur_working = get_working_days_count(old_start, old_end)
            
            new_end = new_start
            count = 1
            while count < dur_working:
                new_end += timedelta(days=1)
                if not is_weekend_or_holiday(new_end):
                    count += 1
                
        t_to_shift.start_date = new_start
        t_to_shift.end_date = new_end
        
        if action_type == ReplanActionType.SHIFT_VACATION.value:
            reason_text = "Esecuzione manuale da Bacheca: Spostamento per ferie."
        elif action_type == ReplanActionType.SHIFT_DELAY.value:
            reason_text = "Esecuzione manuale da Bacheca: Estensione per fase in ritardo."
        elif action_type == ReplanActionType.WARNING_UNACCOUNTED.value:
            reason_text = "Esecuzione manuale da Bacheca: Spostamento per ore non consuntivate."
        else:
            reason_text = "Esecuzione manuale da Bacheca: Spostamento per sovraccarico/conflitto."
        
        log = ReplanLog(
            action_type=ReplanActionType(action_type),
            task_id=t_to_shift.id,
            project_id=t_to_shift.project_id,
            reason=reason_text,
            old_start_date=old_start,
            old_end_date=old_end,
            new_start_date=new_start,
            new_end_date=new_end,
            shift_days=shift_days
        )
        db.add(log)
        
        # Load links and task map for cascade
        links_res = await db.execute(select(Link))
        all_links = links_res.scalars().all()
        
        tasks_res = await db.execute(select(Task).where(Task.type != TaskType.PROJECT))
        all_tasks = tasks_res.scalars().all()
        task_map = {t.id: t for t in all_tasks}
        
        await propagate_cascade(db, t_to_shift, shift_days, all_links, task_map)
        await db.commit()
        for project_id in list(manager.active_connections.keys()):
            await manager.broadcast(project_id, {"action": "replanning_completed"})
        return True
        
    return False


async def propagate_cascade(db: AsyncSession, root_task: Task, shift_days: int, all_links: list[Link], task_map: dict):
    q = [root_task]
    visited = set([root_task.id])
    
    while q:
        curr = q.pop(0)
        
        for link in all_links:
            if link.source == curr.id and link.type == LinkType.FS:
                target_id = link.target
                if target_id not in visited and target_id in task_map:
                    target_task = task_map[target_id]
                    if target_task.completed == 1:
                        continue
                        
                    old_start = target_task.start_date
                    old_end = target_task.end_date
                    
                    if old_start:
                        new_start = add_working_days(old_start, shift_days)
                        dur_working = get_working_days_count(old_start, old_end) if old_end else 1
                        
                        new_end = new_start
                        count = 1
                        while count < dur_working:
                            new_end += timedelta(days=1)
                            if not is_weekend_or_holiday(new_end):
                                count += 1
                                
                        target_task.start_date = new_start
                        target_task.end_date = new_end
                        
                        log = ReplanLog(
                            action_type=ReplanActionType.SHIFT_CASCADE,
                            task_id=target_task.id,
                            project_id=target_task.project_id,
                            reason=f"Spostamento a cascata ({shift_days}gg) derivato dallo spostamento della fase precedente '{curr.text}'.",
                            old_start_date=old_start,
                            old_end_date=old_end,
                            new_start_date=new_start,
                            new_end_date=new_end,
                            shift_days=shift_days
                        )
                        db.add(log)
                        
                        visited.add(target_task.id)
                        q.append(target_task)


async def revert_action(db: AsyncSession, log_id: str, current_user: User):
    log_res = await db.execute(select(ReplanLog).where(ReplanLog.id == log_id))
    log = log_res.scalar_one_or_none()
    
    if not log or log.reverted:
        return False
        
    if log.action_type == ReplanActionType.EXTEND_PROJECT:
        from app.models.project import Project
        proj_res = await db.execute(select(Project).where(Project.id == log.project_id))
        proj = proj_res.scalar_one_or_none()
        if proj:
            proj.end_date = log.old_end_date
    else:
        task_res = await db.execute(select(Task).where(Task.id == log.task_id))
        task = task_res.scalar_one_or_none()
        
        if task:
            task.start_date = log.old_start_date
            task.end_date = log.old_end_date
        
    log.reverted = True
    log.reverted_at = datetime.now(timezone.utc)
    log.reverted_by = current_user.id
    
    await db.commit()
    for project_id in list(manager.active_connections.keys()):
        await manager.broadcast(project_id, {"action": "replanning_reverted"})
    return True
