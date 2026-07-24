import json
import os
import uuid
from typing import List, Optional
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Query
# pyrefly: ignore [missing-import]
from fastapi.responses import FileResponse
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_db, get_current_user
from app.models.user import User, UserRole
from app.models.ticket import Ticket, TicketReply, TicketStatus, TicketPriority
from app.models.notification import Notification, NotificationType
from app.schemas.ticket import TicketCreate, TicketUpdate, TicketOut, TicketReplyCreate, TicketReplyOut

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
        "assigned_to": assigned,
        "attachments": attachments,
        "status": ticket.status.value if hasattr(ticket.status, "value") else ticket.status,
        "priority": ticket.priority.value if hasattr(ticket.priority, "value") else ticket.priority,
        "replies": replies_out,
        "reply_count": len(replies_out),
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
    }


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

    result = await db.execute(query)
    tickets = result.scalars().all()
    return [_serialize_ticket(t) for t in tickets]


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
            selectinload(Ticket.project),
            selectinload(Ticket.replies).selectinload(TicketReply.author),
        )
        .where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
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
            selectinload(Ticket.project),
            selectinload(Ticket.replies).selectinload(TicketReply.author),
        )
        .where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")

    if ticket.author_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Solo l'autore o un amministratore può modificare il ticket")

    if data.title is not None:
        ticket.title = data.title.strip()
    if data.description is not None:
        ticket.description = data.description
    if data.project_id is not None:
        ticket.project_id = data.project_id or None
        if ticket.project_id:
            ticket.custom_project_code = None
    if data.custom_project_code is not None:
        ticket.custom_project_code = data.custom_project_code or None
        if ticket.custom_project_code:
            ticket.project_id = None
    if data.assigned_to is not None:
        ticket.assigned_to = json.dumps(data.assigned_to)
    if data.priority is not None:
        ticket.priority = data.priority
        
    status_changed = False
    old_status = None
    new_status = None
    if data.status is not None and data.status != ticket.status:
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
    if ticket.author_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Solo l'autore o un amministratore può eliminare il ticket")
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
    if ticket.status == TicketStatus.COMPLETATO:
        raise HTTPException(status_code=400, detail="Impossibile rispondere a un ticket completato")

    reply = TicketReply(
        ticket_id=ticket.id,
        author_id=current_user.id,
        content=data.content,
        action_type=data.action_type,
        attachments=json.dumps([]),
    )
    db.add(reply)
    await db.commit()

    result = await db.execute(
        select(Ticket)
        .options(
            selectinload(Ticket.author),
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
    if reply.author_id != current_user.id and current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Solo l'autore o un amministratore può eliminare questa risposta")
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
