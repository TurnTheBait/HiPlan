import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.user import User

@pytest.mark.asyncio
async def test_create_note(client: AsyncClient, auth_headers: dict):
    response = await client.post(
        "/api/notes",
        headers=auth_headers,
        json={
            "title": "Test Note",
            "content": "This is a test note content",
            "visibility": "private"
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Test Note"
    assert data["content"] == "This is a test note content"
    assert "id" in data

@pytest.mark.asyncio
async def test_get_notes(client: AsyncClient, auth_headers: dict):
    await client.post(
        "/api/notes",
        headers=auth_headers,
        json={
            "title": "Another Test Note",
            "content": "Content here",
            "visibility": "private"
        }
    )
    
    response = await client.get("/api/notes", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert any(n["title"] == "Another Test Note" for n in data)


@pytest.mark.asyncio
async def test_note_trash_lifecycle(client: AsyncClient, auth_headers: dict):
    create_res = await client.post(
        "/api/notes",
        headers=auth_headers,
        json={
            "title": "Nota Da Cestinare",
            "content": "Contenuto temporaneo",
            "visibility": "private"
        }
    )
    assert create_res.status_code == 201
    note_id = create_res.json()["id"]

    # Elimina (soft delete)
    del_res = await client.delete(f"/api/notes/{note_id}", headers=auth_headers)
    assert del_res.status_code == 204

    # Non compare più nella lista standard
    get_res = await client.get("/api/notes", headers=auth_headers)
    assert not any(n["id"] == note_id for n in get_res.json())

    # Compare nel cestino con days_left = 90
    trash_res = await client.get("/api/notes/trash", headers=auth_headers)
    assert trash_res.status_code == 200
    trashed = next((n for n in trash_res.json() if n["id"] == note_id), None)
    assert trashed is not None
    assert trashed["days_left"] == 90

    # Ripristino
    rest_res = await client.post(f"/api/notes/trash/{note_id}/restore", headers=auth_headers)
    assert rest_res.status_code == 200

    # Ricompare nella lista standard
    get_res_after = await client.get("/api/notes", headers=auth_headers)
    assert any(n["id"] == note_id for n in get_res_after.json())

    # Ri-elimina e poi hard delete
    await client.delete(f"/api/notes/{note_id}", headers=auth_headers)
    hard_del = await client.delete(f"/api/notes/trash/{note_id}", headers=auth_headers)
    assert hard_del.status_code == 204

    trash_res_final = await client.get("/api/notes/trash", headers=auth_headers)
    assert not any(n["id"] == note_id for n in trash_res_final.json())


@pytest.mark.asyncio
async def test_notes_trash_isolated_per_user(client: AsyncClient, db_session: AsyncSession, test_user: User, auth_headers: dict):
    from app.core.security import hash_password, create_access_token
    from app.models.user import UserRole
    # Crea un secondo utente
    user_b = User(
        email="user_b@example.com",
        username="user_b",
        hashed_password=hash_password("userbpass"),
        full_name="User B",
        role=UserRole.VIEWER,
        department="ufficio_tecnico",
        is_active=True,
    )
    db_session.add(user_b)
    await db_session.commit()
    await db_session.refresh(user_b)
    user_b_token = create_access_token(data={"sub": str(user_b.id)})
    user_b_headers = {"Authorization": f"Bearer {user_b_token}"}

    # Test user (Utente A) crea e cestina una nota (anche condivisa col team!)
    res_a = await client.post(
        "/api/notes",
        headers=auth_headers,
        json={"title": "Nota di Utente A", "content": "Segreto A", "visibility": "team"}
    )
    assert res_a.status_code == 201
    note_a_id = res_a.json()["id"]
    await client.delete(f"/api/notes/{note_a_id}", headers=auth_headers)

    # Utente B crea e cestina una nota
    res_b = await client.post(
        "/api/notes",
        headers=user_b_headers,
        json={"title": "Nota di Utente B", "content": "Segreto B", "visibility": "private"}
    )
    assert res_b.status_code == 201
    note_b_id = res_b.json()["id"]
    await client.delete(f"/api/notes/{note_b_id}", headers=user_b_headers)

    # 1. Utente A vede solo la sua nota nel cestino
    trash_a = await client.get("/api/notes/trash", headers=auth_headers)
    assert trash_a.status_code == 200
    ids_a = [n["id"] for n in trash_a.json()]
    assert note_a_id in ids_a
    assert note_b_id not in ids_a

    # 2. Utente B vede solo la sua nota nel cestino
    trash_b = await client.get("/api/notes/trash", headers=user_b_headers)
    assert trash_b.status_code == 200
    ids_b = [n["id"] for n in trash_b.json()]
    assert note_b_id in ids_b
    assert note_a_id not in ids_b

    # 3. Utente B tenta di ripristinare la nota di Utente A -> 403
    forbidden_restore = await client.post(f"/api/notes/trash/{note_a_id}/restore", headers=user_b_headers)
    assert forbidden_restore.status_code == 403

    # 4. Utente B tenta di eliminare definitivamente la nota di Utente A -> 403
    forbidden_delete = await client.delete(f"/api/notes/trash/{note_a_id}", headers=user_b_headers)
    assert forbidden_delete.status_code == 403

    # 5. Utente B svuota il proprio cestino: solo la nota B viene cancellata
    empty_res = await client.delete("/api/notes/trash/empty", headers=user_b_headers)
    assert empty_res.status_code == 204

    trash_b_after = await client.get("/api/notes/trash", headers=user_b_headers)
    assert len(trash_b_after.json()) == 0

    # La nota A è ancora al sicuro nel cestino di Utente A
    trash_a_after = await client.get("/api/notes/trash", headers=auth_headers)
    assert any(n["id"] == note_a_id for n in trash_a_after.json())

    # 6. Utente B crea e cancella una nota condivisa con il TEAM
    res_b_team = await client.post(
        "/api/notes",
        headers=user_b_headers,
        json={"title": "Nota Team di B", "content": "Team info", "visibility": "team"}
    )
    assert res_b_team.status_code == 201
    note_b_team_id = res_b_team.json()["id"]
    await client.delete(f"/api/notes/{note_b_team_id}", headers=user_b_headers)

    # Utente B la vede nel proprio cestino
    trash_b_team = await client.get("/api/notes/trash", headers=user_b_headers)
    assert any(n["id"] == note_b_team_id for n in trash_b_team.json())

    # L'ADMIN (test_user) vede anch'esso la nota di team nel proprio cestino!
    trash_admin_team = await client.get("/api/notes/trash", headers=auth_headers)
    assert any(n["id"] == note_b_team_id for n in trash_admin_team.json())

    # L'ADMIN può anche ripristinare la nota di team
    admin_restore = await client.post(f"/api/notes/trash/{note_b_team_id}/restore", headers=auth_headers)
    assert admin_restore.status_code == 200



