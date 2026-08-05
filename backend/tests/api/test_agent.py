# pyrefly: ignore [missing-import]
import pytest
# pyrefly: ignore [missing-import]
import pytest_asyncio
# pyrefly: ignore [missing-import]
from httpx import AsyncClient
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.setting import Setting
from unittest.mock import patch, AsyncMock
import datetime

@pytest_asyncio.fixture
def mock_run_agent():
    with patch("app.api.agent.run_rescheduling_agent") as mock:
        mock.return_value = {
            "phases_rescheduled": 0,
            "cascade_rescheduled": 2,
            "conflicts_detected": 0,
            "vacation_conflicts": 1,
            "lag_detected": 0,
            "overbooking_resolved": 0,
            "errors": []
        }
        yield mock

@pytest.mark.asyncio
async def test_get_agent_status(client: AsyncClient, auth_headers: dict):
    response = await client.get("/api/agent/status", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "enabled" in data
    assert "last_run" in data

@pytest.mark.asyncio
async def test_toggle_agent(client: AsyncClient, auth_headers: dict, db_session: AsyncSession):
    response = await client.post("/api/agent/toggle", params={"enabled": "false"}, headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["enabled"] is False

@pytest.mark.asyncio
async def test_analyze_agent(client: AsyncClient, auth_headers: dict, mock_run_agent):
    response = await client.post("/api/agent/analyze", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["vacation_conflicts"] == 1
    assert data["cascade_rescheduled"] == 2
    mock_run_agent.assert_called_once_with(dry_run=True)

@pytest.mark.asyncio
async def test_run_now_agent(client: AsyncClient, auth_headers: dict, mock_run_agent):
    response = await client.post("/api/agent/run-now", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["vacation_conflicts"] == 1
    mock_run_agent.assert_called_once_with(dry_run=False)

@pytest.mark.asyncio
async def test_get_agent_logs(client: AsyncClient, auth_headers: dict, db_session: AsyncSession):
    # Populate a fake log
    from app.models.agent_log import AgentLog
    
    log = AgentLog(
        id="test_log_1",
        action_type="vacation_conflict",
        task_name="Test Task",
        project_name="Test Project",
        reverted=0
    )
    db_session.add(log)
    await db_session.commit()
    
    response = await client.get("/api/agent/logs", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1

@pytest.mark.asyncio
async def test_revert_log(client: AsyncClient, auth_headers: dict):
    with patch("app.api.agent.revert_agent_log") as mock_revert:
        mock_revert.return_value = {"ok": True}
        response = await client.post("/api/agent/logs/test_log_1/revert", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True
        # Verify it was called with the right arguments
        mock_revert.assert_called_once()
        args, _ = mock_revert.call_args
        assert args[0] == "test_log_1"
