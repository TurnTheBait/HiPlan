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
    analyze_project,
    apply_rescheduling,
    list_runs,
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
    return {
        "paused": bool(project.planning_agent_paused),
        "scenarios": await analyze_project(db, project_id),
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
    return await apply_rescheduling(
        db,
        project_id,
        current_user,
        payload.task_ids,
        allow_when_paused=True,
    )


@router.post("/{run_id}/undo")
async def undo_rescheduling_run(
    project_id: str,
    run_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN, UserRole.EDITOR)),
):
    return await undo_rescheduling(db, project_id, run_id, current_user)
