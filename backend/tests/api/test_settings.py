# pyrefly: ignore [missing-import]
import pytest
# pyrefly: ignore [missing-import]
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_get_settings(client: AsyncClient, auth_headers: dict):
    response = await client.get("/api/settings/ticket_phases", headers=auth_headers)
    assert response.status_code == 200
    assert isinstance(response.json(), list)

@pytest.mark.asyncio
async def test_update_settings(client: AsyncClient, auth_headers: dict):
    response = await client.put(
        "/api/settings/ticket_phases",
        headers=auth_headers,
        json={"phases": ["Fase1", "Fase2"]}
    )
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert "Fase1" in data
