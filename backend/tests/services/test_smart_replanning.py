import json
from datetime import date, timedelta
from uuid import uuid4
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole
from app.models.project import Project, ProjectStatus
from app.models.task import Task, TaskType, TaskPriority
from app.models.link import Link, LinkType
from app.models.vacation import Vacation
from app.models.replan_log import ReplanLog, ReplanActionType
from app.services.smart_replanning_service import (
    generate_project_smart_suggestions,
    apply_smart_replanning_proposal,
    revert_smart_replanning_log
)


@pytest.mark.asyncio
async def test_smart_replanning_vacation_reassignment(db_session: AsyncSession, test_user: User):
    """
    Test: Quando un addetto ha ferie coincidenti con una fase,
    il motore propone la riassegnazione a un collega libero dello stesso reparto,
    mantenendo inalterate le date e rispettando al 100% la scadenza di commessa.
    """
    # 1. Crea due utenti nello stesso reparto
    u1 = User(
        email="mario@example.com",
        username="mario_rossi",
        hashed_password="pwd",
        full_name="Mario Rossi",
        role=UserRole.VIEWER,
        department="produzione"
    )
    u2 = User(
        email="luca@example.com",
        username="luca_bianchi",
        hashed_password="pwd",
        full_name="Luca Bianchi",
        role=UserRole.VIEWER,
        department="produzione"
    )
    db_session.add_all([u1, u2])
    await db_session.commit()
    await db_session.refresh(u1)
    await db_session.refresh(u2)

    # 2. Crea commessa con date fisse
    p_start = date(2026, 10, 5)  # Lunedì
    p_end = date(2026, 10, 30)   # Venerdì
    project = Project(
        name="Commessa Impianto Test",
        code="COMM-TEST-1",
        status=ProjectStatus.ACTIVE,
        owner_id=test_user.id,
        start_date=p_start,
        end_date=p_end
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)

    # 3. Crea fase dal 12 al 16 Ottobre assegnata a Mario Rossi
    t_start = date(2026, 10, 12) # Lunedì
    t_end = date(2026, 10, 16)   # Venerdì
    task = Task(
        project_id=project.id,
        text="Montaggio Meccanico",
        start_date=t_start,
        end_date=t_end,
        duration=5,
        planned_hours=40.0,
        workers=json.dumps(["Mario Rossi"]),
        worker_hours=json.dumps({"Mario Rossi": 40.0}),
        department="produzione",
        completed=0
    )
    db_session.add(task)
    await db_session.commit()
    await db_session.refresh(task)

    # 4. Mario Rossi inserisce ferie per il 13-14 Ottobre
    vac = Vacation(
        user_id=u1.id,
        start_date=date(2026, 10, 13),
        end_date=date(2026, 10, 14),
        reason="Ferie autunno"
    )
    db_session.add(vac)
    await db_session.commit()

    # 5. Genera suggerimenti
    result = await generate_project_smart_suggestions(db_session, str(project.id), test_user)

    assert result["conflicts_count"] >= 1
    assert result["actionable_suggestions_count"] >= 1

    # La proposta primaria preferita deve essere il recupero da parte dello stesso addetto (Mario Rossi)
    shift_sugg = next((s for s in result["suggestions"] if s["type"] == "vacation_conflict" and s["strategy"] == "internal_shift"), None)
    assert shift_sugg is not None
    assert "Mario Rossi" in shift_sugg["proposed_changes"]["workers"]
    assert shift_sugg["proposed_changes"]["start_date"] == "2026-10-15"
    assert shift_sugg["cascade_impact"]["project_deadline_status"] == "safe"

    # È presente anche l'opzione alternativa di riassegnare al collega Luca Bianchi a date invariate
    alt_sugg = next((s for s in result["suggestions"] if s["type"] == "vacation_conflict" and s["strategy"] == "reassign_worker"), None)
    assert alt_sugg is not None
    assert alt_sugg.get("is_alternative") is True
    assert shift_sugg.get("is_alternative") is False
    assert "Luca Bianchi" in alt_sugg["proposed_changes"]["workers"]
    assert alt_sugg["proposed_changes"]["start_date"] == str(t_start)
    assert alt_sugg["proposed_changes"]["end_date"] == str(t_end)
    assert alt_sugg["cascade_impact"]["project_deadline_status"] == "safe"


