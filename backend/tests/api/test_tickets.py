import pytest
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
