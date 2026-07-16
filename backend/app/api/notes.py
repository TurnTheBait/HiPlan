from typing import List
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException, status
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import selectinload
from app.core.dependencies import get_db, get_current_user
from app.models.user import User, UserRole
from app.models.note import Note
from app.schemas.note import NoteCreate, NoteUpdate, NoteOut

router = APIRouter(prefix="/api/notes", tags=["notes"])


@router.get("", response_model=List[NoteOut])
async def list_notes(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = (
        select(Note)
        .options(selectinload(Note.owner))
        .where((Note.owner_id == current_user.id) | (Note.is_shared == True))
        .order_by(Note.updated_at.desc())
    )
    result = await db.execute(query)
    return result.scalars().all()


@router.post("", response_model=NoteOut, status_code=status.HTTP_201_CREATED)
async def create_note(
    data: NoteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    title_clean = data.title.strip() if data.title else "Nuova Nota"
    note = Note(
        title=title_clean or "Nuova Nota",
        content=data.content or "",
        is_shared=data.is_shared,
        owner_id=current_user.id,
    )
    db.add(note)
    await db.commit()
    
    # Ricarica con eager loading per owner
    result = await db.execute(
        select(Note).options(selectinload(Note.owner)).where(Note.id == note.id)
    )
    return result.scalar_one()


@router.get("/{note_id}", response_model=NoteOut)
async def get_note(
    note_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Note).options(selectinload(Note.owner)).where(Note.id == note_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nota non trovata")
    
    if note.owner_id != current_user.id and not note.is_shared:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non hai i permessi per visualizzare questa nota privata")
        
    return note


@router.patch("/{note_id}", response_model=NoteOut)
async def update_note(
    note_id: str,
    data: NoteUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Note).options(selectinload(Note.owner)).where(Note.id == note_id)
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nota non trovata")

    if note.owner_id != current_user.id:
        if not note.is_shared:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non hai i permessi per modificare questa nota privata")
        if current_user.role != UserRole.ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo l'autore o un amministratore può modificare questa nota condivisa")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key == "title" and value is not None:
            setattr(note, key, value.strip() or "Senza Titolo")
        else:
            setattr(note, key, value)

    await db.commit()
    
    # Ricarica aggiornato
    result = await db.execute(
        select(Note).options(selectinload(Note.owner)).where(Note.id == note_id)
    )
    return result.scalar_one()


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_note(
    note_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Note).where(Note.id == note_id))
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nota non trovata")

    if note.owner_id != current_user.id:
        if not note.is_shared:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non hai i permessi per eliminare questa nota privata")
        if current_user.role != UserRole.ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo l'autore o un amministratore può eliminare questa nota condivisa")

    await db.delete(note)
    await db.commit()
    return None
