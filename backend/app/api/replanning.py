from typing import List, Dict, Any
# pyrefly: ignore [missing-import]
from pydantic import BaseModel
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException, status
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select, desc
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_db, get_current_user
from app.models.user import User, UserRole
from app.models.replan_log import ReplanLog
from app.services.replanning_service import get_replanning_suggestions, execute_suggestion, revert_action

router = APIRouter(prefix="/api/replanning", tags=["replanning"])


@router.get("/suggestions")
async def get_suggestions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role not in [UserRole.ADMIN, UserRole.EDITOR]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso negato. Solo admin ed editor possono vedere i suggerimenti.")
        
    suggestions = await get_replanning_suggestions(db)
    return suggestions


class ExecuteSuggestionPayload(BaseModel):
    action_type: str
    action_payload: dict


@router.post("/execute")
async def execute_suggestion_endpoint(
    payload: ExecuteSuggestionPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role not in [UserRole.ADMIN, UserRole.EDITOR]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo admin ed editor possono eseguire azioni di ripianificazione.")
        
    success = await execute_suggestion(db, payload.action_type, payload.action_payload, current_user)
    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Impossibile eseguire il suggerimento. Potrebbe essere obsoleto.")
        
    return {"message": "Azione eseguita con successo."}


@router.get("/logs")
async def get_replanning_logs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role not in [UserRole.ADMIN, UserRole.EDITOR]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso negato.")
        
    res = await db.execute(
        select(ReplanLog)
        .options(selectinload(ReplanLog.task), selectinload(ReplanLog.project), selectinload(ReplanLog.reverted_by_user))
        .order_by(desc(ReplanLog.created_at))
        .limit(200)
    )
    logs = res.scalars().all()
    
    results = []
    for log in logs:
        results.append({
            "id": log.id,
            "action_type": log.action_type.value,
            "task_id": log.task_id,
            "task_name": log.task.text if log.task else "Fase eliminata",
            "project_id": log.project_id,
            "project_name": log.project.name if log.project else "Commessa sconosciuta",
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
    return results


@router.post("/revert/{log_id}")
async def revert_replanning_action(
    log_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role not in [UserRole.ADMIN, UserRole.EDITOR]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo admin ed editor possono revocare azioni.")
        
    success = await revert_action(db, log_id, current_user)
    if not success:
        raise HTTPException(status_code=400, detail="Impossibile revocare l'azione.")
        
    return {"message": "Azione revocata con successo."}
