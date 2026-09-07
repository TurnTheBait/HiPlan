import json
import logging
import math
from datetime import date, timedelta, datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple
from uuid import uuid4

# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select, desc, or_
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import selectinload

from app.models.task import Task, TaskType
from app.models.link import Link, LinkType
from app.models.project import Project, ProjectStatus
from app.models.vacation import Vacation
from app.models.user import User, UserRole
from app.models.replan_log import ReplanLog, ReplanActionType
from app.utils.working_days import is_working_day

logger = logging.getLogger(__name__)

MAX_DAILY_HOURS = 8.0


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


def get_working_days_count(start: Optional[date], end: Optional[date], excluded_dates: Optional[list] = None) -> int:
    if excluded_dates is None:
        excluded_dates = []
    if not start or not end or start > end:
        return 1
    count = 0
    cur = start
    while cur <= end:
        if not is_weekend_or_holiday(cur) and cur.strftime("%Y-%m-%d") not in excluded_dates:
            count += 1
        cur += timedelta(days=1)
    return max(1, count)


def parse_workers_list(workers_val: Any) -> List[str]:
    if not workers_val:
        return []
    if isinstance(workers_val, list):
        return [str(w).strip() for w in workers_val if str(w).strip()]
    try:
        data = json.loads(workers_val)
        if isinstance(data, list):
            return [str(w).strip() for w in data if str(w).strip()]
    except Exception:
        pass
    return []


def parse_worker_hours_map(hours_val: Any) -> Dict[str, float]:
    if not hours_val:
        return {}
    if isinstance(hours_val, dict):
        return {str(k): float(v) for k, v in hours_val.items() if v is not None}
    try:
        data = json.loads(hours_val)
        if isinstance(data, dict):
            return {str(k): float(v) for k, v in data.items() if v is not None}
    except Exception:
        pass
    return {}


def parse_actual_hours_map(actual_val: Any) -> Dict[str, Dict[str, float]]:
    if not actual_val:
        return {}
    if isinstance(actual_val, dict):
        return actual_val
    try:
        data = json.loads(actual_val)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


async def build_global_schedule_context(db: AsyncSession) -> Dict[str, Any]:
    """
    Costruisce la vista olistica globale di:
    - Tutte le commesse attive
    - Tutti i task non completati
    - Tutti i link/dipendenze
    - Tutte le ferie approvate
    - La matrice globale di carico orario per addetto/giorno su tutte le commesse
    """
    # 1. Commesse attive
    proj_res = await db.execute(
        select(Project)
        .where(Project.status != ProjectStatus.COMPLETED)
        .where(Project.status != ProjectStatus.ARCHIVED)
        .where(Project.deleted_at == None)
    )
    active_projects = {str(p.id): p for p in proj_res.scalars().all()}

    # 2. Utenti
    users_res = await db.execute(select(User))
    users = users_res.scalars().all()
    user_by_id = {str(u.id): u for u in users}
    user_by_name = {}
    for u in users:
        if u.username:
            user_by_name[u.username.strip().lower()] = u
        if u.full_name:
            user_by_name[u.full_name.strip().lower()] = u

    # 3. Ferie per utente
    vac_res = await db.execute(select(Vacation))
    vacations = vac_res.scalars().all()
    vacation_days_by_uid: Dict[str, Set[date]] = {}
    for v in vacations:
        uid = str(v.user_id)
        if uid not in vacation_days_by_uid:
            vacation_days_by_uid[uid] = set()
        c = v.start_date
        while c <= v.end_date:
            vacation_days_by_uid[uid].add(c)
            c += timedelta(days=1)

    # 4. Tutti i task di tutte le commesse attive
    task_res = await db.execute(
        select(Task)
        .options(selectinload(Task.project))
        .where(Task.type != TaskType.PROJECT)
        .where(Task.type != TaskType.MILESTONE)
        .where(Task.completed != 1)
    )
    all_tasks = task_res.scalars().all()

    # 5. Tutti i link tra i task
    links_res = await db.execute(select(Link))
    all_links = links_res.scalars().all()
    links_by_source: Dict[str, List[Link]] = {}
    links_by_target: Dict[str, List[Link]] = {}
    for l in all_links:
        s_id = str(l.source)
        t_id = str(l.target)
        links_by_source.setdefault(s_id, []).append(l)
        links_by_target.setdefault(t_id, []).append(l)

    # 6. Mappa timeline carichi giornalieri per addetto:
    # worker_daily_hours[worker_name][date] = List[Tuple[task, daily_h, project_id, project_name]]
    worker_daily_hours: Dict[str, Dict[date, List[Dict[str, Any]]]] = {}

    for t in all_tasks:
        if not t.start_date or not t.end_date:
            continue
        p_id = str(t.project_id)
        if p_id not in active_projects:
            continue
        
        workers = parse_workers_list(t.workers)
        if not workers:
            continue
            
        w_hours_map = parse_worker_hours_map(t.worker_hours)
        duration_days = get_working_days_count(t.start_date, t.end_date)
        
        c = t.start_date
        while c <= t.end_date:
            if not is_weekend_or_holiday(c):
                for w in workers:
                    norm_w = w.strip()
                    total_assigned_h = w_hours_map.get(norm_w)
                    if total_assigned_h is None:
                        total_assigned_h = float(t.planned_hours or 8.0) / len(workers)
                    daily_h = float(total_assigned_h) / max(1, duration_days)

                    worker_daily_hours.setdefault(norm_w, {}).setdefault(c, []).append({
                        "task_id": str(t.id),
                        "task_name": t.text,
                        "project_id": p_id,
                        "project_name": t.project.name if t.project else "Commessa",
                        "daily_hours": daily_h
                    })
            c += timedelta(days=1)

    return {
        "active_projects": active_projects,
        "users": users,
        "user_by_id": user_by_id,
        "user_by_name": user_by_name,
        "vacation_days_by_uid": vacation_days_by_uid,
        "all_tasks": all_tasks,
        "links_by_source": links_by_source,
        "links_by_target": links_by_target,
        "worker_daily_hours": worker_daily_hours,
    }


