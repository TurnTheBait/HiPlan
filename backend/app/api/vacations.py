from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.dependencies import get_db, get_current_user
from app.models.user import User
from app.models.vacation import Vacation
from app.schemas.user import UserOut
from pydantic import BaseModel
from datetime import date
from app.models.notification import Notification, NotificationType

router = APIRouter(prefix="/api/me/vacations", tags=["vacations"])


class VacationCreate(BaseModel):
    start_date: date
    end_date: date
    reason: str | None = None


@router.get("", response_model=list)
async def list_my_vacations(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Vacation).where(Vacation.user_id == current_user.id).order_by(Vacation.start_date.desc()))
    vacations = result.scalars().all()
    return [
        {
            "id": v.id,
            "user_id": v.user_id,
            "start_date": str(v.start_date),
            "end_date": str(v.end_date),
            "reason": v.reason,
            "created_at": v.created_at.isoformat() if v.created_at else None,
            "updated_at": v.updated_at.isoformat() if v.updated_at else None,
        }
        for v in vacations
    ]


@router.post("", status_code=201)
async def create_my_vacation(data: VacationCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    if data.end_date < data.start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="end_date must be >= start_date")
    vac = Vacation(user_id=current_user.id, start_date=data.start_date, end_date=data.end_date, reason=data.reason)
    db.add(vac)
    await db.commit()
    await db.refresh(vac)

    # Create a notification to the user confirming vacation creation
    note = Notification(
        user_id=current_user.id,
        title="Ferie inserite",
        message=f"Ferie dal {data.start_date} al {data.end_date} registrate.",
        type=NotificationType.UPDATE,
    )
    db.add(note)
    await db.commit()

    return {"ok": True, "id": vac.id}


@router.delete("/{vacation_id}")
async def delete_my_vacation(vacation_id: str, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Vacation).where(Vacation.id == vacation_id, Vacation.user_id == current_user.id))
    vac = result.scalar_one_or_none()
    if not vac:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vacanza non trovata")
    await db.delete(vac)
    await db.commit()
    return {"ok": True}
