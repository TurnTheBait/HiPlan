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
from app.models.planning_run import PlanningRun
from app.models.project import Project, ProjectStatus
from app.models.task import Task
from app.models.user import User, UserRole
from app.models.vacation import Vacation
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
    # La fase dipendente è volutamente sovrapposta alla sorgente: il recupero
    # deve preservare l'offset, non trasformare il legame in una sequenza rigida.
    successor_start = delayed_day
    successor_end = next_workday(successor_start)
    shifted_successor_start = next_workday(successor_start)
    shifted_successor_end = next_workday(successor_end)
    downstream_start = successor_end
    downstream_end = next_workday(downstream_start)

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
    downstream = Task(
        project_id=test_project.id,
        text="Fase dipendente di secondo livello",
        start_date=downstream_start,
        end_date=downstream_end,
        duration=2,
        planned_hours=8,
        workers="[]",
        actual_hours="{}",
    )
    db_session.add_all([delayed, successor, downstream])
    await db_session.flush()
    db_session.add_all([
        Link(
            project_id=test_project.id,
            source=delayed.id,
            target=successor.id,
            type=LinkType.FS,
        ),
        Link(
            project_id=test_project.id,
            source=successor.id,
            target=downstream.id,
            type=LinkType.FS,
        ),
    ])
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
    assert any(change["task_id"] == str(downstream.id) for change in run["changes"])
    assert run["allocations"][0]["worker"] == test_user.username

    await db_session.refresh(delayed)
    await db_session.refresh(successor)
    await db_session.refresh(downstream)
    assert delayed.end_date == next_workday(delayed_day) # type: ignore
    assert successor.start_date == shifted_successor_start # type: ignore
    assert successor.end_date == shifted_successor_end # type: ignore
    assert downstream.start_date == next_workday(downstream_start) # type: ignore
    assert downstream.end_date == next_workday(downstream_end) # type: ignore

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
    await db_session.refresh(downstream)
    assert delayed.end_date == delayed_day # type: ignore
    assert successor.start_date == successor_start # type: ignore
    assert successor.end_date == successor_end # type: ignore
    assert downstream.start_date == downstream_start # type: ignore
    assert downstream.end_date == downstream_end # type: ignore

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
async def test_partial_timesheet_reschedules_dependencies_and_other_projects(
    client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_project,
    test_user,
):
    delayed_day = previous_workday(date.today())
    first_available_day = next_workday(delayed_day)
    shifted_day = next_workday(first_available_day)
    second_project = Project(
        name="Seconda commessa dello stesso addetto",
        status=ProjectStatus.ACTIVE,
        owner_id=test_user.id,
        start_date=first_available_day,
        end_date=shifted_day,
    )
    db_session.add(second_project)
    await db_session.flush()

    partially_logged = Task(
        project_id=test_project.id,
        text="Fase con consuntivo parziale",
        start_date=delayed_day,
        end_date=delayed_day,
        duration=1,
        planned_hours=8,
        workers=json.dumps([test_user.username]),
        worker_hours=json.dumps({test_user.username: 8}),
        actual_hours=json.dumps({test_user.username: {delayed_day.isoformat(): 4}}),
    )
    same_project_dependency = Task(
        project_id=test_project.id,
        text="Dipendenza nella commessa origine",
        start_date=first_available_day,
        end_date=first_available_day,
        duration=1,
        planned_hours=8,
        workers="[]",
        actual_hours="{}",
    )
    other_project_task = Task(
        project_id=second_project.id,
        text="Altra fase dello stesso addetto",
        start_date=first_available_day,
        end_date=first_available_day,
        duration=1,
        planned_hours=8,
        workers=json.dumps([test_user.username]),
        worker_hours=json.dumps({test_user.username: 8}),
        actual_hours="{}",
    )
    other_project_delayed = Task(
        project_id=second_project.id,
        text="Secondo consuntivo parziale rilevato globalmente",
        start_date=delayed_day,
        end_date=delayed_day,
        duration=1,
        planned_hours=8,
        workers=json.dumps([test_user.username]),
        worker_hours=json.dumps({test_user.username: 8}),
        actual_hours=json.dumps({test_user.username: {delayed_day.isoformat(): 4}}),
    )
    other_project_dependency = Task(
        project_id=second_project.id,
        text="Dipendenza nella seconda commessa",
        start_date=first_available_day,
        end_date=shifted_day,
        duration=2,
        planned_hours=8,
        workers="[]",
        actual_hours="{}",
    )
    db_session.add_all([
        partially_logged,
        same_project_dependency,
        other_project_delayed,
        other_project_task,
        other_project_dependency,
    ])
    await db_session.flush()
    db_session.add_all([
        Link(
            project_id=test_project.id,
            source=partially_logged.id,
            target=same_project_dependency.id,
            type=LinkType.FS,
        ),
        Link(
            project_id=second_project.id,
            source=other_project_task.id,
            target=other_project_dependency.id,
            type=LinkType.FS,
        ),
    ])
    await db_session.commit()

    overview = await client.get(
        f"/api/projects/{test_project.id}/rescheduling",
        headers=auth_headers,
    )
    scenario = next(
        item for item in overview.json()["scenarios"]
        if item["task_id"] == str(partially_logged.id)
    )
    assert overview.status_code == 200
    assert scenario["missing_hours"] == 4
    preview = overview.json()["preview"]
    assert preview["has_changes"] is True
    assert preview["affected_project_count"] == 2
    assert preview["recovered_hours"] == 8
    assert {change["task_id"] for change in preview["changes"]} >= {
        str(partially_logged.id),
        str(same_project_dependency.id),
        str(other_project_delayed.id),
        str(other_project_task.id),
        str(other_project_dependency.id),
    }

    # La visualizzazione del box è una simulazione: nessuna data o riga di
    # audit deve essere persistita prima di "Applica ora".
    for task in (
        partially_logged,
        same_project_dependency,
        other_project_delayed,
        other_project_task,
        other_project_dependency,
    ):
        await db_session.refresh(task)
    assert partially_logged.end_date == delayed_day
    assert other_project_task.start_date == first_available_day
    assert (await db_session.execute(select(PlanningRun))).scalars().all() == []

    applied = await client.post(
        f"/api/projects/{test_project.id}/rescheduling/apply",
        headers=auth_headers,
        json={"task_ids": []},
    )
    assert applied.status_code == 200, applied.text
    run = applied.json()
    assert run["allocations"][0]["hours"] == 4
    assert "Ripianificate 8.0h" in run["solution_summary"]

    for task in (
        partially_logged,
        same_project_dependency,
        other_project_delayed,
        other_project_task,
        other_project_dependency,
    ):
        await db_session.refresh(task)
    assert partially_logged.end_date == first_available_day # type: ignore
    assert same_project_dependency.start_date == shifted_day # type: ignore
    assert other_project_delayed.end_date == first_available_day # type: ignore
    assert other_project_task.start_date == shifted_day # type: ignore
    assert other_project_dependency.start_date == shifted_day # type: ignore
    assert other_project_dependency.end_date == next_workday(shifted_day) # type: ignore

    runs = (await db_session.execute(select(PlanningRun))).scalars().all()
    assert len(runs) == 2
    assert len({item.batch_id for item in runs}) == 1
    assert sum(
        allocation["hours"]
        for item in runs
        for allocation in json.loads(item.allocations_json)
    ) == 8

    undone = await client.post(
        f"/api/projects/{test_project.id}/rescheduling/{run['id']}/undo",
        headers=auth_headers,
    )
    assert undone.status_code == 200, undone.text
    for task in (
        partially_logged,
        same_project_dependency,
        other_project_delayed,
        other_project_task,
        other_project_dependency,
    ):
        await db_session.refresh(task)
    assert partially_logged.end_date == delayed_day # type: ignore
    assert same_project_dependency.start_date == first_available_day # type: ignore
    assert other_project_delayed.end_date == delayed_day # type: ignore
    assert other_project_task.start_date == first_available_day # type: ignore
    assert other_project_dependency.start_date == first_available_day # type: ignore
    assert other_project_dependency.end_date == shifted_day # type: ignore


