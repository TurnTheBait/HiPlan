import json
from datetime import date, timedelta

# pyrefly: ignore [missing-import]
import pytest
# pyrefly: ignore [missing-import]
from httpx import AsyncClient
# pyrefly: ignore [missing-import]
from sqlalchemy import select
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity_log import ActivityLog
from app.models.link import Link, LinkType
from app.models.notification import Notification
from app.models.task import Task
from app.models.user import User, UserRole
from app.core.security import hash_password
from app.utils.working_days import is_working_day


def next_workday(day: date) -> date:
    candidate = day + timedelta(days=1)
    while not is_working_day(candidate):
        candidate += timedelta(days=1)
    return candidate


def previous_workday(day: date) -> date:
    candidate = day - timedelta(days=1)
    while not is_working_day(candidate):
        candidate -= timedelta(days=1)
    return candidate


@pytest.mark.asyncio
async def test_apply_and_undo_rescheduling(
    client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_project,
    test_user,
):
    today = date.today()
    delayed_day = previous_workday(today)
    successor_start = next_workday(delayed_day)
    successor_end = next_workday(successor_start)

    delayed = Task(
        project_id=test_project.id,
        text="Fase in ritardo",
        start_date=delayed_day,
        end_date=delayed_day,
        duration=1,
        planned_hours=8,
        workers=json.dumps([test_user.username]),
        worker_hours=json.dumps({test_user.username: 8}),
        actual_hours="{}",
    )
    successor = Task(
        project_id=test_project.id,
        text="Fase dipendente",
        start_date=successor_start,
        end_date=successor_end,
        duration=2,
        planned_hours=8,
        workers="[]",
        actual_hours="{}",
    )
    db_session.add_all([delayed, successor])
    await db_session.flush()
    db_session.add(Link(
        project_id=test_project.id,
        source=delayed.id,
        target=successor.id,
        type=LinkType.FS,
    ))
    await db_session.commit()

    overview = await client.get(
        f"/api/projects/{test_project.id}/rescheduling",
        headers=auth_headers,
    )
    assert overview.status_code == 200
    assert overview.json()["scenarios"][0]["task_id"] == str(delayed.id)

    applied = await client.post(
        f"/api/projects/{test_project.id}/rescheduling/apply",
        headers=auth_headers,
        json={"task_ids": [str(delayed.id)]},
    )
    assert applied.status_code == 200, applied.text
    run = applied.json()
    assert run["status"] == "applied"
    assert any(change["task_id"] == str(successor.id) for change in run["changes"])
    assert run["allocations"][0]["worker"] == test_user.username

    refreshed_overview = await client.get(
        f"/api/projects/{test_project.id}/rescheduling",
        headers=auth_headers,
    )
    assert refreshed_overview.status_code == 200
    assert refreshed_overview.json()["scenarios"] == []

    assert (await db_session.execute(select(ActivityLog))).scalar_one_or_none() is not None
    notification_count = len((await db_session.execute(
        select(Notification)
    )).scalars().all())
    assert notification_count >= 1

    undone = await client.post(
        f"/api/projects/{test_project.id}/rescheduling/{run['id']}/undo",
        headers=auth_headers,
    )
    assert undone.status_code == 200, undone.text
    assert undone.json()["status"] == "undone"

    await db_session.refresh(delayed)
    await db_session.refresh(successor)
    assert delayed.end_date == delayed_day
    assert successor.start_date == successor_start
    assert successor.end_date == successor_end

    paused = await client.post(
        f"/api/projects/{test_project.id}/rescheduling/pause",
        headers=auth_headers,
        json={"paused": True},
    )
    assert paused.status_code == 200
    assert paused.json()["paused"] is True

    manual_while_paused = await client.post(
        f"/api/projects/{test_project.id}/rescheduling/apply",
        headers=auth_headers,
        json={"task_ids": [str(delayed.id)]},
    )
    assert manual_while_paused.status_code == 200

    resumed = await client.post(
        f"/api/projects/{test_project.id}/rescheduling/pause",
        headers=auth_headers,
        json={"paused": False},
    )
    assert resumed.status_code == 200
    assert resumed.json()["paused"] is False


@pytest.mark.asyncio
async def test_viewer_cannot_pause_or_undo_agent_changes(
    client: AsyncClient,
    db_session: AsyncSession,
    test_project,
):
    viewer = User(
        email="viewer-agent@example.com",
        username="viewer-agent",
        hashed_password=hash_password("viewerpass"),
        full_name="Viewer Agent",
        role=UserRole.VIEWER,
        department="ufficio_tecnico",
        is_active=True,
    )
    db_session.add(viewer)
    await db_session.commit()
    login = await client.post(
        "/api/auth/login",
        json={"email": viewer.email, "password": "viewerpass"},
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    overview = await client.get(
        f"/api/projects/{test_project.id}/rescheduling",
        headers=headers,
    )

    pause = await client.post(
        f"/api/projects/{test_project.id}/rescheduling/pause",
        headers=headers,
        json={"paused": True},
    )
    undo = await client.post(
        f"/api/projects/{test_project.id}/rescheduling/00000000-0000-0000-0000-000000000000/undo",
        headers=headers,
    )
    assert overview.status_code == 200
    assert "runs" in overview.json()
    assert pause.status_code == 403
    assert undo.status_code == 403
