import pytest
from datetime import date, timedelta
from app.models.project import Project, ProjectStatus
from app.models.task import Task, TaskType
from app.models.user import User, UserRole
from app.services.chat_service import chat_service, normalize_progress
from app.services.project_ai_service import analyze_project_ai
from sqlalchemy.ext.asyncio import AsyncSession


@pytest.mark.asyncio
async def test_normalize_progress():
    assert normalize_progress(None) == 0
    assert normalize_progress(0) == 0
    assert normalize_progress(0.7) == 70
    assert normalize_progress(0.97) == 97
    assert normalize_progress(1.0) == 100
    assert normalize_progress(80) == 80
    assert normalize_progress("invalid") == 0


@pytest.mark.asyncio
async def test_admin_report_kpis_and_tipologia(db_session: AsyncSession):
    # 0. Create user
    user = User(
        email="owner@example.com",
        username="owner_user",
        hashed_password="pw",
        full_name="Owner Admin",
        role=UserRole.ADMIN,
        is_active=True
    )
    db_session.add(user)
    await db_session.flush()

    # 1. Create projects with distinct tipologie
    p_std = Project(
        name="Commessa Standard",
        code="STD-01",
        status=ProjectStatus.ACTIVE,
        owner_id=user.id,
        is_atex=False,
        is_alimentare=False,
        start_date=date.today(),
        end_date=date.today() + timedelta(days=30)
    )
    p_atex = Project(
        name="Commessa ATEX",
        code="ATX-01",
        status=ProjectStatus.ACTIVE,
        owner_id=user.id,
        is_atex=True,
        is_alimentare=False,
        start_date=date.today(),
        end_date=date.today() + timedelta(days=45)
    )
    p_both = Project(
        name="Commessa Ibrida",
        code="HYB-01",
        status=ProjectStatus.PLANNING,
        owner_id=user.id,
        is_atex=True,
        is_alimentare=True,
        start_date=date.today(),
        end_date=date.today() + timedelta(days=60)
    )
    db_session.add_all([p_std, p_atex, p_both])
    await db_session.flush()

    # 2. Add operative tasks with partial and complete progress
    t1 = Task(
        project_id=p_std.id,
        text="Fase Standard 1",
        start_date=date.today(),
        end_date=date.today() + timedelta(days=10),
        duration=10,
        progress=0.7,
        completed=0,
        type=TaskType.TASK
    )
    t2 = Task(
        project_id=p_atex.id,
        text="Fase ATEX 1",
        start_date=date.today(),
        end_date=date.today() + timedelta(days=15),
        duration=15,
        progress=1.0,
        completed=1,
        type=TaskType.TASK
    )
    # Milestone task (should be excluded from operative progress)
    t_m = Task(
        project_id=p_atex.id,
        text="Milestone Collaudo",
        start_date=date.today() + timedelta(days=15),
        end_date=date.today() + timedelta(days=15),
        duration=0,
        progress=0.0,
        completed=0,
        type=TaskType.MILESTONE
    )
    db_session.add_all([t1, t2, t_m])
    await db_session.commit()

    # 3. Generate admin report
    res = await chat_service.generate_admin_report(db_session)
    kpis = res["kpis"]

    assert kpis["total_projects"] >= 3
    assert kpis["atex_projects"] >= 2
    assert kpis["alimentare_projects"] >= 1
    assert kpis["standard_projects"] >= 1
    assert "report" in res
    assert len(res["report"]) > 0

    # Ensure no generic platitudes in the generated report
    report_lower = res["report"].lower()
    assert "monitorare attentamente" not in report_lower
    assert "verificare periodicamente" not in report_lower


@pytest.mark.asyncio
async def test_project_ai_analysis_progress_and_tipologia(db_session: AsyncSession):
    # Create test user
    user = User(
        email="lead@example.com",
        username="lead_user",
        hashed_password="pw",
        full_name="Lead Engineer",
        role=UserRole.ADMIN,
        is_active=True
    )
    db_session.add(user)
    await db_session.flush()

    # Create ATEX project
    p = Project(
        name="Impianto Chimico ATEX",
        code="CHM-99",
        status=ProjectStatus.ACTIVE,
        owner_id=user.id,
        is_atex=True,
        is_alimentare=False,
        start_date=date.today(),
        end_date=date.today() + timedelta(days=90),
        responsible_id=user.id
    )
    db_session.add(p)
    await db_session.flush()

    # Add tasks: 1 completed, 1 in progress at 50% -> average progress = 75%
    t1 = Task(
        project_id=p.id,
        text="Progettazione Quadro",
        start_date=date.today(),
        end_date=date.today() + timedelta(days=10),
        duration=10,
        progress=1.0,
        completed=1,
        type=TaskType.TASK
    )
    t2 = Task(
        project_id=p.id,
        text="Cablaggio e Certificazione ATEX",
        start_date=date.today() + timedelta(days=11),
        end_date=date.today() + timedelta(days=30),
        duration=20,
        progress=0.5,
        completed=0,
        type=TaskType.TASK
    )
    db_session.add_all([t1, t2])
    await db_session.commit()

    analysis_res = await analyze_project_ai(db_session, str(p.id), user)
    assert analysis_res["success"] is True
    assert analysis_res["is_atex"] is True
    assert analysis_res["is_alimentare"] is False
    assert analysis_res["tipologia"] == "ATEX"
    assert "analysis" in analysis_res
    assert len(analysis_res["analysis"]) > 0
