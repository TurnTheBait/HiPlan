from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
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
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Non autorizzato")
        
    from app.models.todo import Todo
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
                "id": t.id,
                "date": t.notify_date,
                "type": "Notifica programmata",
                "subject": f"Promemoria TODO: {t.title}",
                "recipients": ", ".join(recipients)
            })
            
        if t.due_date and t.due_date >= now and not t.due_reminder_sent: 
            # In main.py il reminder è 24 ore prima. Qui mostriamo semplicemente che c'è una scadenza.
            scheduled.append({
                "id": t.id,
                "date": t.due_date, # Verrà inviata il giorno prima
                "type": "Promemoria scadenza",
                "subject": f"Scadenza TODO: {t.title}",
                "recipients": ", ".join(recipients)
            })
            
    scheduled.sort(key=lambda x: x["date"])
    return scheduled

@router.delete("/scheduled/{todo_id}")
async def cancel_scheduled_email(
    todo_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Non autorizzato")
        
    from app.models.todo import Todo
    result = await db.execute(select(Todo).where(Todo.id == todo_id))
    todo = result.scalar_one_or_none()
    if not todo:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="TODO non trovato")
        
    todo.notify_email = False
    await db.commit()
    return {"message": "Notifiche programmate annullate"}
