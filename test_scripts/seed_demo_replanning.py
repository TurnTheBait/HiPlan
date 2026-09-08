import asyncio
import json
from datetime import date
from sqlalchemy import select
from app.models.base import AsyncSessionLocal
from app.models.user import User
from app.models.project import Project, ProjectStatus
from app.models.task import Task, TaskType, TaskPriority
from app.models.link import Link, LinkType
from app.models.replan_log import ReplanLog

async def seed_demo_replanning():
    async with AsyncSessionLocal() as session:
        # Recupera utente admin o primo utente disponibile
        res = await session.execute(select(User).where(User.username.in_(["admin", "davide"])).limit(1))
        user = res.scalars().first()
        if not user:
            res_any = await session.execute(select(User).limit(1))
            user = res_any.scalars().first()

        project_codes = ["TEST-REB-2026", "TEST-COMM-BETA", "TEST-COMM-GAMMA"]

        # Elimina eventuali vecchie commesse demo con relativi task, link e log di replanning
        for code in project_codes:
            old_res = await session.execute(select(Project).where(Project.code == code))
            old_p = old_res.scalars().first()
            if old_p:
                # Elimina replan_logs associati
                logs_res = await session.execute(select(ReplanLog).where(ReplanLog.project_id == old_p.id))
                for l in logs_res.scalars().all():
                    await session.delete(l)
                await session.delete(old_p)

        await session.commit()

        # =====================================================================
        # 1. COMMESSA ALFA: TEST-REB-2026
        # Scenari:
        # - Fase 1 scaduta (ritardo) con slittamento a valle di Fase 2 e Fase 4
        # - Conflitto ferie su Franco (Prod) nella Fase 3 (7-9 Settembre)
        # - Sovraccarico e riprogrammazione a cascata interna e cross-commessa
        # - Ideale per testare:
        #   a) Ricalcolo automatico ad ogni modifica nel Gantt
        #   b) Tasto 'Applica Modifiche Consigliate' nella preview simulazione
        #   c) Tasto 'Annulla con Cascate' che ripristina Fase 1 e le cascate
        # =====================================================================
        p_alfa = Project(
            code="TEST-REB-2026",
            name="Commessa Test Rebalance - Impianto Alfa",
            client="Alfa Meccanica S.p.A.",
            description="Commessa dimostrativa principale per collaudare Rebalance Intelligente, cascate e annullamento.",
            notes="Fase 1 scaduta, dipendenze a cascata FS su Fase 2 e 4, conflitto ferie su Franco (Prod).",
            start_date=date(2026, 8, 25),
            end_date=date(2026, 10, 30),
            status=ProjectStatus.ACTIVE,
            owner_id=user.id,
            responsible_id=user.id,
            assigned_workers=json.dumps(["Marco (UT)", "Anna (UT)", "Franco (Prod)", "Roberto (Prod)", "Giovanni (Prod)"])
        )
        session.add(p_alfa)
        await session.commit()
        await session.refresh(p_alfa)

        # Fase 1: scaduta il 02/09/2026, mancano ancora 38 ore
        t1 = Task(
            project_id=p_alfa.id,
            text="Fase 1: Disegno Schemi Elettrici",
            start_date=date(2026, 8, 25),
            end_date=date(2026, 9, 2),
            duration=6,
            progress=0.20,
            type=TaskType.TASK,
            priority=TaskPriority.HIGH,
            sort_order=1,
            planned_hours=48.0,
            workers=json.dumps(["Marco (UT)"]),
            worker_hours=json.dumps({"Marco (UT)": 48.0}),
            department="ufficio_tecnico",
            completed=0
        )
        # Fase 2: dipendente da Fase 1
        t2 = Task(
            project_id=p_alfa.id,
            text="Fase 2: Approvazione Componenti e Distinta Base",
            start_date=date(2026, 9, 3),
            end_date=date(2026, 9, 7),
            duration=3,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.MEDIUM,
            sort_order=2,
            planned_hours=24.0,
            workers=json.dumps(["Anna (UT)"]),
            worker_hours=json.dumps({"Anna (UT)": 24.0}),
            department="ufficio_tecnico",
            completed=0
        )
        # Fase 3: conflitto con ferie di Franco (7-9 Settembre)
        t3 = Task(
            project_id=p_alfa.id,
            text="Fase 3: Assemblaggio Meccanico Principale",
            start_date=date(2026, 9, 7),
            end_date=date(2026, 9, 11),
            duration=5,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.CRITICAL,
            sort_order=3,
            planned_hours=40.0,
            workers=json.dumps(["Franco (Prod)"]),
            worker_hours=json.dumps({"Franco (Prod)": 40.0}),
            department="produzione",
            completed=0
        )
        # Fase 4: a valle di Fase 2 e Fase 3
        t4 = Task(
            project_id=p_alfa.id,
            text="Fase 4: Cablaggio e Collaudo Finale",
            start_date=date(2026, 9, 14),
            end_date=date(2026, 9, 21),
            duration=6,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.HIGH,
            sort_order=4,
            planned_hours=48.0,
            workers=json.dumps(["Roberto (Prod)"]),
            worker_hours=json.dumps({"Roberto (Prod)": 48.0}),
            department="produzione",
            completed=0
        )
        # Fase 5: fase indipendente di spedizione
        t5 = Task(
            project_id=p_alfa.id,
            text="Fase 5: Preparazione Documenti e Spedizione",
            start_date=date(2026, 9, 22),
            end_date=date(2026, 9, 25),
            duration=4,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.MEDIUM,
            sort_order=5,
            planned_hours=16.0,
            workers=json.dumps(["Giovanni (Prod)"]),
            worker_hours=json.dumps({"Giovanni (Prod)": 16.0}),
            department="produzione",
            completed=0
        )

        session.add_all([t1, t2, t3, t4, t5])
        await session.commit()
        await session.refresh(t1)
        await session.refresh(t2)
        await session.refresh(t3)
        await session.refresh(t4)
        await session.refresh(t5)

        # Dipendenze FS
        # t1 -> t2
        link1 = Link(project_id=p_alfa.id, source=t1.id, target=t2.id, type=LinkType.FS, lag=0)
        # t2 -> t4
        link2 = Link(project_id=p_alfa.id, source=t2.id, target=t4.id, type=LinkType.FS, lag=0)
        # t3 -> t4
        link3 = Link(project_id=p_alfa.id, source=t3.id, target=t4.id, type=LinkType.FS, lag=0)
        # t4 -> t5
        link4 = Link(project_id=p_alfa.id, source=t4.id, target=t5.id, type=LinkType.FS, lag=0)
        session.add_all([link1, link2, link3, link4])
        await session.commit()

        # =====================================================================
        # 2. COMMESSA BETA: TEST-COMM-BETA
        # Condivide Marco (UT) e Anna (UT). Permette di visualizzare le
        # sovrapposizioni orarie multi-commessa e le correzioni correlate.
        # =====================================================================
        p_beta = Project(
            code="TEST-COMM-BETA",
            name="Linea Confezionamento Alimentare - Dolciaria",
            client="Dolciaria Emiliana S.p.A.",
            description="Commessa concomitante per testare carichi condivisi cross-commessa su Marco (UT) e Anna (UT).",
            notes="Condivide risorse chiave con Impianto Alfa.",
            start_date=date(2026, 9, 1),
            end_date=date(2026, 11, 15),
            status=ProjectStatus.ACTIVE,
            owner_id=user.id,
            responsible_id=user.id,
            is_alimentare=True,
            assigned_workers=json.dumps(["Marco (UT)", "Anna (UT)", "Giovanni (Prod)"])
        )
        session.add(p_beta)
        await session.commit()
        await session.refresh(p_beta)

        tb1 = Task(
            project_id=p_beta.id,
            text="Progettazione Nastro Trasportatore e Dosaggio",
            start_date=date(2026, 9, 7),
            end_date=date(2026, 9, 11),
            duration=5,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.HIGH,
            sort_order=1,
            planned_hours=32.0,
            workers=json.dumps(["Marco (UT)"]),
            worker_hours=json.dumps({"Marco (UT)": 32.0}),
            department="ufficio_tecnico",
            completed=0
        )
        tb2 = Task(
            project_id=p_beta.id,
            text="Validazione MOCA Nastri e Idoneità Alimentare",
            start_date=date(2026, 9, 15),
            end_date=date(2026, 9, 18),
            duration=4,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.MEDIUM,
            sort_order=2,
            planned_hours=24.0,
            workers=json.dumps(["Anna (UT)"]),
            worker_hours=json.dumps({"Anna (UT)": 24.0}),
            department="ufficio_tecnico",
            completed=0
        )
        tb3 = Task(
            project_id=p_beta.id,
            text="Montaggio Struttura Inox e Motorizzazione",
            start_date=date(2026, 9, 21),
            end_date=date(2026, 9, 30),
            duration=8,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.HIGH,
            sort_order=3,
            planned_hours=64.0,
            workers=json.dumps(["Giovanni (Prod)"]),
            worker_hours=json.dumps({"Giovanni (Prod)": 64.0}),
            department="produzione",
            completed=0
        )
        session.add_all([tb1, tb2, tb3])
        await session.commit()
        await session.refresh(tb1)
        await session.refresh(tb2)
        await session.refresh(tb3)

        l_beta = Link(
            project_id=p_beta.id,
            source=tb1.id,
            target=tb3.id,
            type=LinkType.FS,
            lag=0
        )
        session.add(l_beta)
        await session.commit()

        # =====================================================================
        # 3. COMMESSA GAMMA: TEST-COMM-GAMMA
        # Scadenza contrattuale rigida al 18/09/2026.
        # Ritardo critico che supererebbe la data di fine commessa:
        # Dimostra l'allarme 'Intervento Manuale Necessario' senza spostamenti abusivi.
        # =====================================================================
        p_gamma = Project(
            code="TEST-COMM-GAMMA",
            name="Revamping Verniciatura ATEX - Scadenza Stretta",
            client="Colorificio Veneto S.r.l.",
            description="Commessa con scadenza contrattuale rigida al 18/09. Ritardo che dimostra l'allarme ultima spiaggia.",
            notes="Dimostra la salvaguardia della deadline finale.",
            start_date=date(2026, 8, 20),
            end_date=date(2026, 9, 18),
            status=ProjectStatus.ACTIVE,
            owner_id=user.id,
            responsible_id=user.id,
            is_atex=True,
            assigned_workers=json.dumps(["Luigi (UT)", "Laura (Acq)", "Roberto (Prod)"])
        )
        session.add(p_gamma)
        await session.commit()
        await session.refresh(p_gamma)

        tg1 = Task(
            project_id=p_gamma.id,
            text="Progettazione Quadri Ex-d e Pressurizzazione",
            start_date=date(2026, 8, 24),
            end_date=date(2026, 9, 1),
            duration=6,
            progress=0.10,
            type=TaskType.TASK,
            priority=TaskPriority.CRITICAL,
            sort_order=1,
            planned_hours=48.0,
            workers=json.dumps(["Luigi (UT)"]),
            worker_hours=json.dumps({"Luigi (UT)": 48.0}),
            department="ufficio_tecnico",
            completed=0
        )
        tg2 = Task(
            project_id=p_gamma.id,
            text="Fornitura Cabine Pressurizzate e Barriere ATEX",
            start_date=date(2026, 9, 2),
            end_date=date(2026, 9, 9),
            duration=6,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.HIGH,
            sort_order=2,
            planned_hours=32.0,
            workers=json.dumps(["Laura (Acq)"]),
            worker_hours=json.dumps({"Laura (Acq)": 32.0}),
            department="acquisti",
            completed=0
        )
        tg3 = Task(
            project_id=p_gamma.id,
            text="Installazione Impianto e Collaudo Finale ATEX",
            start_date=date(2026, 9, 10),
            end_date=date(2026, 9, 18),
            duration=7,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.CRITICAL,
            sort_order=3,
            planned_hours=56.0,
            workers=json.dumps(["Roberto (Prod)"]),
            worker_hours=json.dumps({"Roberto (Prod)": 56.0}),
            department="produzione",
            completed=0
        )
        session.add_all([tg1, tg2, tg3])
        await session.commit()
        await session.refresh(tg1)
        await session.refresh(tg2)
        await session.refresh(tg3)

        lg1 = Link(project_id=p_gamma.id, source=tg1.id, target=tg2.id, type=LinkType.FS, lag=0)
        lg2 = Link(project_id=p_gamma.id, source=tg2.id, target=tg3.id, type=LinkType.FS, lag=0)
        session.add_all([lg1, lg2])
        await session.commit()

        print("\n" + "=" * 60)
        print("✅ ESEMPI DIMOSTRATIVI CREATI CON SUCCESSO!")
        print("=" * 60)
        print(f"1. Commessa Alfa (TEST-REB-2026):")
        print(f"   ID: {p_alfa.id}")
        print(f"   Link: http://localhost:5173/projects/{p_alfa.id}")
        print(f"2. Commessa Beta (TEST-COMM-BETA):")
        print(f"   ID: {p_beta.id}")
        print(f"   Link: http://localhost:5173/projects/{p_beta.id}")
        print(f"3. Commessa Gamma (TEST-COMM-GAMMA):")
        print(f"   ID: {p_gamma.id}")
        print(f"   Link: http://localhost:5173/projects/{p_gamma.id}")
        print("=" * 60 + "\n")

if __name__ == "__main__":
    asyncio.run(seed_demo_replanning())
