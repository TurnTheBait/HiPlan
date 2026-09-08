import pytest
from datetime import datetime
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole
from app.models.todo import Todo
from app.models.ticket import Ticket
from app.core.security import hash_password, create_access_token


import pytest_asyncio


@pytest_asyncio.fixture
async def editor_headers(db_session: AsyncSession) -> dict:
    editor = User(
        email="editor@example.com",
        username="editoruser",
        hashed_password=hash_password("editorpass"),
        full_name="Editor User",
        role=UserRole.EDITOR,
        department="produzione",
        is_active=True,
    )
    db_session.add(editor)
    await db_session.commit()
    await db_session.refresh(editor)

    token = create_access_token(data={"sub": str(editor.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def viewer_headers(db_session: AsyncSession) -> dict:
    viewer = User(
        email="viewer@example.com",
        username="vieweruser",
        hashed_password=hash_password("viewerpass"),
        full_name="Viewer User",
        role=UserRole.VIEWER,
        department="produzione",
        is_active=True,
    )
    db_session.add(viewer)
    await db_session.commit()
    await db_session.refresh(viewer)

    token = create_access_token(data={"sub": str(viewer.id)})
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_editor_can_access_todo_and_ticket_trash(
    client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    editor_headers: dict,
):
    # Crea un Todo e un Ticket eliminati (nel cestino)
    todo = Todo(title="Todo nel Cestino", creator_id=test_user.id, deleted_at=datetime.utcnow())
    ticket = Ticket(title="Ticket nel Cestino", author_id=test_user.id, deleted_at=datetime.utcnow())
    db_session.add_all([todo, ticket])
    await db_session.commit()

    # 1. Editor visualizza cestino TODO
    res = await client.get("/api/todos/trash", headers=editor_headers)
    assert res.status_code == 200
    assert any(t["id"] == str(todo.id) for t in res.json())

    # 2. Editor visualizza cestino Ticket
    res = await client.get("/api/tickets/trash", headers=editor_headers)
    assert res.status_code == 200
    assert any(t["id"] == str(ticket.id) for t in res.json())

    # 3. Editor ripristina Todo
    res = await client.post(f"/api/todos/trash/{todo.id}/restore", headers=editor_headers)
    assert res.status_code == 200

    # 4. Editor ripristina Ticket
    res = await client.post(f"/api/tickets/trash/{ticket.id}/restore", headers=editor_headers)
    assert res.status_code == 200


@pytest.mark.asyncio
async def test_viewer_is_forbidden_from_todo_and_ticket_trash(
    client: AsyncClient,
    db_session: AsyncSession,
    test_user: User,
    viewer_headers: dict,
):
    # Crea un Todo e un Ticket eliminati
    todo = Todo(title="Todo Trashed", creator_id=test_user.id, deleted_at=datetime.utcnow())
    ticket = Ticket(title="Ticket Trashed", author_id=test_user.id, deleted_at=datetime.utcnow())
    db_session.add_all([todo, ticket])
    await db_session.commit()

    # Viewer tenta di accedere al cestino TODO -> 403
    res = await client.get("/api/todos/trash", headers=viewer_headers)
    assert res.status_code == 403
    assert "Accesso al cestino riservato" in res.json()["detail"]

    # Viewer tenta di svuotare il cestino TODO -> 403
    res = await client.delete("/api/todos/trash/empty", headers=viewer_headers)
    assert res.status_code == 403

    # Viewer tenta di ripristinare il TODO -> 403
    res = await client.post(f"/api/todos/trash/{todo.id}/restore", headers=viewer_headers)
    assert res.status_code == 403

    # Viewer tenta di eliminare definitivamente il TODO -> 403
    res = await client.delete(f"/api/todos/trash/{todo.id}", headers=viewer_headers)
    assert res.status_code == 403

    # Viewer tenta di accedere al cestino Ticket -> 403
    res = await client.get("/api/tickets/trash", headers=viewer_headers)
    assert res.status_code == 403
    assert "Accesso al cestino riservato" in res.json()["detail"]

    # Viewer tenta di svuotare il cestino Ticket -> 403
    res = await client.delete("/api/tickets/trash/empty", headers=viewer_headers)
    assert res.status_code == 403

    # Viewer tenta di ripristinare il Ticket -> 403
    res = await client.post(f"/api/tickets/trash/{ticket.id}/restore", headers=viewer_headers)
    assert res.status_code == 403

    # Viewer tenta di eliminare definitivamente il Ticket -> 403
    res = await client.delete(f"/api/tickets/trash/{ticket.id}", headers=viewer_headers)
    assert res.status_code == 403
