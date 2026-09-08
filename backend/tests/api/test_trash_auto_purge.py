import pytest
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.user import User
from app.models.project import Project, ProjectStatus
from app.models.todo import Todo
from app.models.ticket import Ticket
from app.models.note import Note

from app.services.project_service import purge_expired_trash as purge_projects
from app.api.todos import purge_expired_todo_trash
from app.api.tickets import purge_expired_ticket_trash
from app.api.notes import purge_expired_note_trash


@pytest.mark.asyncio
async def test_90_day_trash_auto_purge(db_session: AsyncSession, test_user: User):
    """
    Verifica che il meccanismo di pulizia automatica elimini definitivamente
    solo gli elementi nel cestino da più di 90 giorni, preservando quelli eliminati di recente.
    """
    now = datetime.utcnow()
    old_deleted_at = now - timedelta(days=95)  # > 90 giorni -> deve essere eliminato
    recent_deleted_at = now - timedelta(days=10)  # < 90 giorni -> deve essere conservato

    # 1. Progetti
    p_old = Project(name="Commessa Vecchia", status=ProjectStatus.ACTIVE, owner_id=test_user.id, deleted_at=old_deleted_at)
    p_recent = Project(name="Commessa Recente", status=ProjectStatus.ACTIVE, owner_id=test_user.id, deleted_at=recent_deleted_at)

    # 2. Todo
    t_old = Todo(title="Todo Vecchio", creator_id=test_user.id, deleted_at=old_deleted_at)
    t_recent = Todo(title="Todo Recente", creator_id=test_user.id, deleted_at=recent_deleted_at)

    # 3. Ticket
    tk_old = Ticket(title="Ticket Vecchio", author_id=test_user.id, deleted_at=old_deleted_at)
    tk_recent = Ticket(title="Ticket Recente", author_id=test_user.id, deleted_at=recent_deleted_at)

    # 4. Note
    n_old = Note(title="Nota Vecchia", owner_id=test_user.id, deleted_at=old_deleted_at)
    n_recent = Note(title="Nota Recente", owner_id=test_user.id, deleted_at=recent_deleted_at)

    db_session.add_all([p_old, p_recent, t_old, t_recent, tk_old, tk_recent, n_old, n_recent])
    await db_session.commit()

    # Esegui le funzioni di purge (chiamate sia su schedule giornaliero che on-access alle API /trash)
    await purge_projects(db_session)
    await purge_expired_todo_trash(db_session)
    await purge_expired_ticket_trash(db_session)
    await purge_expired_note_trash(db_session)

    # Verifica Projects
    res_p_old = await db_session.execute(select(Project).where(Project.id == p_old.id))
    res_p_recent = await db_session.execute(select(Project).where(Project.id == p_recent.id))
    assert res_p_old.scalar_one_or_none() is None
    assert res_p_recent.scalar_one_or_none() is not None

    # Verifica Todos
    res_t_old = await db_session.execute(select(Todo).where(Todo.id == t_old.id))
    res_t_recent = await db_session.execute(select(Todo).where(Todo.id == t_recent.id))
    assert res_t_old.scalar_one_or_none() is None
    assert res_t_recent.scalar_one_or_none() is not None

    # Verifica Tickets
    res_tk_old = await db_session.execute(select(Ticket).where(Ticket.id == tk_old.id))
    res_tk_recent = await db_session.execute(select(Ticket).where(Ticket.id == tk_recent.id))
    assert res_tk_old.scalar_one_or_none() is None
    assert res_tk_recent.scalar_one_or_none() is not None

    # Verifica Notes
    res_n_old = await db_session.execute(select(Note).where(Note.id == n_old.id))
    res_n_recent = await db_session.execute(select(Note).where(Note.id == n_recent.id))
    assert res_n_old.scalar_one_or_none() is None
    assert res_n_recent.scalar_one_or_none() is not None
