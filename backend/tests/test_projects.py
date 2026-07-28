import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_create_project(client: AsyncClient, auth_headers: dict):
    response = await client.post(
        "/api/projects",
        headers=auth_headers,
        json={
            "name": "Test Project",
            "code": "PRJ-001",
            "client": "Test Client",
            "status": "planning"
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Test Project"
    assert data["code"] == "PRJ-001"
    assert data["status"] == "planning"
    assert "id" in data

@pytest.mark.asyncio
async def test_get_projects(client: AsyncClient, auth_headers: dict):
    # First create a project
    await client.post(
        "/api/projects",
        headers=auth_headers,
        json={"name": "Test Project 2"}
    )
    
    response = await client.get("/api/projects", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    # Check if the created project is in the list
    assert any(p["name"] == "Test Project 2" for p in data)

@pytest.mark.asyncio
async def test_unauthorized_project_access(client: AsyncClient):
    response = await client.get("/api/projects")
    assert response.status_code == 401
