from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.dependencies import get_db, get_current_user, require_role
from app.models.user import User, UserRole
from app.models.worker import PhaseWorker
from app.schemas.worker import PhaseWorkerCreate, PhaseWorkerOut

router = APIRouter(prefix="/api/workers", tags=["workers"])

DEFAULT_WORKERS = ['Alessio', 'Edoardo', 'Ermal', 'Luca', 'Marco', 'Michelangelo', 'Cliente']


@router.get("", response_model=List[PhaseWorkerOut])
async def list_workers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    workers = (await db.execute(select(PhaseWorker).where(PhaseWorker.is_active == True).order_by(PhaseWorker.name))).scalars().all()
    if not workers and (await db.execute(select(PhaseWorker))).scalars().first() is None:
        # Se la tabella è completamente vuota all'inizio, inseriamo i predefiniti
        for name in DEFAULT_WORKERS:
            w = PhaseWorker(name=name)
            db.add(w)
        await db.commit()
        workers = (await db.execute(select(PhaseWorker).where(PhaseWorker.is_active == True).order_by(PhaseWorker.name))).scalars().all()
    return workers


@router.post("", response_model=PhaseWorkerOut, status_code=status.HTTP_201_CREATED)
async def create_worker(
    data: PhaseWorkerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    name_clean = data.name.strip()
    if not name_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Il nome dell'addetto non può essere vuoto")

    existing = (await db.execute(select(PhaseWorker).where(PhaseWorker.name == name_clean))).scalar_one_or_none()
    if existing:
        if not existing.is_active:
            existing.is_active = True
            await db.commit()
            await db.refresh(existing)
            return existing
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Questo addetto esiste già nel sistema")

    worker = PhaseWorker(name=name_clean)
    db.add(worker)
    await db.commit()
    await db.refresh(worker)
    return worker


@router.delete("/{worker_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_worker(
    worker_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN)),
):
    result = await db.execute(select(PhaseWorker).where(PhaseWorker.id == worker_id))
    worker = result.scalar_one_or_none()
    if not worker:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Addetto non trovato")
    await db.delete(worker)
    await db.commit()
    return None
