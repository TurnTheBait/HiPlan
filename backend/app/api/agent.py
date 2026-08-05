"""
Router API per l'Agente di Ripianificazione.
"""
from typing import List, Optional
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException, Query
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select, desc
from pydantic import BaseModel
from datetime import date

from app.core.dependencies import get_db, get_current_user, require_role
from app.models.user import User, UserRole
from app.models.agent_log import AgentLog
from app.services.rescheduling_agent import (
    is_agent_enabled,
    set_agent_enabled,
    get_agent_status,
    run_rescheduling_agent,
    revert_agent_log,
)

router = APIRouter(prefix="/api/agent", tags=["agent"])


# ---------------------------------------------------------------------------
# Schemi Pydantic
# ---------------------------------------------------------------------------

class AgentStatusOut(BaseModel):
    enabled: bool
    last_run: Optional[str] = None
    last_toggled: Optional[str] = None

    class Config:
        from_attributes = True


class AgentLogOut(BaseModel):
    id: str
    action_type: str
    task_id: Optional[str] = None
    task_name: str
    project_id: Optional[str] = None
    project_name: str
    project_code: Optional[str] = None
    worker: Optional[str] = None
    old_start_date: Optional[date] = None
    old_end_date: Optional[date] = None
    old_duration: Optional[int] = None
    new_start_date: Optional[date] = None
    new_end_date: Optional[date] = None
    new_duration: Optional[int] = None
    reason: Optional[str] = None
    reverted: int
    reverted_at: Optional[str] = None
    reverted_by: Optional[str] = None
    created_at: Optional[str] = None

    class Config:
        from_attributes = True


class AgentRunResult(BaseModel):
    phases_rescheduled: int
    cascade_rescheduled: int
    conflicts_detected: int
    vacation_conflicts: int
    lag_detected: int
    overbooking_resolved: int
    errors: List[str]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/status", response_model=AgentStatusOut)
async def agent_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Restituisce lo stato corrente dell'agente (abilitato/disabilitato + ultima esecuzione)."""
    status = await get_agent_status(db)
    return AgentStatusOut(**status)


@router.post("/toggle")
async def toggle_agent(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    """Attiva o disattiva l'agente a livello globale (solo admin)."""
    currently_enabled = await is_agent_enabled(db)
    await set_agent_enabled(db, not currently_enabled)
    return {
        "enabled": not currently_enabled,
        "message": f"Agente {'attivato' if not currently_enabled else 'disattivato'} con successo.",
    }


@router.post("/run-now", response_model=AgentRunResult)
async def run_agent_now(
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    """Esegui l'agente immediatamente (solo admin)."""
    result = await run_rescheduling_agent(dry_run=False)
    return AgentRunResult(**result)


@router.post("/analyze", response_model=AgentRunResult)
async def analyze_agent_now(
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    """Analizza la situazione immediatamente ma senza salvare le modifiche (dry-run, solo admin)."""
    result = await run_rescheduling_agent(dry_run=True)
    return AgentRunResult(**result)


@router.get("/logs", response_model=List[AgentLogOut])
async def get_agent_logs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    action_type: Optional[str] = Query(None),
    worker: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    include_reverted: bool = Query(True),
):
    """
    Recupera la lista dei log dell'agente con filtri opzionali.
    Accessibile a tutti gli utenti autenticati (sola lettura).
    """
    q = select(AgentLog).order_by(desc(AgentLog.created_at))

    if action_type:
        q = q.where(AgentLog.action_type == action_type)
    if worker:
        q = q.where(AgentLog.worker.ilike(f"%{worker}%"))
    if project_id:
        q = q.where(AgentLog.project_id == project_id)
    if not include_reverted:
        q = q.where(AgentLog.reverted == 0)

    q = q.offset(skip).limit(limit)
    res = await db.execute(q)
    logs = res.scalars().all()

    return [
        AgentLogOut(
            id=log.id,
            action_type=log.action_type,
            task_id=log.task_id,
            task_name=log.task_name or "",
            project_id=log.project_id,
            project_name=log.project_name or "",
            project_code=log.project_code,
            worker=log.worker,
            old_start_date=log.old_start_date,
            old_end_date=log.old_end_date,
            old_duration=log.old_duration,
            new_start_date=log.new_start_date,
            new_end_date=log.new_end_date,
            new_duration=log.new_duration,
            reason=log.reason,
            reverted=log.reverted or 0,
            reverted_at=log.reverted_at,
            reverted_by=log.reverted_by,
            created_at=log.created_at.isoformat() if log.created_at else None,
        )
        for log in logs
    ]


@router.post("/logs/{log_id}/revert")
async def revert_log(
    log_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    """
    Revoca un'azione dell'agente ripristinando le date originali della fase.
    Solo admin.
    """
    result = await revert_agent_log(log_id, current_user.username)
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error", "Errore durante la revoca"))
    return {"ok": True, "message": "Azione revocata con successo. Le date originali sono state ripristinate."}
