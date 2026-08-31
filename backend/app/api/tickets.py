import json
import os
import uuid
from typing import List, Optional
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
# pyrefly: ignore [missing-import]
from fastapi.responses import FileResponse, StreamingResponse
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_db, get_current_user
from app.models.setting import Setting
from app.models.user import User, UserRole
from app.models.ticket import Ticket, TicketReply, TicketStatus, TicketPriority
from app.models.notification import Notification, NotificationType
from app.schemas.ticket import TicketCreate, TicketUpdate, TicketOut, TicketReplyCreate, TicketReplyOut, TicketReplyUpdate
from app.services import export_service

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

UPLOAD_DIR = "uploads/tickets"
os.makedirs(UPLOAD_DIR, exist_ok=True)

MAX_FILE_SIZE_MB = 20


def _serialize_ticket(ticket: Ticket, include_replies: bool = True) -> dict:
    """Convert a Ticket ORM object to a dict suitable for TicketOut."""
    assigned = json.loads(ticket.assigned_to) if ticket.assigned_to else []
    attachments = json.loads(ticket.attachments) if ticket.attachments else []

    replies_out = []
    if include_replies and ticket.replies:
        for r in ticket.replies:
            replies_out.append({
                "id": r.id,
                "ticket_id": r.ticket_id,
                "author_id": r.author_id,
                "author_username": r.author.username if r.author else None,
                "author_full_name": r.author.full_name if r.author else None,
                "content": r.content,
                "action_type": r.action_type,
                "attachments": json.loads(r.attachments) if r.attachments else [],
                "created_at": r.created_at,
                "updated_at": r.updated_at,
            })

    return {
        "id": ticket.id,
        "title": ticket.title,
        "description": ticket.description,
        "project_id": ticket.project_id,
        "project_name": ticket.project.name if ticket.project else None,
        "project_code": ticket.project.code if ticket.project else None,
        "custom_project_code": ticket.custom_project_code,
        "author_id": ticket.author_id,
        "author_username": ticket.author.username if ticket.author else None,
        "author_full_name": ticket.author.full_name if ticket.author else None,
        "responsible_id": ticket.responsible_id,
        "responsible_username": ticket.responsible.username if ticket.responsible else None,
        "responsible_full_name": ticket.responsible.full_name if ticket.responsible else None,
        "assigned_to": assigned,
        "attachments": attachments,
        "status": ticket.status.value if hasattr(ticket.status, "value") else ticket.status,
        "priority": ticket.priority.value if hasattr(ticket.priority, "value") else ticket.priority,
        "replies": replies_out,
        "reply_count": len(replies_out),
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
    }


async def _check_ticket_access(ticket: Ticket, current_user: User, db: AsyncSession):
    res = await db.execute(select(Setting).where(Setting.key == "ticket_observers"))
    setting = res.scalar_one_or_none()
    observers = []
    if setting and setting.value:
        try:
            observers = json.loads(setting.value)
        except Exception:
            pass

    if current_user.role == UserRole.ADMIN or current_user.username in observers:
        return

    assigned = json.loads(ticket.assigned_to) if ticket.assigned_to else []
    if current_user.id != ticket.author_id and current_user.id != ticket.responsible_id and current_user.username not in assigned:
        raise HTTPException(status_code=403, detail="Non hai i permessi per accedere a questo ticket")


async def _notify_for_ticket(db: AsyncSession, ticket: Ticket, message: str, current_user: User):
    """Send notifications for a ticket. Notifies assigned users or all users if none assigned."""
    assigned = json.loads(ticket.assigned_to) if ticket.assigned_to else []

    if assigned:
        res = await db.execute(select(User).where(User.username.in_(assigned), User.is_active == True))
        target_users = res.scalars().all()
    else:
        res = await db.execute(select(User).where(User.is_active == True))
        target_users = res.scalars().all()

    for u in target_users:
        if u.id == current_user.id:
            continue  # don't notify yourself
        notif = Notification(
            user_id=u.id,
            title=f"🎫 Nuovo Ticket: {ticket.title}",
            message=message,
            type=NotificationType.UPDATE,
            project_id=ticket.project_id,
        )
        db.add(notif)


