# pyrefly: ignore [missing-import]
from pydantic import BaseModel, Field
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException
# pyrefly: ignore [missing-import]
from sqlalchemy import select
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user, get_db, require_role
from app.models.user import User, UserRole
from app.models.project import Project
from app.models.activity_log import ActivityCategory, ActivityLog
from app.core.websocket_manager import manager
from app.services.rescheduling_service import (
    analyze_all_projects,
    analyze_project,
    apply_advancement_rescheduling,
    apply_rescheduling,
    detect_advancement_scenarios,
    list_runs,
    preview_rescheduling,
    undo_rescheduling,
)


router = APIRouter(
    prefix="/api/projects/{project_id}/rescheduling",
    tags=["Rescheduling"],
)


class ReschedulingRequest(BaseModel):
    task_ids: list[str] = Field(default_factory=list)


class AgentPauseRequest(BaseModel):
    paused: bool


@router.get("")
async def get_rescheduling_overview(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    project = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Commessa non trovata")
    paused = bool(project.planning_agent_paused)
    preview = await preview_rescheduling(db, project_id)
    return {
        "paused": paused,
        "scenarios": await analyze_project(db, project_id),
        "preview": preview,
        "runs": await list_runs(db, project_id),
    }


@router.post("/pause")
async def set_agent_pause(
    project_id: str,
    payload: AgentPauseRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN, UserRole.EDITOR)),
):
    project = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Commessa non trovata")
    project.planning_agent_paused = payload.paused
    db.add(ActivityLog(
        project_id=project_id,
        user_id=current_user.id,
        category=ActivityCategory.PHASE_PROJECT_EDIT,
        action_text=(
            "[Agente pianificazione] Agente messo in pausa per la commessa"
            if payload.paused
            else "[Agente pianificazione] Agente riattivato per la commessa"
        ),
    ))
    await db.commit()
    await manager.broadcast(project_id, {
        "action": "planning_agent_pause_changed",
        "paused": payload.paused,
    })
    return {"paused": payload.paused}


@router.post("/apply")
async def run_rescheduling(
    project_id: str,
    payload: ReschedulingRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN, UserRole.EDITOR)),
):
    # Ogni esecuzione manuale riparte dallo stato globale attuale. La commessa
    # aperta viene inclusa anche se il suo agente è in pausa, perché il comando
    # esplicito "Applica ora" deve continuare a essere disponibile.
    current_scenarios = await analyze_all_projects(db, include_paused_project_id=project_id)
    actionable = [s for s in current_scenarios if s.get("actionable") and s.get("missing_hours", 0) >= 0.5]
    if actionable:
        return await apply_rescheduling(
            db,
            project_id,
            current_user,
            payload.task_ids,
            allow_when_paused=True,
            precomputed_scenarios=current_scenarios,
        )
    # Nessun ritardo: prova ad applicare eventuali anticipi
    advancement_scenarios = await detect_advancement_scenarios(db, include_paused_project_id=project_id)
    if advancement_scenarios:
        return await apply_advancement_rescheduling(
            db,
            project_id,
            current_user,
            advancement_scenarios=advancement_scenarios,
        )
    from fastapi import HTTPException as _HTTPException
    raise _HTTPException(status_code=400, detail="Nessuna modifica necessaria nello scenario attuale")


@router.post("/{run_id}/undo")
async def undo_rescheduling_run(
    project_id: str,
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN, UserRole.EDITOR)),
):
    return await undo_rescheduling(db, project_id, run_id, current_user)
