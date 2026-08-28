import pytest
from httpx import AsyncClient
import datetime

@pytest.mark.asyncio
async def test_create_vacation(client: AsyncClient, auth_headers: dict):
    response = await client.post(
        "/api/vacations/me",
        headers=auth_headers,
        json={
            "start_date": str(datetime.date.today()),
            "end_date": str(datetime.date.today()),
            "reason": "ferie"
        }
    )
    assert response.status_code == 201

@pytest.mark.asyncio
async def test_get_vacations(client: AsyncClient, auth_headers: dict):
    response = await client.get("/api/vacations/me", headers=auth_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)

@pytest.mark.asyncio
async def test_delete_vacation(client: AsyncClient, auth_headers: dict):
    # create
    res = await client.post(
        "/api/vacations/me",
        headers=auth_headers,
        json={"start_date": str(datetime.date.today() + datetime.timedelta(days=1)), "end_date": str(datetime.date.today() + datetime.timedelta(days=1)), "reason": "permesso"}
    )
    v_id = res.json()["id"]

    # delete
    del_res = await client.delete(f"/api/vacations/me/{v_id}", headers=auth_headers)
    assert del_res.status_code == 200 or del_res.status_code == 204