@router.get("", response_model=List[TicketOut])
async def list_tickets(
    status_filter: Optional[str] = Query(None, alias="status"),
    project_id: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = (
        select(Ticket)
        .options(
            selectinload(Ticket.author),
            selectinload(Ticket.responsible),
            selectinload(Ticket.project),
            selectinload(Ticket.replies).selectinload(TicketReply.author),
        )
        .order_by(Ticket.created_at.desc())
    )
    if status_filter:
        query = query.where(Ticket.status == status_filter)
    if project_id:
        query = query.where(Ticket.project_id == project_id)
    if priority:
        query = query.where(Ticket.priority == priority)

    res = await db.execute(select(Setting).where(Setting.key == "ticket_observers"))
    setting = res.scalar_one_or_none()
    observers = []
    if setting and setting.value:
        try:
            observers = json.loads(setting.value)
        except Exception:
            pass

    result = await db.execute(query)
    tickets = result.scalars().all()
    
    visible_tickets = []
    for t in tickets:
        if current_user.role == UserRole.ADMIN or current_user.username in observers:
            visible_tickets.append(t)
            continue
            
        assigned = json.loads(t.assigned_to) if t.assigned_to else []
        if t.author_id == current_user.id or t.responsible_id == current_user.id or current_user.username in assigned:
            visible_tickets.append(t)
            continue
        
    return [_serialize_ticket(t) for t in visible_tickets]


@router.post("", response_model=TicketOut, status_code=status.HTTP_201_CREATED)
async def create_ticket(
    data: TicketCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ticket = Ticket(
        title=data.title.strip(),
        description=data.description or "",
        project_id=data.project_id or None,
        custom_project_code=data.custom_project_code or None,
        author_id=current_user.id,
        responsible_id=data.responsible_id or current_user.id,
        assigned_to=json.dumps(data.assigned_to or []),
        attachments=json.dumps([]),
        status=TicketStatus.DA_GESTIRE,
        priority=data.priority or "medium",
    )
    db.add(ticket)
    await db.flush()

    # Send notifications
    assigned_str = ", ".join(data.assigned_to) if data.assigned_to else "tutti"
    msg = f"{current_user.full_name or current_user.username} ha aperto un ticket: \"{data.title}\""
    if data.assigned_to:
        msg += f" (assegnato a: {assigned_str})"
    await _notify_for_ticket(db, ticket, msg, current_user)

    await db.commit()

    # Reload with relations
    result = await db.execute(
        select(Ticket)
        .options(
            selectinload(Ticket.author),
            selectinload(Ticket.responsible),
            selectinload(Ticket.project),
            selectinload(Ticket.replies).selectinload(TicketReply.author),
        )
        .where(Ticket.id == ticket.id)
    )
    ticket = result.scalar_one()
    return _serialize_ticket(ticket)


@router.get("/{ticket_id}", response_model=TicketOut)
async def get_ticket(
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Ticket)
        .options(
            selectinload(Ticket.author),
            selectinload(Ticket.responsible),
            selectinload(Ticket.project),
            selectinload(Ticket.replies).selectinload(TicketReply.author),
        )
        .where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
    await _check_ticket_access(ticket, current_user, db)
    return _serialize_ticket(ticket)


@router.patch("/{ticket_id}", response_model=TicketOut)
async def update_ticket(
    ticket_id: str,
    data: TicketUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Ticket)
        .options(
            selectinload(Ticket.author),
            selectinload(Ticket.responsible),
            selectinload(Ticket.project),
            selectinload(Ticket.replies).selectinload(TicketReply.author),
        )
        .where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")

    if ticket.author_id != current_user.id and ticket.responsible_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Solo l'autore, il responsabile o un amministratore può modificare il ticket")

    if data.title is not None:
        ticket.title = data.title.strip()
    if data.description is not None:
        ticket.description = data.description
    # Usa exclude_unset per distinguere i campi inviati esplicitamente (anche con valore null = "rimuovi")
    _payload = data.model_dump(exclude_unset=True)
    if 'project_id' in _payload:
        ticket.project_id = _payload.get('project_id') or None
        if ticket.project_id:
            ticket.custom_project_code = None
    if 'custom_project_code' in _payload:
        ticket.custom_project_code = _payload.get('custom_project_code') or None
        if ticket.custom_project_code:
            ticket.project_id = None
    if data.responsible_id is not None:
        ticket.responsible_id = data.responsible_id or None
    if data.assigned_to is not None:
        ticket.assigned_to = json.dumps(data.assigned_to)
    if data.priority is not None:
        ticket.priority = data.priority
        
    status_changed = False
    old_status = None
    new_status = None
    if data.status is not None and data.status != ticket.status:
        if ticket.status == TicketStatus.COMPLETATO and current_user.role != UserRole.ADMIN:
            raise HTTPException(status_code=403, detail="Solo un amministratore può riaprire o modificare lo stato di un ticket completato")
        status_changed = True
        old_status = ticket.status
        new_status = data.status
        ticket.status = data.status

    if status_changed:
        old_val = old_status.value if hasattr(old_status, 'value') else old_status
        new_val = new_status.value if hasattr(new_status, 'value') else new_status
        reply = TicketReply(
            ticket_id=ticket.id,
            author_id=current_user.id,
            content=f'Stato modificato da "{old_val}" a "{new_val}"',
            action_type="🔄 Cambio Stato",
            attachments="[]"
        )
        db.add(reply)

    await db.commit()

    result = await db.execute(
        select(Ticket)
        .options(
            selectinload(Ticket.author),
            selectinload(Ticket.responsible),
            selectinload(Ticket.project),
            selectinload(Ticket.replies).selectinload(TicketReply.author),
        )
        .where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one()
    return _serialize_ticket(ticket)


@router.delete("/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_ticket(
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Ticket).where(Ticket.id == ticket_id))
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
    if ticket.author_id != current_user.id and ticket.responsible_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Solo l'autore, il responsabile o un amministratore può eliminare il ticket")
    await db.delete(ticket)
    await db.commit()
    return None


@router.post("/{ticket_id}/replies", response_model=TicketOut)
async def add_reply(
    ticket_id: str,
    data: TicketReplyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Ticket).where(Ticket.id == ticket_id))
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
    await _check_ticket_access(ticket, current_user, db)
    if ticket.status == TicketStatus.COMPLETATO:
        raise HTTPException(status_code=400, detail="Impossibile rispondere a un ticket completato")

    # Check automatic status changes based on action_type
    new_status = None
    action_lower = data.action_type.lower() if data.action_type else ""
    if "inviato al cliente" in action_lower:
        new_status = TicketStatus.IN_ATTESA
    elif "risposta dal cliente" in action_lower or "intervento tecnico" in action_lower:
        new_status = TicketStatus.DA_GESTIRE
    elif "risoluzione" in action_lower:
        new_status = TicketStatus.COMPLETATO

    reply_content = data.content
    if new_status and new_status != ticket.status:
        old_val = ticket.status.value if hasattr(ticket.status, "value") else ticket.status
        new_val = new_status.value if hasattr(new_status, "value") else new_status
        reply_content += f"\n\n[STATUS_CHANGE:{old_val}->{new_val}]"
        ticket.status = new_status

    reply = TicketReply(
        ticket_id=ticket.id,
        author_id=current_user.id,
        content=reply_content,
        action_type=data.action_type,
        attachments=json.dumps([]),
    )
    db.add(reply)
    await db.commit()

    result = await db.execute(
        select(Ticket)
        .options(
            selectinload(Ticket.author),
            selectinload(Ticket.responsible),
            selectinload(Ticket.project),
            selectinload(Ticket.replies).selectinload(TicketReply.author),
        )
        .where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one()
    return _serialize_ticket(ticket)


@router.delete("/{ticket_id}/replies/{reply_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reply(
    ticket_id: str,
    reply_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(TicketReply)
        .where(TicketReply.id == reply_id, TicketReply.ticket_id == ticket_id)
    )
    reply = result.scalar_one_or_none()
    if not reply:
        raise HTTPException(status_code=404, detail="Risposta non trovata")
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Solo un amministratore può eliminare i messaggi")
    await db.delete(reply)
    await db.commit()
    return None


@router.post("/{ticket_id}/attachments")
async def upload_ticket_attachment(
    ticket_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Ticket).where(Ticket.id == ticket_id))
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
    await _check_ticket_access(ticket, current_user, db)

    content = await file.read()
    if len(content) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File troppo grande (max {MAX_FILE_SIZE_MB}MB)")

    ext = os.path.splitext(file.filename or "")[1]
    filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    attachments = json.loads(ticket.attachments) if ticket.attachments else []
    attachments.append({"name": file.filename, "path": f"uploads/tickets/{filename}"})
    ticket.attachments = json.dumps(attachments)
    await db.commit()

    return {"name": file.filename, "path": f"uploads/tickets/{filename}"}


@router.post("/{ticket_id}/replies/{reply_id}/attachments")
async def upload_reply_attachment(
    ticket_id: str,
    reply_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(TicketReply)
        .where(TicketReply.id == reply_id, TicketReply.ticket_id == ticket_id)
    )
    reply = result.scalar_one_or_none()
    if not reply:
        raise HTTPException(status_code=404, detail="Risposta non trovata")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File troppo grande (max {MAX_FILE_SIZE_MB}MB)")

    ext = os.path.splitext(file.filename or "")[1]
    filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    attachments = json.loads(reply.attachments) if reply.attachments else []
    attachments.append({"name": file.filename, "path": f"uploads/tickets/{filename}"})
    reply.attachments = json.dumps(attachments)
    await db.commit()

    return {"name": file.filename, "path": f"uploads/tickets/{filename}"}


@router.delete("/{ticket_id}/attachments/{index}")
async def delete_ticket_attachment(
    ticket_id: str,
    index: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Solo l'admin può eliminare gli allegati")
        
    result = await db.execute(select(Ticket).where(Ticket.id == ticket_id))
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")

    attachments = json.loads(ticket.attachments) if ticket.attachments else []
    if index < 0 or index >= len(attachments):
        raise HTTPException(status_code=400, detail="Indice allegato non valido")

    att = attachments.pop(index)
    ticket.attachments = json.dumps(attachments)
    
    filepath = os.path.join(".", att["path"])
    if os.path.exists(filepath):
        try:
            os.remove(filepath)
        except Exception:
            pass

    await db.commit()
    return {"message": "Allegato eliminato"}


@router.delete("/{ticket_id}/replies/{reply_id}/attachments/{index}")
async def delete_reply_attachment(
    ticket_id: str,
    reply_id: str,
    index: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Solo l'admin può eliminare gli allegati")
        
    result = await db.execute(
        select(TicketReply)
        .where(TicketReply.id == reply_id, TicketReply.ticket_id == ticket_id)
    )
    reply = result.scalar_one_or_none()
    if not reply:
        raise HTTPException(status_code=404, detail="Risposta non trovata")

    attachments = json.loads(reply.attachments) if reply.attachments else []
    if index < 0 or index >= len(attachments):
        raise HTTPException(status_code=400, detail="Indice allegato non valido")

    att = attachments.pop(index)
    reply.attachments = json.dumps(attachments)
    
    filepath = os.path.join(".", att["path"])
    if os.path.exists(filepath):
        try:
            os.remove(filepath)
        except Exception:
            pass

    await db.commit()
    return {"message": "Allegato eliminato"}


@router.get("/{ticket_id}/export/pdf")
async def export_ticket_pdf_route(
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Ticket).where(Ticket.id == ticket_id))
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
    await _check_ticket_access(ticket, current_user, db)

    buffer = await export_service.export_ticket_pdf(db, ticket_id)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=ticket_{ticket_id}.pdf"},
    )


@router.get("/{ticket_id}/export/excel")
async def export_ticket_excel_route(
    ticket_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Ticket).where(Ticket.id == ticket_id))
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
    await _check_ticket_access(ticket, current_user, db)

    buffer = await export_service.export_ticket_excel(db, ticket_id)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=ticket_{ticket_id}.xlsx"},
    )


