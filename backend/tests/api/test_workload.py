# pyrefly: ignore [missing-import]
import pytest
# pyrefly: ignore [missing-import]
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_get_workload_heatmap(client: AsyncClient, auth_headers: dict):
    response = await client.get("/api/workload/heatmap", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "heatmap" in data

@pytest.mark.asyncio
async def test_export_workload_pdf(client: AsyncClient, auth_headers: dict):
    # Test planned mode
    response = await client.get("/api/workload/export/pdf?mode=planned", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    
    # Test both mode
    response_both = await client.get("/api/workload/export/pdf?mode=both", headers=auth_headers)
    assert response_both.status_code == 200
    assert response_both.headers["content-type"] == "application/pdf"

@pytest.mark.asyncio
async def test_export_workload_excel(client: AsyncClient, auth_headers: dict):
    # Test planned mode
    response = await client.get("/api/workload/export/excel?mode=planned", headers=auth_headers)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    
    # Test both mode
    response_both = await client.get("/api/workload/export/excel?mode=both", headers=auth_headers)
    assert response_both.status_code == 200
    assert response_both.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
