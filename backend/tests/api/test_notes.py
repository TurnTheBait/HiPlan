import pytest
from httpx import AsyncClient

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
