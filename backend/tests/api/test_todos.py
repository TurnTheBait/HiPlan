# pyrefly: ignore [missing-import]
import pytest
# pyrefly: ignore [missing-import]
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_create_todo(client: AsyncClient, auth_headers: dict):
    response = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={
            "title": "Test Checklist Item",
            "is_completed": False
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Test Checklist Item"
    assert data["is_completed"] is False
    assert "id" in data

@pytest.mark.asyncio
async def test_get_todos(client: AsyncClient, auth_headers: dict):
    await client.post(
        "/api/todos",
        headers=auth_headers,
        json={
            "title": "Another Todo",
            "is_completed": True
        }
    )
    
    response = await client.get("/api/todos", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert any(t["title"] == "Another Todo" for t in data)

@pytest.mark.asyncio
async def test_update_todo(client: AsyncClient, auth_headers: dict):
    response = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "Todo to update", "is_completed": False}
    )
    assert response.status_code == 201
    todo_id = response.json()["id"]

    response_put = await client.patch(
        f"/api/todos/{todo_id}",
        headers=auth_headers,
        json={"is_completed": True}
    )
    assert response_put.status_code == 200
    assert response_put.json()["is_completed"] is True

@pytest.mark.asyncio
async def test_delete_todo(client: AsyncClient, auth_headers: dict):
    response = await client.post(
        "/api/todos",
        headers=auth_headers,
        json={"title": "Todo to delete"}
    )
    assert response.status_code == 201
    todo_id = response.json()["id"]

    response_del = await client.delete(f"/api/todos/{todo_id}", headers=auth_headers)
    assert response_del.status_code == 204

    # Dopo l'eliminazione (soft delete), il todo non compare più nella lista standard
    get_res = await client.get("/api/todos", headers=auth_headers)
    assert get_res.status_code == 200
    assert not any(t["id"] == todo_id for t in get_res.json())

    # Ma compare nel cestino con giorni rimanenti
    trash_res = await client.get("/api/todos/trash", headers=auth_headers)
    assert trash_res.status_code == 200
    trash_items = trash_res.json()
    trashed_todo = next((t for t in trash_items if t["id"] == todo_id), None)
    assert trashed_todo is not None
    assert trashed_todo["days_left"] == 90

    # Ripristino
    restore_res = await client.post(f"/api/todos/trash/{todo_id}/restore", headers=auth_headers)
    assert restore_res.status_code == 200

    # Ricompare nella lista standard
    get_res_after = await client.get("/api/todos", headers=auth_headers)
    assert any(t["id"] == todo_id for t in get_res_after.json())

    # Ri-elimina e poi hard delete
    await client.delete(f"/api/todos/{todo_id}", headers=auth_headers)
    hard_del_res = await client.delete(f"/api/todos/trash/{todo_id}", headers=auth_headers)
    assert hard_del_res.status_code == 204

    # Non c'è più neanche nel cestino
    trash_res_final = await client.get("/api/todos/trash", headers=auth_headers)
    assert not any(t["id"] == todo_id for t in trash_res_final.json())

