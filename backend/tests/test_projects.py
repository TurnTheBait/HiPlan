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

@pytest.mark.asyncio
async def test_update_project(client: AsyncClient, auth_headers: dict):
    # First create
    response = await client.post(
        "/api/projects",
        headers=auth_headers,
        json={"name": "Project to Update", "status": "planning"}
    )
    assert response.status_code == 201
    proj_id = response.json()["id"]

    # Then update
    response_put = await client.put(
        f"/api/projects/{proj_id}",
        headers=auth_headers,
        json={"name": "Project Updated", "status": "active"}
    )
    assert response_put.status_code == 200
    data = response_put.json()
    assert data["name"] == "Project Updated"
    assert data["status"] == "active"

@pytest.mark.asyncio
async def test_delete_project(client: AsyncClient, auth_headers: dict):
    # First create
    response = await client.post(
        "/api/projects",
        headers=auth_headers,
        json={"name": "Project to Delete"}
    )
    assert response.status_code == 201
    proj_id = response.json()["id"]

    # Delete
    response_del = await client.delete(f"/api/projects/{proj_id}", headers=auth_headers)
    assert response_del.status_code == 204

    # Get should return 404
    response_get = await client.get(f"/api/projects/{proj_id}", headers=auth_headers)
    assert response_get.status_code == 404
