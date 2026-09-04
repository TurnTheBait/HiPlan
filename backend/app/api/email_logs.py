# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select
from typing import List
from app.core.dependencies import get_current_user, get_db
from app.models.user import User
from app.models.email_log import EmailLog
from app.schemas.email_log import EmailLogResponse

router = APIRouter()

@router.get("/", response_model=List[EmailLogResponse])
async def get_email_logs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        # pyrefly: ignore [missing-import]
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Non autorizzato")
        
    result = await db.execute(select(EmailLog).order_by(EmailLog.created_at.desc()).limit(100))
    return result.scalars().all()

@router.get("/scheduled")
async def get_scheduled_emails(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        # pyrefly: ignore [missing-import]
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Non autorizzato")
        
    from app.models.todo import Todo
    from app.models.calendar_event import CalendarEvent
    # pyrefly: ignore [missing-import]
    from sqlalchemy import or_
    from datetime import datetime
    import json
    
    now = datetime.now()
    # Tutti i todo non completati con notify_email = True e data nel futuro/oggi
    query = select(Todo).where(
        Todo.is_completed == False,
        Todo.notify_email == True,
        or_(
            Todo.notify_date >= now,
            Todo.due_date >= now
        )
    )
    result = await db.execute(query)
    todos = result.scalars().all()
    
    # Recupera tutte le email degli user
    users_result = await db.execute(select(User))
    users = users_result.scalars().all()
    user_dict = {u.id: u.email for u in users if u.email}
    
    scheduled = []
    for t in todos:
        try:
            assignees = json.loads(t.assignees) if t.assignees else []
        except Exception:
            assignees = []
            
        recipients = [user_dict[uid] for uid in assignees if uid in user_dict]
        if not recipients:
            continue
            
        if t.notify_date and t.notify_date >= now and not t.notify_sent:
            scheduled.append({
                "id": f"todo_{t.id}",
                "date": t.notify_date,
                "type": "Notifica programmata",
                "subject": f"Promemoria TODO: {t.title}",
                "recipients": ", ".join(recipients)
            })
            
        if t.due_date and t.due_date >= now and not t.due_reminder_sent: 
            scheduled.append({
                "id": f"todo_{t.id}",
                "date": t.due_date, 
                "type": "Promemoria scadenza",
                "subject": f"Scadenza TODO: {t.title}",
                "recipients": ", ".join(recipients)
            })
            
    # Recupera Eventi Calendario
    cal_query = select(CalendarEvent).where(
        CalendarEvent.reminder_sent == False,
        CalendarEvent.reminder_type != "none",
        CalendarEvent.reminder_time >= now
    )
    cal_result = await db.execute(cal_query)
    cal_events = cal_result.scalars().all()

    for ev in cal_events:
        try:
            shared = json.loads(ev.shared_with) if ev.shared_with else []
        except Exception:
            shared = []
            
        # Per gli eventi, i recipients sono il creatore + shared_with (username)
        # Troviamo gli username dei recipients
        event_users = []
        if ev.user_id in user_dict:
            event_users.append(user_dict[ev.user_id])
            
        for u in users:
            if u.username in shared and u.email:
                event_users.append(u.email)
                
        # Deduplicazione
        event_users = list(set(event_users))
                
        scheduled.append({
            "id": f"cal_{ev.id}",
            "date": ev.reminder_time,
            "type": "Promemoria evento",
            "subject": f"Promemoria Evento: {ev.title}",
            "recipients": ", ".join(event_users)
        })

    scheduled.sort(key=lambda x: x["date"])
    return scheduled

@router.delete("/scheduled/{item_id}")
async def cancel_scheduled_email(
    item_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        # pyrefly: ignore [missing-import]
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Non autorizzato")
        
    if item_id.startswith("todo_"):
        real_id = int(item_id.split("_")[1])
        from app.models.todo import Todo
        result = await db.execute(select(Todo).where(Todo.id == real_id))
        todo = result.scalar_one_or_none()
        if not todo:
            # pyrefly: ignore [missing-import]
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="TODO non trovato")
            
        todo.notify_email = False
        await db.commit()
        return {"message": "Notifica programmata TODO annullata"}
        
    elif item_id.startswith("cal_"):
        real_id = int(item_id.split("_")[1])
        from app.models.calendar_event import CalendarEvent
        result = await db.execute(select(CalendarEvent).where(CalendarEvent.id == real_id))
        ev = result.scalar_one_or_none()
        if not ev:
            # pyrefly: ignore [missing-import]
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Evento non trovato")
            
        ev.reminder_type = "none"
        ev.reminder_sent = True
        await db.commit()
        return {"message": "Notifica programmata Evento annullata"}
        
    else:
        # Retrocompatibilità se l'id è solo numerico (vecchi record a schermo prima del reload)
        real_id = int(item_id)
        from app.models.todo import Todo
        result = await db.execute(select(Todo).where(Todo.id == real_id))
        todo = result.scalar_one_or_none()
        if todo:
            todo.notify_email = False
            await db.commit()
            return {"message": "Notifica programmata annullata"}
            
        # pyrefly: ignore [missing-import]
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Elemento non trovato")
