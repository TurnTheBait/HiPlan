# pyrefly: ignore [missing-import]
import pytest
# pyrefly: ignore [missing-import]
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_create_ticket(client: AsyncClient, auth_headers: dict):
    response = await client.post(
        "/api/tickets",
        headers=auth_headers,
        json={
            "title": "Test Ticket",
            "description": "Test description",
            "priority": "high"
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Test Ticket"
    assert data["priority"] == "high"

@pytest.mark.asyncio
async def test_get_tickets(client: AsyncClient, auth_headers: dict):
    response = await client.get("/api/tickets", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)

@pytest.mark.asyncio
async def test_update_ticket(client: AsyncClient, auth_headers: dict):
    # create
    res = await client.post("/api/tickets", headers=auth_headers, json={"title": "To Update", "priority": "medium"})
    t_id = res.json()["id"]

    # update
    res_upd = await client.patch(
        f"/api/tickets/{t_id}",
        headers=auth_headers,
        json={"title": "Updated Title"}
    )
    assert res_upd.status_code == 200
    assert res_upd.json()["title"] == "Updated Title"

@pytest.mark.asyncio
async def test_delete_ticket(client: AsyncClient, auth_headers: dict):
    res = await client.post("/api/tickets", headers=auth_headers, json={"title": "To Delete"})
    t_id = res.json()["id"]

    res_del = await client.delete(f"/api/tickets/{t_id}", headers=auth_headers)
    assert res_del.status_code == 200 or res_del.status_code == 204

    # Dopo l'eliminazione, il ticket non compare nella lista standard
    get_res = await client.get("/api/tickets", headers=auth_headers)
    assert not any(t["id"] == t_id for t in get_res.json())

    # Ma compare nel cestino con giorni rimanenti
    trash_res = await client.get("/api/tickets/trash", headers=auth_headers)
    assert trash_res.status_code == 200
    trashed = next((t for t in trash_res.json() if t["id"] == t_id), None)
    assert trashed is not None
    assert trashed["days_left"] == 90

    # Ripristino
    rest_res = await client.post(f"/api/tickets/trash/{t_id}/restore", headers=auth_headers)
    assert rest_res.status_code == 200

    # Ricompare nella lista standard
    get_res_after = await client.get("/api/tickets", headers=auth_headers)
    assert any(t["id"] == t_id for t in get_res_after.json())

    # Ri-elimina e poi hard delete
    await client.delete(f"/api/tickets/{t_id}", headers=auth_headers)
    hard_del = await client.delete(f"/api/tickets/trash/{t_id}", headers=auth_headers)
    assert hard_del.status_code == 204

    trash_res_final = await client.get("/api/tickets/trash", headers=auth_headers)
    assert not any(t["id"] == t_id for t in trash_res_final.json())

