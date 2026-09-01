# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException, status
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select
# pyrefly: ignore [missing-import]
from typing import List, Any
import json
from datetime import timedelta

from app.core.dependencies import get_db, get_current_user
from app.models.user import User
from app.models.calendar_event import CalendarEvent
from app.models.task import Task, TaskType
from app.models.todo import Todo
from app.models.ticket import Ticket
from app.schemas.calendar_event import CalendarEventCreate, CalendarEventUpdate, CalendarEventOut

router = APIRouter()


# pyrefly: ignore [missing-import]
from sqlalchemy import or_

@router.get("/events")
async def get_all_events(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Ritorna tutti gli eventi unificati per l'utente loggato:
    - Eventi Personali (CalendarEvent)
    - Fasi / Milestone (Task in cui è assegnato)
    - Todo (di cui è autore o assegnatario, con data di scadenza)
    - Ticket (di cui è autore o assegnatario)
    """
    events: List[Any] = []

    # 1. Eventi Personali
    res = await db.execute(
        select(CalendarEvent).where(
            or_(
                CalendarEvent.user_id == current_user.id,
                CalendarEvent.shared_with.like(f'%"{current_user.username}"%')
            )
        )
    )
    personal_events = res.scalars().all()
    for ev in personal_events:
        try:
            shared = json.loads(ev.shared_with) if ev.shared_with else []
        except:
            shared = []
        events.append({
            "id": f"cal_{ev.id}",
            "real_id": ev.id,
            "title": ev.title,
            "description": ev.description,
            "start": ev.start_date.isoformat(),
            "end": (ev.end_date + timedelta(days=1)).isoformat() if ev.is_all_day else ev.end_date.isoformat(),
            "allDay": ev.is_all_day,
            "color": ev.color,
            "type": "personal",
            "shared_with": shared
        })

    # 2. Fasi / Milestone (Gantt)
    res_tasks = await db.execute(select(Task).where(Task.type.in_([TaskType.TASK, TaskType.MILESTONE])))
    tasks = res_tasks.scalars().all()
    
    for t in tasks:
        try:
            workers = json.loads(t.workers) if t.workers else []
        except:
            workers = []
        
        if current_user.username in workers:
            start = t.start_date
            end = t.end_date if t.end_date else start
            
            # Le fasi hanno solo la data, quindi le consideriamo All Day
            # Per FullCalendar le date end in all-day devono essere il giorno successivo esclusivo
            end_date = end + timedelta(days=1)
            
            events.append({
                "id": f"phase_{t.id}",
                "real_id": t.id,
                "project_id": t.project_id,
                "title": f"Fase: {t.text}",
                "start": start.isoformat(),
                "end": end_date.isoformat(),
                "allDay": True,
                "color": getattr(t, "color", "#f59e0b") if hasattr(t, "color") else "#f59e0b",
                "type": "phase"
            })

    # 3. Todo
    res_todos = await db.execute(select(Todo).where(Todo.due_date.isnot(None)))
    todos = res_todos.scalars().all()
    for td in todos:
        try:
            assignees = json.loads(td.assignees) if td.assignees else []
        except:
            assignees = []
            
        if current_user.username in assignees or td.creator_id == current_user.id:
            start = td.due_date
            events.append({
                "id": f"todo_{td.id}",
                "real_id": td.id,
                "title": f"TODO: {td.title}",
                "start": start.isoformat(),
                "end": (start + timedelta(hours=1)).isoformat(),
                "allDay": False,
                "color": "#f97316", # Orange
                "type": "todo",
                "display": "block"
            })

    # 4. Ferie
    from app.models.vacation import Vacation
    res_vac = await db.execute(select(Vacation).where(Vacation.user_id == current_user.id))
    vacations = res_vac.scalars().all()
    for vac in vacations:
        events.append({
            "id": f"vac_{vac.id}",
            "real_id": vac.id,
            "title": f"Ferie: {vac.reason}" if vac.reason else "Ferie",
            "start": vac.start_date.isoformat(),
            "end": (vac.end_date + timedelta(days=1)).isoformat(),
            "allDay": True,
            "color": "#ef4444", # Red
            "type": "vacation",
            "display": "block"
        })

    # 5. Festività Nazionali
    from app.utils.working_days import get_italian_holidays
    from datetime import datetime
    
    current_year = datetime.now().year
    for year in [current_year - 1, current_year, current_year + 1]:
        hols = get_italian_holidays(year)
        for h in hols:
            events.append({
                "id": f"hol_{h['date'].isoformat()}",
                "real_id": h["date"].isoformat(),
                "title": h["name"],
                "start": h["date"].isoformat(),
                "end": (h["date"] + timedelta(days=1)).isoformat(),
                "allDay": True,
                "color": "#10b981", # Emerald green
                "type": "holiday",
                "display": "block"
            })

    return events


@router.post("/events", response_model=CalendarEventOut, status_code=status.HTTP_201_CREATED)
async def create_calendar_event(
    event_in: CalendarEventCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    ev = CalendarEvent(
        user_id=current_user.id,
        title=event_in.title,
        description=event_in.description,
        start_date=event_in.start_date,
        end_date=event_in.end_date,
        is_all_day=event_in.is_all_day,
        color=event_in.color,
        shared_with=json.dumps(event_in.shared_with) if event_in.shared_with else "[]"
    )
    db.add(ev)
    await db.commit()
    await db.refresh(ev)
    return ev


@router.put("/events/{event_id}", response_model=CalendarEventOut)
async def update_calendar_event(
    event_id: str,
    event_in: CalendarEventUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    res = await db.execute(select(CalendarEvent).where(CalendarEvent.id == event_id))
    ev = res.scalar_one_or_none()
    
    if not ev:
        raise HTTPException(status_code=404, detail="Evento non trovato")
        
    try:
        shared = json.loads(ev.shared_with) if ev.shared_with else []
    except:
        shared = []
        
    if ev.user_id != current_user.id and current_user.role != "admin" and current_user.username not in shared:
        raise HTTPException(status_code=403, detail="Non puoi modificare questo evento")
        
    for field, value in event_in.model_dump(exclude_unset=True).items():
        if field == "shared_with":
            ev.shared_with = json.dumps(value) if value else "[]"
        else:
            setattr(ev, field, value)
        
    await db.commit()
    await db.refresh(ev)
    return ev


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_calendar_event(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    res = await db.execute(select(CalendarEvent).where(CalendarEvent.id == event_id))
    ev = res.scalar_one_or_none()
    
    if not ev:
        raise HTTPException(status_code=404, detail="Evento non trovato")
        
    if ev.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Non puoi eliminare questo evento")
        
    await db.delete(ev)
    await db.commit()
    return None
