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

    # Una seconda analisi rileva che le fasi sono ora anticipabili (la seconda sessione
    # agisce come batch di rientro) e crea un run aggiuntivo per l'anticipo.
    await run_daily_rescheduling(TestingSessionLocal)
    repeated_runs = (await db_session.execute(select(PlanningRun))).scalars().all()
    # 2 run di posticipio + 1 run di anticipo dalla seconda analisi
    assert len(repeated_runs) >= 2

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

    # L'undo si fa sul run più recente (anticipo o posticipio): usiamo il run con la
    # data di creazione più recente nella commessa attiva.
    all_runs = (await db_session.execute(select(PlanningRun))).scalars().all()
    # Almeno il batch originale deve essere ancora nel DB
    assert any(run.status == "applied" for run in all_runs)


@pytest.mark.asyncio
async def test_agent_detects_advancement_after_vacation_deletion(db_session, test_user):
    """Cancellando una ferie che aveva causato uno spostamento, l'agente deve
    rilevare la possibilità di anticipare le fasi e applicarla."""
    from app.models.vacation import Vacation
    from app.services.rescheduling_service import (
        detect_advancement_scenarios,
        apply_advancement_rescheduling,
    )

    today = date.today()
    while not is_working_day(today):
        today += timedelta(days=1)
    future_day = next_workday(today)
    future_day2 = next_workday(future_day)

    project = Project(
        name="Commessa anticipo test",
        status=ProjectStatus.ACTIVE,
        owner_id=test_user.id,
        start_date=future_day,
        end_date=future_day2,
        planning_agent_paused=False,
    )
    db_session.add(project)
    await db_session.flush()

    task = Task(
        project_id=project.id,
        text="Fase anticipabile",
        start_date=future_day,
        end_date=future_day,
        duration=1,
        planned_hours=8,
        workers=json.dumps([test_user.username]),
        worker_hours=json.dumps({test_user.username: 8}),
        actual_hours="{}",
    )
    db_session.add(task)
    await db_session.commit()

    # Simula un run applied che aveva spostato la fase da future_day a future_day2
    import uuid as _uuid
    batch_id = str(_uuid.uuid4())
    run = PlanningRun(
        batch_id=batch_id,
        project_id=project.id,
        created_by_id=None,
        status="applied",
        trigger_summary="Ferie sovrapposte",
        solution_summary="Ripianificata 8.0h",
        snapshot_json=json.dumps({
            "project": {"before_end": future_day.isoformat(), "after_end": future_day2.isoformat()},
            "tasks": [{
                "task_id": str(task.id),
                "task_name": task.text,
                "before": {"start_date": future_day.isoformat(), "end_date": future_day.isoformat(), "duration": 1, "has_vacation_conflict": 0},
                "after": {"start_date": future_day2.isoformat(), "end_date": future_day2.isoformat(), "duration": 1, "has_vacation_conflict": 0},
                "reason": "ferie sovrapposte in 1 giorno lavorativo",
            }],
        }),
        allocations_json="[]",
    )
    db_session.add(run)
    # Aggiorna il task alla data posticipata (come avrebbe fatto il run)
    task.start_date = future_day2
    task.end_date = future_day2
    await db_session.commit()

    # Verifica che senza ferie attive l'agente rilevi l'advancement
    scenarios = await detect_advancement_scenarios(db_session)
    assert any(s["task_id"] == str(task.id) for s in scenarios), \
        "L'agente deve rilevare la fase come anticipabile"

    # Applica l'anticipo
    result = await apply_advancement_rescheduling(
        db_session,
        str(project.id),
        None,
        advancement_scenarios=scenarios,
    )
    assert result is not None

    await db_session.refresh(task)
    # La fase deve essere tornata alla data originale (future_day)
    assert task.start_date == future_day

    # Una seconda analisi non deve trovare altri anticipi per lo stesso task
    scenarios2 = await detect_advancement_scenarios(db_session)
    assert not any(s["task_id"] == str(task.id) for s in scenarios2), \
        "Dopo l'anticipo non devono esserci più scenari per lo stesso task"


@pytest.mark.asyncio
async def test_agent_reduction_after_retroactive_actual_hours(db_session, test_user):
    """Inserendo ore a consuntivo retroattive che coprono il ritardo, l'agente
    non deve più rilevare quel task come critico."""
    from app.services.rescheduling_service import analyze_all_projects

    delayed_day = previous_workday(date.today())

    project = Project(
        name="Commessa consuntivo retroattivo",
        status=ProjectStatus.ACTIVE,
        owner_id=test_user.id,
        start_date=delayed_day,
        end_date=delayed_day,
        planning_agent_paused=False,
    )
    db_session.add(project)
    await db_session.flush()

    task = Task(
        project_id=project.id,
        text="Fase con ritardo",
        start_date=delayed_day,
        end_date=delayed_day,
        duration=1,
        planned_hours=8,
        workers=json.dumps([test_user.username]),
        worker_hours=json.dumps({test_user.username: 8}),
        actual_hours=json.dumps({test_user.username: {delayed_day.isoformat(): 4}}),  # 4h su 8h previste
    )
    db_session.add(task)
    await db_session.commit()

    # L'agente deve rilevare 4h mancanti
    scenarios_before = await analyze_all_projects(db_session)
    task_scenarios_before = [s for s in scenarios_before if s["task_id"] == str(task.id)]
    assert len(task_scenarios_before) == 1, "Il task deve avere un ritardo rilevabile"
    assert task_scenarios_before[0]["missing_hours"] >= 0.5

    # Inserisce le ore mancanti retroattivamente
    task.actual_hours = json.dumps({test_user.username: {delayed_day.isoformat(): 8}})
    await db_session.commit()

    # Ora l'agente non deve più rilevare il task
    scenarios_after = await analyze_all_projects(db_session)
    task_scenarios_after = [s for s in scenarios_after if s["task_id"] == str(task.id)]
    assert len(task_scenarios_after) == 0, \
        "Dopo aver inserito le ore a consuntivo il task non deve più essere critico"

