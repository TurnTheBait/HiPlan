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
from app.utils.working_days import is_working_day

logger = logging.getLogger(__name__)

async def check_replanning_enabled(db: AsyncSession) -> bool:
    res = await db.execute(select(Setting).where(Setting.key == "replanning_agent_enabled"))
    setting = res.scalar_one_or_none()
    return setting is not None and setting.value == "true"


def is_weekend_or_holiday(d: date) -> bool:
    return not is_working_day(d)


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


async def get_replanning_suggestions(db: AsyncSession, current_user=None):
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
    all_tasks_raw = tasks_res.scalars().all()
    all_tasks = []
    for t in all_tasks_raw:
        if t.project:
            p_status = t.project.status.value if hasattr(t.project.status, 'value') else str(t.project.status)
            if p_status in ("completed", "archived", "ProjectStatus.COMPLETED", "ProjectStatus.ARCHIVED"):
                continue
        all_tasks.append(t)
    
    vacs_res = await db.execute(select(Vacation))
    vacations = vacs_res.scalars().all()
    
    users_res = await db.execute(select(User))
    users = users_res.scalars().all()
    username_to_id = {u.username: str(u.id) for u in users}
    fullname_to_id = {u.full_name: str(u.id) for u in users if u.full_name}

    if current_user and getattr(current_user, 'role', None) == "editor" and getattr(current_user, 'department', None):
        username_to_dept = {u.username: u.department for u in users}
        fullname_to_dept = {u.full_name: u.department for u in users if u.full_name}
        
        filtered_tasks = []
        for t in all_tasks:
            if getattr(t, 'department', None) == current_user.department:
                filtered_tasks.append(t)
                continue
            try:
                workers_list = json.loads(t.workers) if t.workers else []
            except:
                workers_list = []
                
            has_dept_worker = False
            for w in workers_list:
                dept = fullname_to_dept.get(w) or username_to_dept.get(w)
                if dept == current_user.department:
                    has_dept_worker = True
                    break
            
            if has_dept_worker:
                filtered_tasks.append(t)
                
        all_tasks = filtered_tasks
    
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
            sugg_id = f"ext_proj_{task.id}_{task.end_date.strftime('%Y%m%d')}"
            suggestions.append({
                "id": sugg_id,
                "type": "project_end_exceeded",
                "task_id": str(task.id),
                "task_name": task.text,
                "project_id": str(task.project_id),
                "project_name": task.project.name,
                "project_code": task.project.code if task.project.code else "",
                "worker": None,
                "date": str(task.end_date),
                "reason": f"La fase termina il {task.end_date.strftime('%d/%m/%Y')}, superando la scadenza della commessa ({task.project.end_date.strftime('%d/%m/%Y')})."
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
            sugg_id = f"delay_{task.id}_{today.strftime('%Y%m%d')}_sforamento"
            suggestions.append({
                "id": sugg_id,
                "type": "delay_conflict",
                "task_id": str(task.id),
                "task_name": task.text,
                "project_id": str(task.project_id),
                "project_name": task.project.name if task.project else "-",
                "project_code": (task.project.code if task.project.code else "") if task.project else "",
                "worker": None,
                "date": str(task.end_date),
                "reason": f"La fase ha superato le ore previste ({round(tot_eff, 1)}h consuntivate su {planned_h}h previste)."
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

                date_str_val = first_delayed_date.strftime('%Y%m%d') if first_delayed_date else 'unknown'
                sugg_id = f"delay_{task.id}_{date_str_val}_critico"
                suggestions.append({
                    "id": sugg_id,
                    "type": "delay_conflict",
                    "task_id": str(task.id),
                    "task_name": task.text,
                    "project_id": str(task.project_id),
                    "project_name": task.project.name if task.project else "-",
                    "project_code": (task.project.code if task.project.code else "") if task.project else "",
                    "worker": None,
                    "date": str(first_delayed_date),
                    "reason": f"Ritardo critico: mancano all'appello circa {round(lost_hours, 1)}h rispetto al piano."
                })
            elif task.end_date < today:
                # Fallback: scaduta e non in sforamento / ritardo critico specifico
                days_to_add = get_working_days_count(task.end_date, today)
                if days_to_add <= 0: days_to_add = 1
                sugg_id = f"delay_{task.id}_{task.end_date.strftime('%Y%m%d')}_scaduta"
                suggestions.append({
                    "id": sugg_id,
                    "type": "delay_conflict",
                    "task_id": str(task.id),
                    "task_name": task.text,
                    "project_id": str(task.project_id),
                    "project_name": task.project.name if task.project else "-",
                    "project_code": (task.project.code if task.project.code else "") if task.project else "",
                    "worker": None,
                    "date": str(task.end_date),
                    "reason": f"La fase è scaduta il {task.end_date.strftime('%d/%m/%Y')} ma non risulta completata."
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
            
        # DHTMLX Gantt sets exclusive end_date for tasks spanning entire days
        inclusive_end = task.end_date - timedelta(days=1) if task.end_date > task.start_date else task.end_date
        duration_days = get_working_days_count(task.start_date, inclusive_end)
        
        cur = task.start_date
        while cur <= inclusive_end:
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
                    shift_days = 1
                    
                    sugg_id = f"vac_{t.id}_{w_id}_{d.strftime('%Y%m%d')}"
                    suggestions.append({
                        "id": sugg_id,
                        "type": "vacation_conflict",
                        "task_id": str(t.id),
                        "task_name": t.text,
                        "project_id": str(t.project_id),
                        "project_name": t.project.name if t.project else "-",
                        "project_code": (t.project.code if t.project.code else "") if t.project else "",
                        "worker": w,
                        "date": str(d),
                        "reason": f"L'addetto {w} è in ferie il {d.strftime('%d/%m/%Y')}."
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
                
                sugg_id = f"overload_{t_to_shift.id}_{w_id}_{d.strftime('%Y%m%d')}"
                suggestions.append({
                    "id": sugg_id,
                    "type": "overload_conflict",
                    "task_id": str(t_to_shift.id),
                    "task_name": t_to_shift.text,
                    "project_id": str(t_to_shift.project_id),
                    "project_name": t_to_shift.project.name if t_to_shift.project else "-",
                    "project_code": (t_to_shift.project.code if t_to_shift.project.code else "") if t_to_shift.project else "",
                    "worker": w,
                    "date": str(d),
                    "reason": f"L'addetto {w} ha un carico di {round(total_h, 1)}h (limite {max_daily_hours}h) il {d.strftime('%d/%m/%Y')}."
                })

    return suggestions