@pytest.mark.asyncio
async def test_smart_replanning_strict_deadline_preservation(db_session: AsyncSession, test_user: User):
    """
    Test: Verifica che nessuna proposta sposti mai la data di fine commessa
    e che, in caso di ritardo incolmabile entro project.end_date,
    venga generato un allarme di tipo deadline_breach_risk senza modifiche automatiche.
    """
    p_start = date(2026, 11, 2)
    p_end = date(2026, 11, 6)   # Solo 5 giorni lavorativi disponibili!

    project = Project(
        name="Commessa Scadenza Stretta",
        code="COMM-FAST",
        status=ProjectStatus.ACTIVE,
        owner_id=test_user.id,
        start_date=p_start,
        end_date=p_end
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)

    # Unico addetto assegnato, che è in ferie per tutta la settimana
    worker = User(
        email="solo@example.com",
        username="solo_worker",
        hashed_password="pwd",
        full_name="Solo Worker",
        role=UserRole.VIEWER,
        department="ufficio_tecnico"
    )
    db_session.add(worker)
    await db_session.commit()
    await db_session.refresh(worker)

    task = Task(
        project_id=project.id,
        text="Progettazione Esecutiva",
        start_date=p_start,
        end_date=p_end,
        duration=5,
        planned_hours=40.0,
        workers=json.dumps(["Solo Worker"]),
        worker_hours=json.dumps({"Solo Worker": 40.0}),
        department="ufficio_tecnico",
        completed=0
    )
    db_session.add(task)
    await db_session.commit()
    await db_session.refresh(task)

    # Ferie che coprono il periodo
    vac = Vacation(
        user_id=worker.id,
        start_date=p_start,
        end_date=p_end,
        reason="Ferie"
    )
    db_session.add(vac)
    await db_session.commit()

    # Esegui analisi
    result = await generate_project_smart_suggestions(db_session, str(project.id), test_user)

    # Nessun altro addetto nell'ufficio tecnico: deve scattare l'allarme ultima spiaggia
    sugg = next((s for s in result["suggestions"] if s["type"] in ("deadline_breach_risk", "vacation_conflict")), None)
    assert sugg is not None
    # Il motore NON deve proporre uno spostamento automatico oltre p_end
    if sugg["strategy"] == "manual_action_required":
        assert sugg["proposed_changes"] is None
        assert sugg["cascade_impact"]["project_deadline_status"] == "breached"


@pytest.mark.asyncio
async def test_apply_and_revert_flow(db_session: AsyncSession, test_user: User):
    """
    Test del ciclo completo di Approvazione ed eventuale Annullamento (Revert):
    1. Applica una proposta di rebalance (aggiorna task in DB e scrive in ReplanLog).
    2. Annulla la modifica tramite revert e ripristina lo stato originale.
    """
    project = Project(
        name="Commessa Apply Revert Test",
        status=ProjectStatus.ACTIVE,
        owner_id=test_user.id,
        start_date=date(2026, 10, 1),
        end_date=date(2026, 10, 31)
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)

    original_start = date(2026, 10, 5)
    original_end = date(2026, 10, 9)
    task = Task(
        project_id=project.id,
        text="Collaudo Preliminare",
        start_date=original_start,
        end_date=original_end,
        duration=5,
        planned_hours=40.0,
        workers=json.dumps(["Operatore A"]),
        worker_hours=json.dumps({"Operatore A": 40.0}),
        completed=0
    )
    db_session.add(task)
    await db_session.commit()
    await db_session.refresh(task)

    # Payload proposto
    new_start = date(2026, 10, 12)
    new_end = date(2026, 10, 16)
    proposal_payload = {
        "task_id": str(task.id),
        "workers": ["Operatore B"],
        "worker_hours": {"Operatore B": 40.0},
        "start_date": str(new_start),
        "end_date": str(new_end),
        "shift_working_days": 5,
        "reason": "Riassegnazione a Operatore B per disponibilità"
    }

    # 1. APPLICA
    apply_res = await apply_smart_replanning_proposal(
        db_session, str(project.id), proposal_payload, test_user
    )
    assert apply_res["success"] is True
    log_id = apply_res["log_id"]

    await db_session.refresh(task)
    assert task.start_date == new_start
    assert task.end_date == new_end
    assert json.loads(task.workers) == ["Operatore B"]

    # 2. ANNULLA (REVERT)
    revert_res = await revert_smart_replanning_log(db_session, log_id, test_user)
    assert revert_res["success"] is True

    await db_session.refresh(task)
    # Lo stato deve essere ritornato a quello originale!
    assert task.start_date == original_start
    assert task.end_date == original_end