def find_alternative_worker(
    candidate_workers: List[User],
    current_worker: str,
    start_d: date,
    end_d: date,
    needed_daily_hours: float,
    context: Dict[str, Any],
    department_filter: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """
    Cerca un addetto alternativo idoneo che:
    1. Sia attivo e appartenga allo stesso reparto o compatibile.
    2. Non sia in ferie nelle date [start_d, end_d].
    3. Con l'aggiunta di needed_daily_hours, non superi MAI le 8 ore/giorno su nessuna data.
    Restituisce l'addetto con il miglior margine di capacità residua.
    """
    best_candidate = None
    max_spare_capacity = -1.0

    worker_daily_hours = context["worker_daily_hours"]
    vacation_days_by_uid = context["vacation_days_by_uid"]

    for cand in candidate_workers:
        cand_name = cand.full_name or cand.username
        if not cand_name or cand_name.strip().lower() == current_worker.strip().lower():
            continue
            
        if department_filter and cand.department and cand.department != department_filter:
            continue

        cand_uid = str(cand.id)
        cand_vacations = vacation_days_by_uid.get(cand_uid, set())

        # Verifica ferie nel periodo
        has_vacation = False
        c = start_d
        while c <= end_d:
            if not is_weekend_or_holiday(c) and c in cand_vacations:
                has_vacation = True
                break
            c += timedelta(days=1)
        if has_vacation:
            continue

        # Verifica carichi orari
        can_accommodate = True
        cand_hours_map = worker_daily_hours.get(cand_name, {})
        min_daily_free = 999.0

        c = start_d
        while c <= end_d:
            if not is_weekend_or_holiday(c):
                booked_entries = cand_hours_map.get(c, [])
                booked_h = sum(e["daily_hours"] for e in booked_entries)
                if (booked_h + needed_daily_hours) > MAX_DAILY_HOURS:
                    can_accommodate = False
                    break
                daily_free = MAX_DAILY_HOURS - booked_h
                if daily_free < min_daily_free:
                    min_daily_free = daily_free
            c += timedelta(days=1)

        if can_accommodate and min_daily_free > max_spare_capacity:
            max_spare_capacity = min_daily_free
            best_candidate = {
                "user_id": cand_uid,
                "worker_name": cand_name,
                "department": cand.department,
                "min_daily_free_hours": round(min_daily_free, 1)
            }

    return best_candidate


def detect_cross_project_impact(
    workers: List[str],
    start_d: date,
    end_d: date,
    current_project_id: str,
    context: Dict[str, Any],
    needed_daily_h: float = 8.0,
    downstream_tasks: Optional[List[Dict[str, Any]]] = None
) -> List[Dict[str, Any]]:
    """
    Rileva se lo slittamento temporale o il riposizionamento impatta
    i carichi degli addetti su ALTRE commesse attive contemporanee.
    """
    worker_daily_hours = context.get("worker_daily_hours", {})
    all_tasks = context.get("all_tasks", [])
    all_tasks_by_id = {str(t.id): t for t in all_tasks}
    other_proj_impacts = []
    seen_combos = set()

    # 1. Controlla per i worker della fase principale
    for w in workers:
        w_hours = worker_daily_hours.get(w, {})
        c = start_d
        while c <= end_d:
            if not is_weekend_or_holiday(c):
                entries = w_hours.get(c, [])
                for e in entries:
                    op_id = str(e.get("project_id"))
                    if op_id != current_project_id:
                        op_name = e.get("project_name") or "Altra Commessa"
                        e_task_id = str(e.get("task_id"))
                        combo_key = (w, op_id, e_task_id)
                        if combo_key not in seen_combos:
                            seen_combos.add(combo_key)
                            booked_h = e.get("daily_hours", 0.0)
                            tot_h = booked_h + needed_daily_h
                            t_other = all_tasks_by_id.get(e_task_id)
                            task_name = e.get("task_name") or (t_other.text if t_other else "Fase Commessa")
                            t_start = t_other.start_date.isoformat() if t_other and t_other.start_date else None
                            t_end = t_other.end_date.isoformat() if t_other and t_other.end_date else None

                            if tot_h > MAX_DAILY_HOURS:
                                other_proj_impacts.append({
                                    "worker": w,
                                    "status": "warning",
                                    "project_id": op_id,
                                    "project_name": op_name,
                                    "task_id": e_task_id,
                                    "task_name": task_name,
                                    "task_start": t_start,
                                    "task_end": t_end,
                                    "daily_hours": round(booked_h, 1),
                                    "peak_hours": round(tot_h, 1),
                                    "message": f"Attenzione: Lo slittamento sovrappone {w} con la fase '{task_name}' della commessa '{op_name}' portando il carico a {round(tot_h, 1)}h/gg (>8h)."
                                })
                            else:
                                other_proj_impacts.append({
                                    "worker": w,
                                    "status": "safe",
                                    "project_id": op_id,
                                    "project_name": op_name,
                                    "task_id": e_task_id,
                                    "task_name": task_name,
                                    "task_start": t_start,
                                    "task_end": t_end,
                                    "daily_hours": round(booked_h, 1),
                                    "peak_hours": round(tot_h, 1),
                                    "message": f"{w} è impegnato anche sulla fase '{task_name}' di '{op_name}' ({round(booked_h, 1)}h/gg), ma la sovrapposizione rientra nella capienza massima (totale {round(tot_h, 1)}h/gg)."
                                })
            c += timedelta(days=1)

    # 2. Controlla anche per i worker delle fasi a valle che slittano a catena
    if downstream_tasks:
        for dt in downstream_tasks:
            dt_id = dt.get("task_id")
            orig_task = next((t for t in all_tasks if str(t.id) == dt_id), None)
            if orig_task:
                dt_workers = parse_workers_list(orig_task.workers)
                try:
                    dt_start = date.fromisoformat(dt["proposed_start"])
                    dt_end = date.fromisoformat(dt["proposed_end"])
                except Exception:
                    continue
                dt_dur = get_working_days_count(dt_start, dt_end)
                dt_needed_h = float(orig_task.planned_hours or 8.0) / max(1, len(dt_workers) * dt_dur)

                for dw in dt_workers:
                    dw_hours = worker_daily_hours.get(dw, {})
                    cur = dt_start
                    while cur <= dt_end:
                        if not is_weekend_or_holiday(cur):
                            entries = dw_hours.get(cur, [])
                            for e in entries:
                                op_id = str(e.get("project_id"))
                                if op_id != current_project_id:
                                    op_name = e.get("project_name") or "Altra Commessa"
                                    e_task_id = str(e.get("task_id"))
                                    combo_key = (dw, op_id, e_task_id)
                                    if combo_key not in seen_combos:
                                        seen_combos.add(combo_key)
                                        booked_h = e.get("daily_hours", 0.0)
                                        tot_h = booked_h + dt_needed_h
                                        t_other = all_tasks_by_id.get(e_task_id)
                                        task_name = e.get("task_name") or (t_other.text if t_other else "Fase Commessa")
                                        t_start = t_other.start_date.isoformat() if t_other and t_other.start_date else None
                                        t_end = t_other.end_date.isoformat() if t_other and t_other.end_date else None

                                        if tot_h > MAX_DAILY_HOURS:
                                            other_proj_impacts.append({
                                                "worker": dw,
                                                "status": "warning",
                                                "project_id": op_id,
                                                "project_name": op_name,
                                                "task_id": e_task_id,
                                                "task_name": task_name,
                                                "task_start": t_start,
                                                "task_end": t_end,
                                                "daily_hours": round(booked_h, 1),
                                                "peak_hours": round(tot_h, 1),
                                                "source_task_name": orig_task.text,
                                                "message": f"Cascata: {dw} sulla fase '{orig_task.text}' si sovrappone a '{task_name}' della commessa '{op_name}' portando il carico a {round(tot_h, 1)}h/gg (>8h)."
                                            })
                                        else:
                                            other_proj_impacts.append({
                                                "worker": dw,
                                                "status": "safe",
                                                "project_id": op_id,
                                                "project_name": op_name,
                                                "task_id": e_task_id,
                                                "task_name": task_name,
                                                "task_start": t_start,
                                                "task_end": t_end,
                                                "daily_hours": round(booked_h, 1),
                                                "peak_hours": round(tot_h, 1),
                                                "source_task_name": orig_task.text,
                                                "message": f"Cascata: {dw} sulla fase '{orig_task.text}' ha capienza compatibile con '{task_name}' di '{op_name}'."
                                            })
                        cur += timedelta(days=1)

    return other_proj_impacts


def calculate_cascade_impact(
    task: Task,
    new_start_date: date,
    new_end_date: date,
    project_end_date: Optional[date],
    context: Dict[str, Any],
    visited: Optional[Set[str]] = None
) -> Dict[str, Any]:
    """
    Calcola ricorsivamente la propagazione a cascata sulle fasi successive
    della stessa commessa collegate da Link (Finish-to-Start, ecc.)
    e verifica il rispetto rigoroso della fine commessa.
    """
    if visited is None:
        visited = set()
    visited.add(str(task.id))

    links_by_source = context["links_by_source"]
    downstream_links = links_by_source.get(str(task.id), [])
    
    affected_successors = []
    exceeds_deadline = False
    max_reach_date = new_end_date

    for link in downstream_links:
        succ_task = link.target_task
        if not succ_task or str(succ_task.id) in visited:
            continue
        if succ_task.completed == 1:
            continue

        # In DHTMLX standard Finish-to-Start (FS / type "0")
        link_type = link.type.value if hasattr(link.type, 'value') else str(link.type)
        lag = int(link.lag or 0)
        
        succ_start = succ_task.start_date
        succ_end = succ_task.end_date
        duration = succ_task.duration or get_working_days_count(succ_start, succ_end)
        
        needed_start = succ_start
        if link_type == "0":  # FS
            min_allowed = add_working_days(new_end_date, 1 + lag)
            if succ_start < min_allowed:
                needed_start = min_allowed
        elif link_type == "1":  # SS
            min_allowed = add_working_days(new_start_date, lag)
            if succ_start < min_allowed:
                needed_start = min_allowed
        elif link_type == "2":  # FF
            min_allowed_end = add_working_days(new_end_date, lag)
            if succ_end and succ_end < min_allowed_end:
                needed_start = add_working_days(min_allowed_end, -duration)

        if needed_start > succ_start:
            needed_end = add_working_days(needed_start, duration - 1)
            if needed_end > max_reach_date:
                max_reach_date = needed_end

            if project_end_date and needed_end > project_end_date:
                exceeds_deadline = True

            succ_info = {
                "task_id": str(succ_task.id),
                "task_name": succ_task.text,
                "current_start": str(succ_start),
                "current_end": str(succ_end),
                "proposed_start": str(needed_start),
                "proposed_end": str(needed_end),
                "shift_working_days": get_working_days_count(succ_start, needed_start) - 1
            }

            # Ricorsione sui successori di questo successore
            sub_cascade = calculate_cascade_impact(
                succ_task, needed_start, needed_end, project_end_date, context, visited
            )
            if sub_cascade.get("exceeds_project_deadline"):
                exceeds_deadline = True
            succ_info["sub_successors"] = sub_cascade.get("affected_successors", [])
            affected_successors.append(succ_info)

    return {
        "affected_successors": affected_successors,
        "max_reach_date": str(max_reach_date),
        "exceeds_project_deadline": exceeds_deadline
    }


async def generate_project_smart_suggestions(
    db: AsyncSession,
    project_id: str,
    current_user: Optional[User] = None
) -> Dict[str, Any]:
    """
    Motore Principale di Analisi e Rebalance per una specifica commessa:
    1. Raccoglie il contesto globale di tutte le commesse e tutti gli addetti.
    2. Identifica i conflitti di questa commessa (ferie, sovraccarichi, ritardi, scadenze).
    3. Formula proposte intelligenti secondo l'ordine di priorità:
       - Riassegnazione risorsa (nessun cambio date)
       - Spostamento nel margine libero interno (fine commessa intatta)
       - Supporto / Parallelizzazione
       - Allarme ultima spiaggia (richiesta estensione manuale)
    4. Calcola la propagazione a cascata e verifica l'impatto cross-commessa.
    """
    today = date.today()
    context = await build_global_schedule_context(db)
    
    active_projects = context["active_projects"]
    if project_id not in active_projects:
        # Se la commessa non è attiva, estraila singolarmente
        proj_res = await db.execute(select(Project).where(Project.id == project_id))
        target_project = proj_res.scalar_one_or_none()
        if not target_project:
            return {"error": "Commessa non trovata", "suggestions": []}
    else:
        target_project = active_projects[project_id]

    proj_start_date = target_project.start_date
    proj_end_date = target_project.end_date

    # Estrai i task della commessa target
    task_res = await db.execute(
        select(Task)
        .where(Task.project_id == project_id)
        .where(Task.type != TaskType.PROJECT)
        .where(Task.type != TaskType.MILESTONE)
        .order_by(Task.sort_order, Task.start_date)
    )
    proj_tasks = task_res.scalars().all()

    vacation_days_by_uid = context["vacation_days_by_uid"]
    worker_daily_hours = context["worker_daily_hours"]
    user_by_name = context["user_by_name"]
    users = context["users"]

    suggestions: List[Dict[str, Any]] = []

    for task in proj_tasks:
        if task.completed == 1 or not task.start_date or not task.end_date:
            continue

        workers = parse_workers_list(task.workers)
        w_hours_map = parse_worker_hours_map(task.worker_hours)
        actual_h_map = parse_actual_hours_map(task.actual_hours)
        duration_days = get_working_days_count(task.start_date, task.end_date)
        planned_h = float(task.planned_hours or 8.0)

        # Calcola ore consuntivate totali finora
        tot_actual_h = 0.0
        for day_map in actual_h_map.values():
            if isinstance(day_map, dict):
                for h in day_map.values():
                    try:
                        tot_actual_h += float(h)
                    except Exception:
                        pass

        # -------------------------------------------------------------
        # 1. ANALISI CONFLITTO FERIE
        # -------------------------------------------------------------
        for w in workers:
            w_user = user_by_name.get(w.strip().lower())
            if not w_user:
                continue
            w_uid = str(w_user.id)
            w_vacations = vacation_days_by_uid.get(w_uid, set())

            conflicting_vac_dates = []
            c = task.start_date
            while c <= task.end_date:
                if not is_weekend_or_holiday(c) and c in w_vacations:
                    conflicting_vac_dates.append(c)
                c += timedelta(days=1)

            if conflicting_vac_dates:
                assigned_h = w_hours_map.get(w, planned_h / len(workers))
                daily_h_needed = assigned_h / max(1, duration_days)

                # PRIORITÀ 1 (PREFERITA): L'addetto stesso recupera le ore al rientro dalle ferie
                max_vac = max(conflicting_vac_dates)
                target_start = add_working_days(max_vac, 1)
                target_end = add_working_days(target_start, duration_days - 1)

                cascade = calculate_cascade_impact(task, target_start, target_end, proj_end_date, context)

                alt_worker = find_alternative_worker(
                    users, w, task.start_date, task.end_date, daily_h_needed, context,
                    department_filter=task.department or w_user.department
                )

                if not cascade["exceeds_project_deadline"]:
                    # L'addetto stesso recupera il lavoro al rientro senza violare la scadenza contrattuale
                    shift_days = get_working_days_count(task.start_date, target_start) - 1
                    sugg_id = f"vac_shift_{task.id}_{w_uid}_{target_start.strftime('%Y%m%d')}"
                    daily_needed_h = float(task.planned_hours or 8.0) / max(1, len(workers) * duration_days)
                    cross_proj_impact = detect_cross_project_impact(
                        workers, target_start, target_end, project_id, context,
                        needed_daily_h=daily_needed_h,
                        downstream_tasks=cascade["affected_successors"]
                    )
                    suggestions.append({
                        "id": sugg_id,
                        "type": "vacation_conflict",
                        "severity": "medium",
                        "title": f"Recupero Post-Ferie: {w}",
                        "description": f"L'addetto {w} è in ferie per {len(conflicting_vac_dates)} gg. Come preferito, l'addetto stesso recupera la lavorazione al rientro ({target_start.strftime('%d/%m')}); la commessa ha margine sufficiente per assorbire lo slittamento senza sforare la consegna finale.",
                        "task_id": str(task.id),
                        "task_name": task.text,
                        "strategy": "internal_shift",
                        "strategy_label": "Recupero Post-Ferie (Stesso Addetto)",
                        "badge": "Recupero Addetto",
                        "is_alternative": False,
                        "action_label": f"Sposta al rientro di {w} ({target_start.strftime('%d/%m')} → {target_end.strftime('%d/%m')})",
                        "current_state": {
                            "workers": workers,
                            "start_date": str(task.start_date),
                            "end_date": str(task.end_date),
                            "conflicting_dates": [d.strftime("%d/%m/%Y") for d in conflicting_vac_dates]
                        },
                        "proposed_changes": {
                            "task_id": str(task.id),
                            "workers": workers,
                            "worker_hours": w_hours_map,
                            "start_date": str(target_start),
                            "end_date": str(target_end),
                            "shift_working_days": shift_days
                        },
                        "cascade_impact": {
                            "same_project_tasks": cascade["affected_successors"],
                            "other_projects": cross_proj_impact,
                            "project_deadline_status": "safe",
                            "deadline_message": f"Tutte le fasi a valle rimangono entro la scadenza finale ({proj_end_date.strftime('%d/%m/%Y')})."
                        }
                    })

                    # Se esiste anche un collega alternativo, offriamo l'opzione secondaria per mantenere le date fisse
                    if alt_worker:
                        new_workers = [alt_worker["worker_name"] if cur == w else cur for cur in workers]
                        new_w_hours = dict(w_hours_map)
                        if w in new_w_hours:
                            new_w_hours[alt_worker["worker_name"]] = new_w_hours.pop(w)

                        alt_sugg_id = f"vac_reassign_alt_{task.id}_{w_uid}_{conflicting_vac_dates[0].strftime('%Y%m%d')}"
                        suggestions.append({
                            "id": alt_sugg_id,
                            "type": "vacation_conflict",
                            "severity": "low",
                            "title": f"Opzione Alternativa: Riassegna a {alt_worker['worker_name']}",
                            "description": f"Se si preferisce mantenere le date fisse senza far slittare la lavorazione al rientro di {w}, la fase può essere affidata al collega {alt_worker['worker_name']}.",
                            "task_id": str(task.id),
                            "task_name": task.text,
                            "strategy": "reassign_worker",
                            "strategy_label": "Riassegnazione a Risorsa Alternativa",
                            "badge": "Opzione Alternativa",
                            "is_alternative": True,
                            "action_label": f"Riassegna a {alt_worker['worker_name']} (date invariate)",
                            "current_state": {
                                "workers": workers,
                                "start_date": str(task.start_date),
                                "end_date": str(task.end_date),
                                "conflicting_dates": [d.strftime("%d/%m/%Y") for d in conflicting_vac_dates]
                            },
                            "proposed_changes": {
                                "task_id": str(task.id),
                                "workers": new_workers,
                                "worker_hours": new_w_hours,
                                "start_date": str(task.start_date),
                                "end_date": str(task.end_date),
                                "shift_working_days": 0
                            },
                            "cascade_impact": {
                                "same_project_tasks": [],
                                "other_projects": [
                                    {
                                        "worker": alt_worker["worker_name"],
                                        "status": "safe",
                                        "message": f"{alt_worker['worker_name']} ha capienza libera (~{alt_worker['min_daily_free_hours']}h/gg) per coprire la fase."
                                    }
                                ],
                                "project_deadline_status": "safe",
                                "deadline_message": f"Scadenza commessa ({proj_end_date.strftime('%d/%m/%Y') if proj_end_date else 'N.D.'}) rispettata."
                            }
                        })
                elif alt_worker:
                    # PRIORITÀ 2 (FALLBACK): Far recuperare l'addetto stesso violerebbe la scadenza di commessa.
                    # Per salvare la consegna finale senza sforare, riassegniamo la fase ad un collega disponibile.
                    new_workers = [alt_worker["worker_name"] if cur == w else cur for cur in workers]
                    new_w_hours = dict(w_hours_map)
                    if w in new_w_hours:
                        new_w_hours[alt_worker["worker_name"]] = new_w_hours.pop(w)

                    sugg_id = f"vac_reassign_{task.id}_{w_uid}_{conflicting_vac_dates[0].strftime('%Y%m%d')}"
                    suggestions.append({
                        "id": sugg_id,
                        "type": "vacation_conflict",
                        "severity": "high",
                        "title": f"Salva Scadenza per Ferie: {w} → {alt_worker['worker_name']}",
                        "description": f"Lo slittamento al rientro di {w} violerebbe la scadenza contrattuale ({proj_end_date.strftime('%d/%m/%Y')}). Per salvare la consegna, la fase viene riassegnata a {alt_worker['worker_name']} a parità di date.",
                        "task_id": str(task.id),
                        "task_name": task.text,
                        "strategy": "reassign_worker",
                        "strategy_label": "Riassegnazione per Salvaguardia Consegna",
                        "badge": "Salva Scadenza",
                        "is_alternative": False,
                        "action_label": f"Riassegna a {alt_worker['worker_name']} (senza variare le date)",
                        "current_state": {
                            "workers": workers,
                            "start_date": str(task.start_date),
                            "end_date": str(task.end_date),
                            "conflicting_dates": [d.strftime("%d/%m/%Y") for d in conflicting_vac_dates]
                        },
                        "proposed_changes": {
                            "task_id": str(task.id),
                            "workers": new_workers,
                            "worker_hours": new_w_hours,
                            "start_date": str(task.start_date),
                            "end_date": str(task.end_date),
                            "shift_working_days": 0
                        },
                        "cascade_impact": {
                            "same_project_tasks": [],
                            "other_projects": [
                                {
                                    "worker": alt_worker["worker_name"],
                                    "status": "safe",
                                    "message": f"Nessun sovraccarico generato: {alt_worker['worker_name']} ha circa {alt_worker['min_daily_free_hours']}h/gg libere nel periodo."
                                }
                            ],
                            "project_deadline_status": "safe",
                            "deadline_message": f"Scadenza commessa ({proj_end_date.strftime('%d/%m/%Y') if proj_end_date else 'N.D.'}) pienamente rispettata."
                        }
                    })
                else:
                    # PRIORITÀ 3: Allarme Ultima Spiaggia (violazione scadenza e nessun collega disponibile)
                    sugg_id = f"vac_crit_{task.id}_{w_uid}"
                    suggestions.append({
                        "id": sugg_id,
                        "type": "deadline_breach_risk",
                        "severity": "critical",
                        "title": f"Rischio Consegna per Ferie: {w}",
                        "description": f"Le ferie di {w} e l'assenza di sostituti impediscono di completare la fase in tempo. Lo slittamento violerebbe la consegna del {proj_end_date.strftime('%d/%m/%Y')}.",
                        "task_id": str(task.id),
                        "task_name": task.text,
                        "strategy": "manual_action_required",
                        "strategy_label": "Intervento Manuale Necessario",
                        "badge": "Rischio Scadenza",
                        "is_alternative": False,
                        "action_label": "Richiede estensione manuale data consegna o risorsa esterna",
                        "current_state": {
                            "workers": workers,
                            "start_date": str(task.start_date),
                            "end_date": str(task.end_date)
                        },
                        "proposed_changes": None,
                        "cascade_impact": {
                            "same_project_tasks": cascade["affected_successors"],
                            "other_projects": [],
                            "project_deadline_status": "breached",
                            "deadline_message": f"Attenzione: Lo slittamento supererebbe la consegna finale del {proj_end_date.strftime('%d/%m/%Y')}. È richiesta una modifica manuale della commessa."
                        }
                    })

        # -------------------------------------------------------------
        # 2. ANALISI SOVRACCARICO MULTI-COMMESSA (> 8h/giorno)
        # -------------------------------------------------------------
        for w in workers:
            w_hours_in_timeline = worker_daily_hours.get(w, {})
            overload_dates = []
            max_overload_val = 0.0

            c = task.start_date
            while c <= task.end_date:
                if not is_weekend_or_holiday(c) and c >= today:
                    entries = w_hours_in_timeline.get(c, [])
                    tot_day_h = sum(e["daily_hours"] for e in entries)
                    if tot_day_h > MAX_DAILY_HOURS:
                        overload_dates.append((c, tot_day_h))
                        if tot_day_h > max_overload_val:
                            max_overload_val = tot_day_h
                c += timedelta(days=1)

            if overload_dates:
                # Trovato sovraccarico incrociato: cerchiamo sostituto
                assigned_h = w_hours_map.get(w, planned_h / len(workers))
                daily_h_needed = assigned_h / max(1, duration_days)

                alt_worker = find_alternative_worker(
                    users, w, task.start_date, task.end_date, daily_h_needed, context,
                    department_filter=task.department
                )

                if alt_worker:
                    new_workers = [alt_worker["worker_name"] if cur == w else cur for cur in workers]
                    new_w_hours = dict(w_hours_map)
                    if w in new_w_hours:
                        new_w_hours[alt_worker["worker_name"]] = new_w_hours.pop(w)

                    sugg_id = f"overload_reassign_{task.id}_{w}_{overload_dates[0][0].strftime('%Y%m%d')}"
                    suggestions.append({
                        "id": sugg_id,
                        "type": "overload_conflict",
                        "severity": "high",
                        "title": f"Sovraccarico Multi-Commessa: {w}",
                        "description": f"L'addetto {w} ha un picco di {round(max_overload_val, 1)}h/gg su più commesse concomitanti tra il {task.start_date.strftime('%d/%m')} e il {task.end_date.strftime('%d/%m')}.",
                        "task_id": str(task.id),
                        "task_name": task.text,
                        "strategy": "reassign_worker",
                        "strategy_label": "Ribilanciamento Carico Orario",
                        "badge": "Rebalance Carichi",
                        "is_alternative": False,
                        "action_label": f"Riassegna fase a {alt_worker['worker_name']} per assorbire il sovraccarico",
                        "current_state": {
                            "workers": workers,
                            "peak_hours": round(max_overload_val, 1),
                            "overload_days_count": len(overload_dates)
                        },
                        "proposed_changes": {
                            "task_id": str(task.id),
                            "workers": new_workers,
                            "worker_hours": new_w_hours,
                            "start_date": str(task.start_date),
                            "end_date": str(task.end_date),
                            "shift_working_days": 0
                        },
                        "cascade_impact": {
                            "same_project_tasks": [],
                            "other_projects": [
                                {
                                    "worker": w,
                                    "status": "relieved",
                                    "message": f"Il carico di {w} scende a livelli sostenibili (<= 8h/gg) sulle altre commesse."
                                },
                                {
                                    "worker": alt_worker["worker_name"],
                                    "status": "safe",
                                    "message": f"{alt_worker['worker_name']} accoglie il task rimanendo entro il limite di 8h giornaliere."
                                }
                            ],
                            "project_deadline_status": "safe",
                            "deadline_message": "Date della commessa invariate al 100%."
                        }
                    })

        # -------------------------------------------------------------
        # 3. ANALISI FASE SCADUTA O RITARDO ACCUMULATO
        # -------------------------------------------------------------
        if task.end_date < today and tot_actual_h < planned_h:
            # Fase scaduta nel passato e non completata
            days_late = get_working_days_count(task.end_date, today) - 1
            needed_days = max(1, math.ceil((planned_h - tot_actual_h) / max(1.0, (planned_h / max(1, duration_days)))))
            
            target_start = today
            target_end = add_working_days(target_start, needed_days - 1)

            cascade = calculate_cascade_impact(task, target_start, target_end, proj_end_date, context)
            sugg_id = f"expired_recovery_{task.id}_{today.strftime('%Y%m%d')}"

            if not cascade["exceeds_project_deadline"]:
                remaining_h = max(1.0, planned_h - tot_actual_h)
                daily_needed_h = float(remaining_h) / max(1, len(workers) * needed_days)
                cross_proj_impact = detect_cross_project_impact(
                    workers, target_start, target_end, project_id, context,
                    needed_daily_h=daily_needed_h,
                    downstream_tasks=cascade["affected_successors"]
                )
                suggestions.append({
                    "id": sugg_id,
                    "type": "delay_conflict",
                    "severity": "high",
                    "title": f"Recupero Fase Scaduta: '{task.text}'",
                    "description": f"La fase è scaduta il {task.end_date.strftime('%d/%m/%Y')} ma mancano ancora {round(planned_h - tot_actual_h, 1)}h al completamento.",
                    "task_id": str(task.id),
                    "task_name": task.text,
                    "strategy": "internal_shift",
                    "strategy_label": "Riprogrammazione da Oggi",
                    "badge": "Recupero Ritardo",
                    "is_alternative": False,
                    "action_label": f"Riprogramma dal {target_start.strftime('%d/%m')} al {target_end.strftime('%d/%m')}",
                    "current_state": {
                        "workers": workers,
                        "start_date": str(task.start_date),
                        "end_date": str(task.end_date),
                        "actual_hours": tot_actual_h,
                        "planned_hours": planned_h
                    },
                    "proposed_changes": {
                        "task_id": str(task.id),
                        "workers": workers,
                        "worker_hours": w_hours_map,
                        "start_date": str(target_start),
                        "end_date": str(target_end),
                        "shift_working_days": days_late
                    },
                    "cascade_impact": {
                        "same_project_tasks": cascade["affected_successors"],
                        "other_projects": cross_proj_impact,
                        "project_deadline_status": "safe",
                        "deadline_message": f"Tutte le fasi a valle rientrano entro la consegna finale ({proj_end_date.strftime('%d/%m/%Y') if proj_end_date else 'N.D.'})."
                    }
                })
            else:
                suggestions.append({
                    "id": sugg_id,
                    "type": "deadline_breach_risk",
                    "severity": "critical",
                    "title": f"Rischio Consegna: Fase '{task.text}'",
                    "description": f"La fase scaduta richiede almeno {needed_days} gg lavorativi per essere completata; l'effetto a cascata supererebbe la consegna finale del {proj_end_date.strftime('%d/%m/%Y')}.",
                    "task_id": str(task.id),
                    "task_name": task.text,
                    "strategy": "manual_action_required",
                    "strategy_label": "Intervento Manuale Necessario",
                    "badge": "Rischio Scadenza",
                    "is_alternative": False,
                    "action_label": "Richiede estensione data commessa o aumento risorse",
                    "current_state": {
                        "workers": workers,
                        "start_date": str(task.start_date),
                        "end_date": str(task.end_date)
                    },
                    "proposed_changes": None,
                    "cascade_impact": {
                        "same_project_tasks": cascade["affected_successors"],
                        "other_projects": [],
                        "project_deadline_status": "breached",
                        "deadline_message": f"Il percorso critico slitta al {cascade['max_reach_date']}, oltre la scadenza del {proj_end_date.strftime('%d/%m/%Y')}."
                    }
                })

    # Estrai cronologia delle modifiche applicate su questa commessa
    log_res = await db.execute(
        select(ReplanLog)
        .options(selectinload(ReplanLog.task), selectinload(ReplanLog.reverted_by_user))
        .where(ReplanLog.project_id == project_id)
        .order_by(desc(ReplanLog.created_at))
        .limit(20)
    )
    history_logs = []
    for log in log_res.scalars().all():
        history_logs.append({
            "id": str(log.id),
            "action_type": log.action_type.value,
            "task_id": str(log.task_id) if log.task_id else None,
            "task_name": log.task.text if log.task else "Fase",
            "worker_name": log.worker_name,
            "reason": log.reason,
            "old_start_date": log.old_start_date.isoformat() if log.old_start_date else None,
            "old_end_date": log.old_end_date.isoformat() if log.old_end_date else None,
            "new_start_date": log.new_start_date.isoformat() if log.new_start_date else None,
            "new_end_date": log.new_end_date.isoformat() if log.new_end_date else None,
            "shift_days": log.shift_days,
            "reverted": log.reverted,
            "created_at": log.created_at.isoformat() if log.created_at else None,
            "reverted_at": log.reverted_at.isoformat() if log.reverted_at else None,
            "reverted_by_name": log.reverted_by_user.full_name if log.reverted_by_user else None
        })

    # Estrai commesse correlate impattate dalle proposte
    related_proj_ids = set()
    for s in suggestions:
        for op in s.get("cascade_impact", {}).get("other_projects", []):
            if op.get("project_id"):
                related_proj_ids.add(str(op["project_id"]))

    related_projects: Dict[str, Dict[str, Any]] = {}
    if related_proj_ids:
        rel_tasks_res = await db.execute(
            select(Task)
            .where(Task.project_id.in_(list(related_proj_ids)))
            .where(Task.type != TaskType.PROJECT)
            .where(Task.type != TaskType.MILESTONE)
            .order_by(Task.sort_order, Task.start_date)
        )
        rel_tasks = rel_tasks_res.scalars().all()
        rel_tasks_by_proj: Dict[str, List[Dict[str, Any]]] = {}
        for rt in rel_tasks:
            rel_tasks_by_proj.setdefault(str(rt.project_id), []).append({
                "id": str(rt.id),
                "text": rt.text,
                "start_date": rt.start_date.isoformat() if rt.start_date else None,
                "end_date": rt.end_date.isoformat() if rt.end_date else None,
                "duration": rt.duration,
                "progress": rt.progress or 0.0,
                "workers": parse_workers_list(rt.workers),
                "worker_hours": parse_worker_hours_map(rt.worker_hours),
                "planned_hours": rt.planned_hours or 0.0,
                "actual_hours": parse_actual_hours_map(rt.actual_hours),
                "department": rt.department,
                "completed": rt.completed or 0
            })

        rel_links_res = await db.execute(
            select(Link).where(Link.project_id.in_(list(related_proj_ids)))
        )
        rel_links = rel_links_res.scalars().all()
        rel_links_by_proj: Dict[str, List[Dict[str, Any]]] = {}
        for rl in rel_links:
            rel_links_by_proj.setdefault(str(rl.project_id), []).append({
                "id": str(rl.id),
                "source": str(rl.source),
                "target": str(rl.target),
                "type": rl.type.value if hasattr(rl.type, 'value') else str(rl.type),
                "lag": rl.lag or 0
            })

        for r_pid in related_proj_ids:
            proj_obj = context["active_projects"].get(r_pid)
            if proj_obj:
                related_projects[r_pid] = {
                    "project_id": str(proj_obj.id),
                    "project_name": proj_obj.name,
                    "project_code": proj_obj.code or "",
                    "project_start_date": proj_obj.start_date.isoformat() if proj_obj.start_date else None,
                    "project_end_date": proj_obj.end_date.isoformat() if proj_obj.end_date else None,
                    "color": proj_obj.color or "#2563eb",
                    "client": proj_obj.client or "",
                    "tasks": rel_tasks_by_proj.get(r_pid, []),
                    "links": rel_links_by_proj.get(r_pid, [])
                }

    return {
        "project_id": str(target_project.id),
        "project_name": target_project.name,
        "project_code": target_project.code or "",
        "project_start_date": str(proj_start_date) if proj_start_date else None,
        "project_end_date": str(proj_end_date) if proj_end_date else None,
        "conflicts_count": len(suggestions),
        "actionable_suggestions_count": len([s for s in suggestions if s.get("proposed_changes")]),
        "suggestions": suggestions,
        "related_projects": related_projects,
        "history": history_logs
    }


async def apply_smart_replanning_proposal(
    db: AsyncSession,
    project_id: str,
    proposal_payload: Dict[str, Any],
    current_user: User
) -> Dict[str, Any]:
    """
    Applica transazionalmente le modifiche proposte da un suggerimento approvato:
    1. Aggiorna il task principale (date e/o addetti e/o ore).
    2. Aggiorna a cascata i successori diretti inclusi nella proposta.
    3. Salva la voce di audit in ReplanLog con reverted=False.
    """
    task_id = proposal_payload.get("task_id")
    if not task_id:
        raise ValueError("Parametro task_id mancante.")

    task_res = await db.execute(select(Task).where(Task.id == task_id))
    task = task_res.scalar_one_or_none()
    if not task:
        raise ValueError("Task non trovato.")

    old_start = task.start_date
    old_end = task.end_date
    old_workers = task.workers

    # 1. Aggiorna date se fornite
    new_start_str = proposal_payload.get("start_date")
    new_end_str = proposal_payload.get("end_date")
    if new_start_str:
        task.start_date = datetime.strptime(new_start_str[:10], "%Y-%m-%d").date()
    if new_end_str:
        task.end_date = datetime.strptime(new_end_str[:10], "%Y-%m-%d").date()

    # Ricalcola durata
    if task.start_date and task.end_date:
        task.duration = get_working_days_count(task.start_date, task.end_date)

    # 2. Aggiorna addetti e ore addetto se forniti
    new_workers = proposal_payload.get("workers")
    if new_workers is not None:
        task.workers = json.dumps(new_workers) if isinstance(new_workers, list) else str(new_workers)
    
    new_w_hours = proposal_payload.get("worker_hours")
    if new_w_hours is not None:
        task.worker_hours = json.dumps(new_w_hours) if isinstance(new_w_hours, dict) else str(new_w_hours)

    # Determina l'azione di log
    shift_days = int(proposal_payload.get("shift_working_days", 0))
    action_type = ReplanActionType.SHIFT_OVERLOAD
    if proposal_payload.get("workers") != json.loads(old_workers or "[]"):
        action_type = ReplanActionType.SHIFT_CONFLICT
    elif shift_days > 0:
        action_type = ReplanActionType.SHIFT_DELAY

    # 3. Salva in ReplanLog
    log_entry = ReplanLog(
        id=str(uuid4()),
        action_type=action_type,
        task_id=task.id,
        project_id=project_id,
        worker_name=", ".join(new_workers) if new_workers else None,
        reason=proposal_payload.get("reason", "Ottimizzazione intelligente applicata"),
        old_start_date=old_start,
        old_end_date=old_end,
        new_start_date=task.start_date,
        new_end_date=task.end_date,
        shift_days=shift_days,
        reverted=False
    )
    db.add(log_entry)

    # 4. Aggiorna a cascata i successori inclusi
    cascade_successors = proposal_payload.get("cascade_successors", [])
    for succ_data in cascade_successors:
        s_id = succ_data.get("task_id")
        s_start_str = succ_data.get("proposed_start")
        s_end_str = succ_data.get("proposed_end")
        if s_id and s_start_str and s_end_str:
            s_res = await db.execute(select(Task).where(Task.id == s_id))
            s_task = s_res.scalar_one_or_none()
            if s_task:
                s_old_start = s_task.start_date
                s_old_end = s_task.end_date
                s_task.start_date = datetime.strptime(s_start_str[:10], "%Y-%m-%d").date()
                s_task.end_date = datetime.strptime(s_end_str[:10], "%Y-%m-%d").date()
                s_task.duration = get_working_days_count(s_task.start_date, s_task.end_date)
                
                # Log successore
                s_log = ReplanLog(
                    id=str(uuid4()),
                    action_type=ReplanActionType.SHIFT_CASCADE,
                    task_id=s_task.id,
                    project_id=project_id,
                    worker_name=s_task.workers,
                    reason=f"Slittamento a cascata dipendente da '{task.text}'",
                    old_start_date=s_old_start,
                    old_end_date=s_old_end,
                    new_start_date=s_task.start_date,
                    new_end_date=s_task.end_date,
                    shift_days=int(succ_data.get("shift_working_days", 0)),
                    reverted=False
                )
                db.add(s_log)

    await db.commit()
    await db.refresh(task)

    return {
        "success": True,
        "message": f"Suggerimento per '{task.text}' applicato con successo.",
        "log_id": str(log_entry.id),
        "task": {
            "id": str(task.id),
            "start_date": task.start_date.isoformat() if task.start_date else None,
            "end_date": task.end_date.isoformat() if task.end_date else None,
            "workers": parse_workers_list(task.workers),
            "worker_hours": parse_worker_hours_map(task.worker_hours)
        }
    }


async def revert_smart_replanning_log(
    db: AsyncSession,
    log_id: str,
    current_user: User
) -> Dict[str, Any]:
    """
    Annulla una modifica precedentemente applicata ripristinando date e addetti
    registrati in ReplanLog.
    """
    res = await db.execute(select(ReplanLog).where(ReplanLog.id == log_id))
    log_entry = res.scalar_one_or_none()
    if not log_entry:
        raise ValueError("Voce di cronologia non trovata.")
    if log_entry.reverted:
        raise ValueError("Questa operazione è già stata annullata in precedenza.")

    if log_entry.task_id:
        task_res = await db.execute(select(Task).where(Task.id == log_entry.task_id))
        task = task_res.scalar_one_or_none()
        if task:
            if log_entry.old_start_date:
                task.start_date = log_entry.old_start_date
            if log_entry.old_end_date:
                task.end_date = log_entry.old_end_date
            if task.start_date and task.end_date:
                task.duration = get_working_days_count(task.start_date, task.end_date)

    log_entry.reverted = True
    log_entry.reverted_at = datetime.now(timezone.utc)
    log_entry.reverted_by = current_user.id

    await db.commit()

    return {
        "success": True,
        "message": "Operazione annullata e stato precedente ripristinato con successo.",
        "log_id": str(log_entry.id)
    }
