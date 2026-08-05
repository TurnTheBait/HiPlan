# pyrefly: ignore [missing-import]
import pytest
# pyrefly: ignore [missing-import]
import pytest_asyncio
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
from unittest.mock import patch, AsyncMock
from app.services.rescheduling_agent import (
    is_agent_enabled,
    set_agent_enabled,
    get_agent_status,
    run_rescheduling_agent,
    revert_agent_log,
)
from app.models.setting import Setting
from app.models.task import Task
from app.models.project import Project
from app.models.user import User
from app.models.vacation import Vacation
from app.models.link import Link
from app.models.agent_log import AgentLog
import datetime
# pyrefly: ignore [missing-import]
from sqlalchemy import select

# This fixture provides a mock for AsyncSessionLocal to return our test db_session
@pytest_asyncio.fixture
def mock_session_local(db_session):
    class MockSessionContext:
        async def __aenter__(self):
            return db_session
        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass
            
    with patch("app.services.rescheduling_agent.AsyncSessionLocal", return_value=MockSessionContext()):
        yield db_session

@pytest.mark.asyncio
async def test_agent_status_functions(db_session: AsyncSession):
    # Test default
    enabled = await is_agent_enabled(db_session)
    assert enabled is True

    # Test toggling
    await set_agent_enabled(db_session, False)
    enabled = await is_agent_enabled(db_session)
    assert enabled is False

    # Test status
    status = await get_agent_status(db_session)
    assert status["enabled"] is False
    assert status["last_run"] is None
    assert status["last_toggled"] is not None

@pytest.mark.asyncio
async def test_run_rescheduling_agent_no_tasks(mock_session_local):
    stats = await run_rescheduling_agent(dry_run=False)
    assert stats["phases_rescheduled"] == 0
    assert stats["vacation_conflicts"] == 0

@pytest.mark.asyncio
async def test_run_rescheduling_agent_with_vacation_conflict(mock_session_local, test_project: Project, test_user: User):
    session = mock_session_local
    
    today = datetime.date.today()
    
    # Create a vacation for test_user for tomorrow
    vac = Vacation(
        user_id=test_user.id,
        start_date=today + datetime.timedelta(days=1),
        end_date=today + datetime.timedelta(days=3),
        reason="Holidays"
    )
    session.add(vac)
    
    # Create a task assigned to test_user that overlaps with the vacation
    task = Task(
        text="Overlapping Task",
        start_date=today + datetime.timedelta(days=1),
        duration=2,
        end_date=today + datetime.timedelta(days=3),
        project_id=test_project.id,
        assigned_to=test_user.id,
        workers='["Test User"]',
        type="task"
    )
    session.add(task)
    await session.commit()
    
    # Run the agent
    stats = await run_rescheduling_agent(dry_run=False)
    assert stats["vacation_conflicts"] == 1
    
    # Verify the task was shifted
    await session.refresh(task)
    assert task.start_date > today + datetime.timedelta(days=3)

@pytest.mark.asyncio
async def test_revert_agent_log(mock_session_local, test_project: Project, test_user: User):
    session = mock_session_local
    today = datetime.date.today()
    
    task = Task(
        id="task_123",
        text="Task to revert",
        start_date=today + datetime.timedelta(days=5),
        duration=2,
        end_date=today + datetime.timedelta(days=7),
        project_id=test_project.id,
        assigned_to=test_user.id,
        type="task"
    )
    session.add(task)
    
    log = AgentLog(
        id="log_1",
        action_type="vacation_conflict",
        task_id="task_123",
        task_name="Task to revert",
        project_name="Test Project",
        old_start_date=today,
        old_end_date=today + datetime.timedelta(days=2),
        old_duration=2,
        new_start_date=today + datetime.timedelta(days=5),
        new_end_date=today + datetime.timedelta(days=7),
        new_duration=2,
        reverted=0
    )
    session.add(log)
    await session.commit()
    
    # Call revert
    res = await revert_agent_log("log_1", "admin")
    assert res["ok"] is True
    
    # Verify the task was restored to old dates
    await session.refresh(task)
    assert task.start_date == today
    
    # Verify the log is marked as reverted
    await session.refresh(log)
    assert log.reverted == 1
    assert log.reverted_by == "admin"
    assert log.reverted_at is not None

@pytest.mark.asyncio
async def test_run_rescheduling_agent_with_overbooking(mock_session_local, test_project: Project, test_user: User):
    session = mock_session_local

    today = datetime.date.today()
    # 2 tasks that overlap, each with 8 planned_hours, both for test_user.
    # Total daily hours = 16 > 8, should trigger overbooking resolution.
    
    task1 = Task(
        text="Overbooking Task 1",
        start_date=today + datetime.timedelta(days=1),
        duration=1,
        end_date=today + datetime.timedelta(days=1),
        project_id=test_project.id,
        assigned_to=test_user.id,
        workers='["Test User"]',
        planned_hours=8.0,
        sort_order=1,
        type="task"
    )
    
    task2 = Task(
        text="Overbooking Task 2",
        start_date=today + datetime.timedelta(days=1),
        duration=1,
        end_date=today + datetime.timedelta(days=1),
        project_id=test_project.id,
        assigned_to=test_user.id,
        workers='["Test User"]',
        planned_hours=8.0,
        sort_order=2,
        type="task"
    )
    
    session.add(task1)
    session.add(task2)
    await session.commit()

    stats = await run_rescheduling_agent(dry_run=False)
    
    assert stats["overbooking_resolved"] == 1
    
    # Task2 should be shifted forward
    await session.refresh(task1)
    await session.refresh(task2)
    
    assert task2.start_date > task1.start_date