@pytest.mark.asyncio
async def test_future_timesheet_hours_do_not_hide_an_existing_delay(
    client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_project,
    test_user,
):
    elapsed_day = previous_workday(date.today())
    future_or_current_day = next_workday(elapsed_day)
    task = Task(
        project_id=test_project.id,
        text="Consuntivo futuro non ancora maturato",
        start_date=elapsed_day,
        end_date=future_or_current_day,
        duration=2,
        planned_hours=16,
        workers=json.dumps([test_user.username]),
        worker_hours=json.dumps({test_user.username: 16}),
        actual_hours=json.dumps({
            test_user.username: {future_or_current_day.isoformat(): 8},
        }),
    )
    db_session.add(task)
    await db_session.commit()

    overview = await client.get(
        f"/api/projects/{test_project.id}/rescheduling",
        headers=auth_headers,
    )
    scenario = next(
        item for item in overview.json()["scenarios"]
        if item["task_id"] == str(task.id)
    )
    assert overview.status_code == 200
    assert scenario["missing_hours"] == 8
    assert "8.0h non consuntivate" in scenario["reason"]


@pytest.mark.asyncio
async def test_recovery_skips_vacation_and_propagates_the_effective_delay(
    client: AsyncClient,
    auth_headers: dict,
    db_session: AsyncSession,
    test_project,
    test_user,
):
    delayed_day = previous_workday(date.today())
    unavailable_recovery_day = next_workday(delayed_day)
    recovery_day = next_workday(unavailable_recovery_day)
    expected_dependency_start = next_workday(recovery_day)
    source = Task(
        project_id=test_project.id,
        text="Recupero che incontra un giorno di ferie",
        start_date=delayed_day,
        end_date=delayed_day,
        duration=1,
        planned_hours=8,
        workers=json.dumps([test_user.username]),
        worker_hours=json.dumps({test_user.username: 8}),
        actual_hours="{}",
    )
    dependency = Task(
        project_id=test_project.id,
        text="Dipendenza che conserva il proprio offset",
        start_date=unavailable_recovery_day,
        end_date=unavailable_recovery_day,
        duration=1,
        planned_hours=8,
        workers="[]",
        actual_hours="{}",
    )
    vacation = Vacation(
        user_id=test_user.id,
        start_date=unavailable_recovery_day,
        end_date=unavailable_recovery_day,
        reason="Ferie durante il recupero",
    )
    db_session.add_all([source, dependency, vacation])
    await db_session.flush()
    db_session.add(Link(
        project_id=test_project.id,
        source=source.id,
        target=dependency.id,
        type=LinkType.FS,
    ))
    await db_session.commit()

    applied = await client.post(
        f"/api/projects/{test_project.id}/rescheduling/apply",
        headers=auth_headers,
        json={"task_ids": [str(source.id)]},
    )
    assert applied.status_code == 200, applied.text
    await db_session.refresh(source)
    await db_session.refresh(dependency)
    assert source.end_date == recovery_day # type: ignore
    assert dependency.start_date == expected_dependency_start # type: ignore


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
