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
from app.utils.working_days import is_working_day


def previous_workday(day: date) -> date:
    candidate = day - timedelta(days=1)
    while not is_working_day(candidate):
        candidate -= timedelta(days=1)
    return candidate


@pytest.mark.asyncio
async def test_daily_agent_reschedules_active_projects_and_skips_paused_projects(
    db_session,
    test_user,
):
    delayed_day = previous_workday(date.today())
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
    db_session.add_all([active_project, paused_project])
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
        actual_hours="{}",
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
    db_session.add_all([active_task, paused_task])
    await db_session.commit()

    await run_daily_rescheduling(TestingSessionLocal)

    await db_session.refresh(active_task)
    await db_session.refresh(paused_task)
    assert active_task.end_date > delayed_day
    assert paused_task.end_date == delayed_day

    runs = (await db_session.execute(select(PlanningRun))).scalars().all()
    assert len(runs) == 1
    assert str(runs[0].project_id) == str(active_project.id)
    assert runs[0].created_by_id is None
    assert runs[0].status == "applied"

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
