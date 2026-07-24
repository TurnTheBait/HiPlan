from typing import List
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
import os
import uuid
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

import json

router = APIRouter(prefix="/api/notes", tags=["notes"])

def _serialize_note(note: Note) -> dict:
    attachments_list = []
    if note.attachments:
        try:
            parsed_att = json.loads(note.attachments)
            if isinstance(parsed_att, list):
                attachments_list = parsed_att
        except:
            pass
            
    # Serialize the owner if it exists
    owner_data = None
    if getattr(note, "owner", None):
        owner_data = {
            "id": note.owner.id,
            "username": note.owner.username,
            "full_name": note.owner.full_name,
            "email": note.owner.email,
            "role": note.owner.role,
            "is_active": note.owner.is_active,
            "department": getattr(note.owner, "department", None),
            "created_at": note.owner.created_at,
        }
        
    return {
        "id": note.id,
        "title": note.title,
        "content": note.content,
        "is_shared": note.is_shared,
        "owner_id": note.owner_id,
        "owner": owner_data,
        "attachments": attachments_list,
        "created_at": note.created_at,
        "updated_at": note.updated_at
    }


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
    notes = result.scalars().all()
    return [_serialize_note(n) for n in notes]


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
    loaded_note = result.scalar_one()
    return _serialize_note(loaded_note)


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
        
    return _serialize_note(note)


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
    loaded_note = result.scalar_one()
    return _serialize_note(loaded_note)


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

NOTES_UPLOAD_DIR = "uploads/notes"
os.makedirs(NOTES_UPLOAD_DIR, exist_ok=True)
MAX_FILE_SIZE_MB = 10

@router.post("/{note_id}/attachments")
async def upload_note_attachment(
    note_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # pyrefly: ignore [missing-import]
    from sqlalchemy import select
    from app.models.note import Note
    
    result = await db.execute(select(Note).where(Note.id == note_id))
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Nota non trovata")
        
    if note.owner_id != current_user.id:
        if not note.is_shared:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non hai i permessi per modificare questa nota")
        if current_user.role != UserRole.ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo l'autore o un amministratore può modificare questa nota condivisa")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File troppo grande (max {MAX_FILE_SIZE_MB}MB)")

    ext = os.path.splitext(file.filename or "")[1]
    filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(NOTES_UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    attachments = []
    if note.attachments:
        try:
            attachments = json.loads(note.attachments)
            if not isinstance(attachments, list):
                attachments = []
        except:
            pass

    new_att = {"name": file.filename, "path": f"uploads/notes/{filename}"}
    attachments.append(new_att)
    note.attachments = json.dumps(attachments)
    await db.commit()

    return new_att

@router.delete("/{note_id}/attachments/{filename}")
async def delete_note_attachment(
    note_id: str,
    filename: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # pyrefly: ignore [missing-import]
    from sqlalchemy import select
    from app.models.note import Note
    
    result = await db.execute(select(Note).where(Note.id == note_id))
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=404, detail="Nota non trovata")

    if note.owner_id != current_user.id:
        if not note.is_shared:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non hai i permessi per modificare questa nota")
        if current_user.role != UserRole.ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo l'autore o un amministratore può modificare questa nota condivisa")

    attachments = []
    if note.attachments:
        try:
            attachments = json.loads(note.attachments)
            if not isinstance(attachments, list):
                attachments = []
        except:
            pass

    new_attachments = []
    found = False
    for att in attachments:
        att_name = att.get("name", "")
        att_path = att.get("path", "")
        if att_name == filename or att_path.endswith(filename):
            found = True
            filepath = att.get("path")
            if filepath and os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except:
                    pass
        else:
            new_attachments.append(att)

    if not found:
        raise HTTPException(status_code=404, detail="Allegato non trovato")

    note.attachments = json.dumps(new_attachments)
    await db.commit()
    return {"status": "ok"}

