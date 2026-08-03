import pytest
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
