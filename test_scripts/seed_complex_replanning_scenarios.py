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
from app.models.vacation import Vacation


async def seed_complex_replanning_scenarios():
    async with AsyncSessionLocal() as session:
        # Recupera utente admin
        res = await session.execute(select(User).where(User.username.in_(["admin", "davide"])).limit(1))
        user = res.scalars().first()
        if not user:
            res_any = await session.execute(select(User).limit(1))
            user = res_any.scalars().first()
        if not user:
            print("Errore: nessun utente trovato nel database.")
            return

        # Mappa utenti per ID
        u_res = await session.execute(select(User))
        users_by_name = {u.full_name: u for u in u_res.scalars().all() if u.full_name}

        target_codes = ["TEST-ROBOT-2026", "TEST-PHARMA-2026", "TEST-RIGID-2026", "TEST-REB-2026", "TEST-COMM-BETA", "TEST-COMM-GAMMA"]

        # Elimina vecchie commesse di test
        for code in target_codes:
            old_res = await session.execute(select(Project).where(Project.code == code))
            old_p = old_res.scalars().first()
            if old_p:
                logs_res = await session.execute(select(ReplanLog).where(ReplanLog.project_id == old_p.id))
                for l in logs_res.scalars().all():
                    await session.delete(l)
                await session.delete(old_p)
        await session.commit()

        # Configura ferie mirate per i test
        # Franco: ferie dal 16/09 al 18/09 (3 gg)
        # Roberto: ferie dal 28/09 al 02/10 (5 gg)
        franco_u = users_by_name.get("Franco (Prod)")
        roberto_u = users_by_name.get("Roberto (Prod)")

        if franco_u:
            # Rimuove vecchie ferie settimanali di settembre
            v_res = await session.execute(
                select(Vacation).where(Vacation.user_id == franco_u.id, Vacation.start_date >= date(2026, 9, 1), Vacation.end_date <= date(2026, 9, 30))
            )
            for v in v_res.scalars().all():
                await session.delete(v)
            session.add(Vacation(
                user_id=franco_u.id,
                start_date=date(2026, 9, 16),
                end_date=date(2026, 9, 18),
                reason="Ferie Settembre Franco"
            ))

        if roberto_u:
            v_res2 = await session.execute(
                select(Vacation).where(Vacation.user_id == roberto_u.id, Vacation.start_date >= date(2026, 9, 1), Vacation.end_date <= date(2026, 10, 31))
            )
            for v in v_res2.scalars().all():
                await session.delete(v)
            session.add(Vacation(
                user_id=roberto_u.id,
                start_date=date(2026, 9, 28),
                end_date=date(2026, 10, 2),
                reason="Ferie Autunno Roberto"
            ))

        await session.commit()

        # =====================================================================
        # COMMESSA 1: TEST-ROBOT-2026
        # "Impianto Robotizzato di Saldatura Automotive"
        # Scadenza: 27/11/2026 (ampio margine di commessa)
        # Scenari testati:
        # - Fase 1 scaduta (ritardo dal passato, riprogrammazione olistica da oggi)
        # - Fase 2 a cascata FS (Laura Acq)
        # - Fase 3 (Franco Prod): conflitto ferie (16-18 Settembre) con recupero al rientro vs riassegnazione a Giovanni
        # - Fase 4: Multi-addetto (Roberto + Giovanni) con convergenza FS da Fase 2 e 3
        # - Fase 5: Sovraccarico multi-commessa su Marco (UT) (16h/gg sovrapposto con commessa Pharma)
        # - Fase 6: Collaudo finale (Roberto Prod)
        # =====================================================================
        p1 = Project(
            code="TEST-ROBOT-2026",
            name="Impianto Robotizzato di Saldatura Automotive",
            client="Stellantis Industrial Automation",
            description="Commessa ad alta complessità per collaudare ritardi, ferie, multi-addetto e propagazione a catena.",
            notes="Include dipendenze multiple convergenti, biforcazioni e carichi condivisi.",
            start_date=date(2026, 8, 25),
            end_date=date(2026, 11, 27),
            status=ProjectStatus.ACTIVE,
            owner_id=user.id,
            responsible_id=user.id,
            assigned_workers=json.dumps(["Marco (UT)", "Laura (Acq)", "Franco (Prod)", "Roberto (Prod)", "Giovanni (Prod)"])
        )
        session.add(p1)
        await session.commit()
        await session.refresh(p1)

        # Fase 1: Scaduta il 02/09/2026, 48h previste, 8h consuntivate (mancano 40h)
        t1_1 = Task(
            project_id=p1.id,
            text="Fase 1: Ingegneria di Base e Layout 3D Robot",
            start_date=date(2026, 8, 25),
            end_date=date(2026, 9, 2),
            duration=6,
            progress=0.15,
            type=TaskType.TASK,
            priority=TaskPriority.HIGH,
            sort_order=1,
            planned_hours=48.0,
            actual_hours=json.dumps({"Marco (UT)": {"2026-08-26": 4.0, "2026-08-27": 4.0}}),
            workers=json.dumps(["Marco (UT)"]),
            worker_hours=json.dumps({"Marco (UT)": 48.0}),
            department="ufficio_tecnico",
            completed=0
        )
        # Fase 2: Fornitura componenti, dipendente da Fase 1
        t1_2 = Task(
            project_id=p1.id,
            text="Fase 2: Approvazione Robot e Componenti Commerciali",
            start_date=date(2026, 9, 3),
            end_date=date(2026, 9, 8),
            duration=4,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.MEDIUM,
            sort_order=2,
            planned_hours=32.0,
            workers=json.dumps(["Laura (Acq)"]),
            worker_hours=json.dumps({"Laura (Acq)": 32.0}),
            department="acquisti",
            completed=0
        )
        # Fase 3: Costruzione basamento pesante, in conflitto con ferie di Franco (16-18 Settembre)
        t1_3 = Task(
            project_id=p1.id,
            text="Fase 3: Costruzione Basamento e Carpenteria Pesante",
            start_date=date(2026, 9, 14),
            end_date=date(2026, 9, 18),
            duration=5,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.HIGH,
            sort_order=3,
            planned_hours=40.0,
            workers=json.dumps(["Franco (Prod)"]),
            worker_hours=json.dumps({"Franco (Prod)": 40.0}),
            department="produzione",
            completed=0
        )
        # Fase 4: Integrazione meccanica MULTI-ADDETTO (Roberto + Giovanni, 80h tot = 40h cad)
        # Dipende sia da Fase 2 che da Fase 3
        t1_4 = Task(
            project_id=p1.id,
            text="Fase 4: Integrazione Meccanica e Montaggio Robot (Multi-Addetto)",
            start_date=date(2026, 9, 21),
            end_date=date(2026, 9, 25),
            duration=5,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.CRITICAL,
            sort_order=4,
            planned_hours=80.0,
            workers=json.dumps(["Roberto (Prod)", "Giovanni (Prod)"]),
            worker_hours=json.dumps({"Roberto (Prod)": 40.0, "Giovanni (Prod)": 40.0}),
            department="produzione",
            completed=0
        )
        # Fase 5: Cablaggio e Software PLC (Marco UT) - Dipende da Fase 4
        # In sovrapposizione con Fase P1 della commessa Pharma (16h/gg!)
        t1_5 = Task(
            project_id=p1.id,
            text="Fase 5: Cablaggio Bordo Macchina e Software PLC",
            start_date=date(2026, 9, 28),
            end_date=date(2026, 10, 5),
            duration=6,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.HIGH,
            sort_order=5,
            planned_hours=48.0,
            workers=json.dumps(["Marco (UT)"]),
            worker_hours=json.dumps({"Marco (UT)": 48.0}),
            department="ufficio_tecnico",
            completed=0
        )
        # Fase 6: Collaudo Funzionale finale (Roberto Prod) - Dipende da Fase 5
        t1_6 = Task(
            project_id=p1.id,
            text="Fase 6: Collaudo Funzionale e Certificazione CE",
            start_date=date(2026, 10, 6),
            end_date=date(2026, 10, 9),
            duration=4,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.HIGH,
            sort_order=6,
            planned_hours=32.0,
            workers=json.dumps(["Roberto (Prod)"]),
            worker_hours=json.dumps({"Roberto (Prod)": 32.0}),
            department="produzione",
            completed=0
        )

        session.add_all([t1_1, t1_2, t1_3, t1_4, t1_5, t1_6])
        await session.commit()
        for t in [t1_1, t1_2, t1_3, t1_4, t1_5, t1_6]:
            await session.refresh(t)

        # Links Finish-to-Start
        l1 = Link(project_id=p1.id, source=t1_1.id, target=t1_2.id, type=LinkType.FS, lag=0)
        l2 = Link(project_id=p1.id, source=t1_2.id, target=t1_4.id, type=LinkType.FS, lag=0)
        l3 = Link(project_id=p1.id, source=t1_3.id, target=t1_4.id, type=LinkType.FS, lag=0)
        l4 = Link(project_id=p1.id, source=t1_4.id, target=t1_5.id, type=LinkType.FS, lag=0)
        l5 = Link(project_id=p1.id, source=t1_5.id, target=t1_6.id, type=LinkType.FS, lag=0)
        session.add_all([l1, l2, l3, l4, l5])
        await session.commit()

        # =====================================================================
        # COMMESSA 2: TEST-PHARMA-2026
        # "Linea Confezionamento Sterile Cleanroom"
        # Scadenza: 20/11/2026
        # Genera sovraccarichi contemporanei su Marco (UT) (16h/gg) e Giovanni (Prod)
        # =====================================================================
        p2 = Project(
            code="TEST-PHARMA-2026",
            name="Linea Confezionamento Sterile Cleanroom",
            client="Chiesi Farmaceutici S.p.A.",
            description="Commessa concomitante per testare sovraccarichi incrociati e carichi ripartiti su Ufficio Tecnico e Produzione.",
            notes="Condivide Marco (UT) e Giovanni (Prod) nelle settimane centrali.",
            start_date=date(2026, 9, 1),
            end_date=date(2026, 11, 20),
            status=ProjectStatus.ACTIVE,
            owner_id=user.id,
            responsible_id=user.id,
            is_alimentare=True,
            assigned_workers=json.dumps(["Marco (UT)", "Laura (Acq)", "Giovanni (Prod)", "Anna (UT)"])
        )
        session.add(p2)
        await session.commit()
        await session.refresh(p2)

        # Fase P1: Progettazione Flussi Laminari (Marco UT) - dal 28/09 al 05/10 (identico a Fase 5 Commessa 1!)
        # Carico: 48h in 6 giorni = 8h/gg. Con l'altro task di 8h/gg, Marco arriva a 16.0h/gg!
        tp_1 = Task(
            project_id=p2.id,
            text="Fase P1: Progettazione Flussi Laminari e Trattamento Aria",
            start_date=date(2026, 9, 28),
            end_date=date(2026, 10, 5),
            duration=6,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.HIGH,
            sort_order=1,
            planned_hours=48.0,
            workers=json.dumps(["Marco (UT)"]),
            worker_hours=json.dumps({"Marco (UT)": 48.0}),
            department="ufficio_tecnico",
            completed=0
        )
        # Fase P2: Acquisto Nastri Intralox (Laura Acq)
        tp_2 = Task(
            project_id=p2.id,
            text="Fase P2: Fornitura Nastri Intralox e Componentistica Acciaio Inox",
            start_date=date(2026, 10, 6),
            end_date=date(2026, 10, 9),
            duration=4,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.MEDIUM,
            sort_order=2,
            planned_hours=24.0,
            workers=json.dumps(["Laura (Acq)"]),
            worker_hours=json.dumps({"Laura (Acq)": 24.0}),
            department="acquisti",
            completed=0
        )
        # Fase P3: Montaggio Nastri Fiale (Giovanni Prod)
        tp_3 = Task(
            project_id=p2.id,
            text="Fase P3: Assemblaggio Meccanico Nastri e Dosatori Flaconi",
            start_date=date(2026, 10, 12),
            end_date=date(2026, 10, 20),
            duration=7,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.HIGH,
            sort_order=3,
            planned_hours=56.0,
            workers=json.dumps(["Giovanni (Prod)"]),
            worker_hours=json.dumps({"Giovanni (Prod)": 56.0}),
            department="produzione",
            completed=0
        )
        session.add_all([tp_1, tp_2, tp_3])
        await session.commit()
        for t in [tp_1, tp_2, tp_3]:
            await session.refresh(t)

        lp1 = Link(project_id=p2.id, source=tp_1.id, target=tp_2.id, type=LinkType.FS, lag=0)
        lp2 = Link(project_id=p2.id, source=tp_2.id, target=tp_3.id, type=LinkType.FS, lag=0)
        session.add_all([lp1, lp2])
        await session.commit()

        # =====================================================================
        # COMMESSA 3: TEST-RIGID-2026
        # "Revamping Skid Idrogeno - Scadenza Tassativa Rigida"
        # Scadenza contrattuale: 21/09/2026 (brevissimo termine!)
        # Scenari testati:
        # - Fase R1 scaduta (56h mancanti). 7 giorni lavorativi da oggi (08/09) terminano il 16/09.
        # - Fase R2 a cascata FS (Luigi UT, 48h = 6 giorni) deve iniziare il 17/09 e finire il 24/09.
        # - 24/09 supera la scadenza del 21/09!
        # - DIMOSTRAZIONE DI RISCHIO SCADENZA: l'ottimizzatore NON sposta la commessa fuori limite,
        #   ma emette l'avviso critico "Intervento Manuale Necessario: Rischio Scadenza"!
        # =====================================================================
        p3 = Project(
            code="TEST-RIGID-2026",
            name="Revamping Skid Idrogeno - Scadenza Rigida",
            client="Snam Rete Gas S.p.A.",
            description="Commessa critica con scadenza contrattuale rigida e penali elevate. Dimostra la protezione della deadline finale.",
            notes="Scadenza al 21/09/2026. Qualsiasi ritardo sfora e richiede intervento manuale del Project Manager.",
            start_date=date(2026, 8, 20),
            end_date=date(2026, 9, 21),
            status=ProjectStatus.ACTIVE,
            owner_id=user.id,
            responsible_id=user.id,
            is_atex=True,
            assigned_workers=json.dumps(["Franco (Prod)", "Luigi (UT)"])
        )
        session.add(p3)
        await session.commit()
        await session.refresh(p3)

        tr_1 = Task(
            project_id=p3.id,
            text="Fase R1: Saldature Tubazioni e Radiografie CND",
            start_date=date(2026, 8, 28),
            end_date=date(2026, 9, 4),
            duration=6,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.CRITICAL,
            sort_order=1,
            planned_hours=56.0,
            workers=json.dumps(["Franco (Prod)"]),
            worker_hours=json.dumps({"Franco (Prod)": 56.0}),
            department="produzione",
            completed=0
        )
        tr_2 = Task(
            project_id=p3.id,
            text="Fase R2: Collaudo ATEX Ente Notificato e Marcatura CE",
            start_date=date(2026, 9, 7),
            end_date=date(2026, 9, 14),
            duration=6,
            progress=0.0,
            type=TaskType.TASK,
            priority=TaskPriority.CRITICAL,
            sort_order=2,
            planned_hours=48.0,
            workers=json.dumps(["Luigi (UT)"]),
            worker_hours=json.dumps({"Luigi (UT)": 48.0}),
            department="ufficio_tecnico",
            completed=0
        )
        session.add_all([tr_1, tr_2])
        await session.commit()
        await session.refresh(tr_1)
        await session.refresh(tr_2)

        lr1 = Link(project_id=p3.id, source=tr_1.id, target=tr_2.id, type=LinkType.FS, lag=0)
        session.add(lr1)
        await session.commit()

        print("\n" + "=" * 70)
        print("🚀 SCENARI COMPLESSI DI REPLANNING CREATI CON SUCCESSO!")
        print("=" * 70)
        print(f"1. COMMESSA 1 (TEST-ROBOT-2026) - Automotive (Scadenza 27/11/2026):")
        print(f"   ID: {p1.id}")
        print(f"   URL: http://localhost:5173/projects/{p1.id}")
        print(f"   Scenari: Fase scaduta (Macro) -> Cascata FS (Laura) -> Ferie (Franco) ->")
        print(f"            Multi-Addetto con doppia FS (Roberto+Giovanni) -> Sovraccarico 16h (Marco)")
        print(f"2. COMMESSA 2 (TEST-PHARMA-2026) - Cleanroom (Scadenza 20/11/2026):")
        print(f"   ID: {p2.id}")
        print(f"   URL: http://localhost:5173/projects/{p2.id}")
        print(f"   Scenari: Sovraccarico cross-commessa 16h/gg su Marco (UT) e carichi su Giovanni")
        print(f"3. COMMESSA 3 (TEST-RIGID-2026) - Skid Idrogeno (Scadenza Rigida 21/09/2026):")
        print(f"   ID: {p3.id}")
        print(f"   URL: http://localhost:5173/projects/{p3.id}")
        print(f"   Scenari: Allarme Critico 'Rischio Scadenza / Intervento Manuale Necessario'")
        print("=" * 70 + "\n")


if __name__ == "__main__":
    asyncio.run(seed_complex_replanning_scenarios())
