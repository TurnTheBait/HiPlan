import json
from datetime import datetime, timedelta
from typing import List, Dict, Any
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.dependencies import get_db, get_current_user
from app.models.user import User
from app.models.task import Task

router = APIRouter(prefix="/api/workload", tags=["workload"])

@router.get("/heatmap")
async def get_workload_heatmap(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> Dict[str, Any]:
    # Restituisce una struttura dati con il carico giornaliero per ogni utente
    # { user_id: { "full_name": "...", "workload": { "YYYY-MM-DD": { "hours": 8, "tasks": [...] } } } }
    
    from sqlalchemy.orm import joinedload
    users_res = await db.execute(select(User).where(User.is_active == True))
    users = users_res.scalars().all()
    
    tasks_res = await db.execute(select(Task).options(joinedload(Task.project)))
    tasks = tasks_res.scalars().all()
    
    heatmap = {}
    for u in users:
        heatmap[str(u.id)] = {
            "full_name": u.full_name or u.username,
            "department": u.department,
            "workload": {}
        }
        
    for task in tasks:
        if not task.start_date or not task.end_date:
            continue
            
        # Determina gli addetti assegnati
        assigned_workers = []
        try:
            workers_list = json.loads(task.workers) if task.workers else []
            for w in workers_list:
                assigned_workers.append(w)
        except:
            pass
            
        if not assigned_workers:
            continue
            
        # Trova gli ID e i nomi degli utenti partendo dai nomi
        worker_info = []
        for w_name in assigned_workers:
            for u in users:
                if (u.full_name and w_name.lower() in u.full_name.lower()) or (u.username and w_name.lower() in u.username.lower()):
                    worker_info.append({"id": str(u.id), "name": w_name})
                    break
                    
        if not worker_info:
            continue
            
        # Calcola le ore giornaliere per ciascun addetto basandoci sulle ore assegnate previste
        start_date = task.start_date
        end_date = task.end_date
        
        # Array di giorni (incluso start e end)
        delta = end_date - start_date
        days = []
        for i in range(delta.days + 1):
            day = start_date + timedelta(days=i)
            if day.weekday() < 5:  # Solo giorni lavorativi (Lun-Ven)
                days.append(day)
                
        if not days:
            continue
            
        worker_hours_map = {}
        try:
            worker_hours_map = json.loads(getattr(task, 'worker_hours', '{}')) or {}
        except:
            worker_hours_map = {}

        planned_hours = task.planned_hours or 0.0
        
        for winfo in worker_info:
            w_id = winfo["id"]
            w_name = winfo["name"]
            
            # Ore previste/assegnate al singolo addetto per questa fase (non a consuntivo)
            if w_name in worker_hours_map and worker_hours_map[w_name] is not None:
                try:
                    assigned_total = float(worker_hours_map[w_name])
                except:
                    assigned_total = planned_hours / len(worker_info)
            else:
                assigned_total = planned_hours / len(worker_info)
                
            hours_per_day = assigned_total / len(days)
            
            for day in days:
                date_str = day.strftime("%Y-%m-%d")
                if date_str not in heatmap[w_id]["workload"]:
                    heatmap[w_id]["workload"][date_str] = {"hours": 0.0, "tasks": []}
                
                heatmap[w_id]["workload"][date_str]["hours"] += hours_per_day
                heatmap[w_id]["workload"][date_str]["tasks"].append({
                    "id": str(task.id),
                    "name": task.text,
                    "project_name": task.project.name if task.project else "Progetto non specificato",
                    "hours": hours_per_day,
                    "total_assigned_hours": assigned_total
                })
                
    return {"heatmap": heatmap}
