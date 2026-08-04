import json
from datetime import date, timedelta
# pyrefly: ignore [missing-import]
import pytest
# pyrefly: ignore [missing-import]
from sqlalchemy import func, select
# pyrefly: ignore [missing-import]
from conftest import TestingSessionLocal
from app.models.activity_log import ActivityLog
from app.models.notification import Notification
from app.models.planning_run import PlanningRun
from app.models.project import Project, ProjectStatus
from app.models.task import Task
from app.services.rescheduling_service import run_daily_rescheduling
from app.services.rescheduling_service import undo_rescheduling
from app.utils.working_days import is_working_day


def previous_workday(day: date) -> date:
    candidate = day - timedelta(days=1)
    while not is_working_day(candidate):
        candidate -= timedelta(days=1)
    return candidate


def next_workday(day: date) -> date:
    candidate = day + timedelta(days=1)
    while not is_working_day(candidate):
        candidate += timedelta(days=1)
    return candidate


@pytest.mark.asyncio
async def test_daily_agent_reschedules_active_projects_and_skips_paused_projects(
    db_session,
    test_user,
):
    delayed_day = previous_workday(date.today())
    future_day = date.today()
    while not is_working_day(future_day):
        future_day += timedelta(days=1)
    shifted_future_day = next_workday(future_day)
    active_project = Project(
        name="Commessa gestita dall'agente",
        status=ProjectStatus.ACTIVE,
        owner_id=test_user.id,
        start_date=delayed_day,
        end_date=delayed_day,
        planning_agent_paused=False,
    )
    paused_project = Project(
        name="Commessa con agente in pausa",
        status=ProjectStatus.ACTIVE,
        owner_id=test_user.id,
        start_date=delayed_day,
        end_date=delayed_day,
        planning_agent_paused=True,
    )
    second_active_project = Project(
        name="Seconda commessa dello stesso addetto",
        status=ProjectStatus.ACTIVE,
        owner_id=test_user.id,
        start_date=future_day,
        end_date=future_day,
        planning_agent_paused=False,
    )
    db_session.add_all([active_project, second_active_project, paused_project])
    await db_session.flush()

    active_task = Task(
        project_id=active_project.id,
        text="Fase automatica in ritardo",
        start_date=delayed_day,
        end_date=delayed_day,
        duration=1,
        planned_hours=8,
        workers=json.dumps([test_user.username]),
        worker_hours=json.dumps({test_user.username: 8}),
        actual_hours=json.dumps({test_user.username: {delayed_day.isoformat(): 4}}),
    )
    paused_task = Task(
        project_id=paused_project.id,
        text="Fase che non deve cambiare",
        start_date=delayed_day,
        end_date=delayed_day,
        duration=1,
        planned_hours=8,
        workers=json.dumps([test_user.username]),
        worker_hours=json.dumps({test_user.username: 8}),
        actual_hours="{}",
    )
    paused_delayed_task = Task(
        project_id=paused_project.id,
        text="Ritardo escluso perché la commessa è in pausa",
        start_date=delayed_day,
        end_date=delayed_day,
        duration=1,
        planned_hours=8,
        workers=json.dumps([test_user.username]),
        worker_hours=json.dumps({test_user.username: 8}),
        actual_hours="{}",
    )
    second_project_task = Task(
        project_id=second_active_project.id,
        text="Fase futura dello stesso addetto",
        start_date=future_day,
        end_date=future_day,
        duration=1,
        planned_hours=8,
        workers=json.dumps([test_user.username]),
        worker_hours=json.dumps({test_user.username: 8}),
        actual_hours="{}",
    )
    second_delayed_task = Task(
        project_id=second_active_project.id,
        text="Secondo consuntivo parziale dello stesso addetto",
        start_date=delayed_day,
        end_date=delayed_day,
        duration=1,
        planned_hours=8,
        workers=json.dumps([test_user.username]),
        worker_hours=json.dumps({test_user.username: 8}),
        actual_hours=json.dumps({test_user.username: {delayed_day.isoformat(): 4}}),
    )
    paused_task.start_date = future_day
    paused_task.end_date = future_day
    db_session.add_all([
        active_task,
        second_delayed_task,
        second_project_task,
        paused_task,
        paused_delayed_task,
    ])
    await db_session.commit()

    await run_daily_rescheduling(TestingSessionLocal)

    await db_session.refresh(active_task)
    await db_session.refresh(second_delayed_task)
    await db_session.refresh(second_project_task)
    await db_session.refresh(paused_task)
    await db_session.refresh(paused_delayed_task)
    # Una giornata da 8h interamente non consuntivata viene recuperata nel
    # primo giorno lavorativo utile, senza dilatazioni aggiuntive.
    assert active_task.end_date == future_day
    assert second_delayed_task.end_date == future_day
    assert second_project_task.start_date == shifted_future_day
    assert paused_task.start_date == future_day
    assert paused_delayed_task.end_date == delayed_day

    runs = (await db_session.execute(select(PlanningRun))).scalars().all()
    assert len(runs) == 2
    assert {str(run.project_id) for run in runs} == {str(active_project.id), str(second_active_project.id)}
    assert len({run.batch_id for run in runs}) == 1
    assert all(run.created_by_id is None for run in runs)
    assert all(run.status == "applied" for run in runs)
    assert "Ripianificate 8.0h" in runs[0].solution_summary

    # Una seconda analisi senza nuovi consuntivi mancanti non deve creare
    # ulteriori batch né applicare due volte lo stesso recupero.
    await run_daily_rescheduling(TestingSessionLocal)
    repeated_runs = (await db_session.execute(select(PlanningRun))).scalars().all()
    assert len(repeated_runs) == 2

    automatic_log = (await db_session.execute(
        select(ActivityLog).where(ActivityLog.project_id == active_project.id)
    )).scalar_one()
    assert automatic_log.user_id is None
    assert automatic_log.action_text.startswith("[Agente pianificazione]")

    notification_count = (await db_session.execute(
        select(func.count(Notification.id)).where(Notification.project_id == active_project.id)
    )).scalar_one()
    paused_notification_count = (await db_session.execute(
        select(func.count(Notification.id)).where(Notification.project_id == paused_project.id)
    )).scalar_one()
    assert notification_count >= 1
    assert paused_notification_count == 0

    primary_run = next(run for run in runs if str(run.project_id) == str(active_project.id))
    await undo_rescheduling(db_session, str(active_project.id), str(primary_run.id), test_user)
    await db_session.refresh(active_task)
    await db_session.refresh(second_delayed_task)
    await db_session.refresh(second_project_task)
    await db_session.refresh(paused_task)
    await db_session.refresh(paused_delayed_task)
    assert active_task.end_date == delayed_day
    assert second_delayed_task.end_date == delayed_day
    assert second_project_task.start_date == future_day
    assert paused_task.start_date == future_day
    assert paused_delayed_task.end_date == delayed_day

    rolled_back_runs = (await db_session.execute(select(PlanningRun))).scalars().all()
    assert all(run.status == "undone" for run in rolled_back_runs)