@router.patch("/{ticket_id}/replies/{reply_id}", response_model=TicketReplyOut, summary="Modifica un messaggio del ticket")
async def update_ticket_reply(
    ticket_id: str,
    reply_id: str,
    data: TicketReplyUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Solo l'admin può modificare i messaggi")

    result = await db.execute(
        select(TicketReply)
        .options(selectinload(TicketReply.author))
        .where(TicketReply.id == reply_id, TicketReply.ticket_id == ticket_id)
    )
    reply = result.scalars().first()
    if not reply:
        raise HTTPException(status_code=404, detail="Messaggio non trovato")

    ticket_result = await db.execute(select(Ticket).where(Ticket.id == ticket_id))
    ticket = ticket_result.scalar_one_or_none()

    if data.action_type is not None:
        reply.action_type = data.action_type

    import re
    
    # Base content update
    new_content = data.content if data.content is not None else reply.content
    
    if data.ticket_status is not None and ticket and ticket.status != data.ticket_status:
        old_val = ticket.status.value if hasattr(ticket.status, "value") else ticket.status
        new_val = data.ticket_status.value if hasattr(data.ticket_status, "value") else data.ticket_status
        ticket.status = data.ticket_status
        
        # Strip existing STATUS_CHANGE tokens from the text
        new_content = re.sub(r'\n*\[STATUS_CHANGE:.*?\]', '', new_content)
        new_content += f"\n\n[STATUS_CHANGE:{old_val}->{new_val}]"
        
    reply.content = new_content

    await db.commit()
    await db.refresh(reply)
    
    return {
        "id": reply.id,
        "ticket_id": reply.ticket_id,
        "author_id": reply.author_id,
        "author_username": reply.author.username if reply.author else None,
        "author_full_name": reply.author.full_name if reply.author else None,
        "content": reply.content,
        "action_type": reply.action_type,
        "attachments": json.loads(reply.attachments) if reply.attachments else [],
        "created_at": reply.created_at,
        "updated_at": reply.updated_at,
    }
