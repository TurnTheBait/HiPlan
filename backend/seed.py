import asyncio
import random
from datetime import date, timedelta
from typing import Any, Dict, List, cast
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models.base import AsyncSessionLocal
from app.models.user import UserRole
from app.models.project import Project, ProjectStatus
from app.models.task import Task, TaskType, TaskPriority

# Dati di esempio
WORKERS: Dict[str, List[str]] = {
    "ufficio_tecnico": ["Marco (UT)", "Anna (UT)", "Luigi (UT)"],
    "produzione": ["Giovanni (Prod)", "Roberto (Prod)", "Franco (Prod)"],
    "acquisti": ["Laura (Acq)", "Elena (Acq)"]
}

PROJECTS: List[Dict[str, Any]] = [
    {
        "name": "Impianto Molino 50t/h",
        "code": "COMM-2026-001",
        "client": "Molino Rossi SpA",
        "description": "Nuovo impianto di macinazione completo",
        "color": "#185FA5",
    },
    {
        "name": "Silos Stoccaggio Grano",
        "code": "COMM-2026-002",
        "client": "AgriNord",
        "description": "N. 4 Silos da 5000t con sistema di estrazione",
        "color": "#10b981",
    }
]

PHASES_TEMPLATES: List[Dict[str, Any]] = [
    {
        "dept": "ufficio_tecnico",
        "tasks": [
            {"text": "Layout - Invio al cliente", "duration": 3, "color": "#3b82f6"},
            {"text": "Approvazione cliente", "duration": 2, "color": "#10b981"},
            {"text": "Progettazione esecutiva", "duration": 10, "color": "#8b5cf6"},
        ]
    },
    {
        "dept": "acquisti",
        "tasks": [
            {"text": "Richiesta preventivi motoriduttori", "duration": 2, "color": "#f59e0b"},
            {"text": "Ordine materiale ferroso", "duration": 1, "color": "#f59e0b"},
            {"text": "Attesa consegna materiali", "duration": 15, "color": "#d97706"},
        ]
    },
    {
        "dept": "produzione",
        "tasks": [
            {"text": "Taglio lamiere laser", "duration": 3, "color": "#ef4444"},
            {"text": "Saldatura carpenteria", "duration": 5, "color": "#ef4444"},
            {"text": "Verniciatura", "duration": 2, "color": "#ec4899"},
            {"text": "Assemblaggio finale", "duration": 4, "color": "#f43f5e"},
        ]
    }
]


async def seed():
    # 1. Assicurati che tutte le tabelle siano create prima di interrogare il DB
    from app.models.base import engine, Base
    import app.models  # Assicura il caricamento di tutti i modelli per create_all
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        # Get an admin user for owner_id
        from app.models.user import User, UserRole
        from app.core.security import hash_password
        result = await db.execute(select(User).where(User.role == UserRole.ADMIN))
        admin_user = result.scalars().first()
        if not admin_user:
            print("👑 Nessun utente admin trovato, creazione admin predefinito in seed.py...")
            admin_user = User(
                email="admin@hiway.it",
                username="admin",
                hashed_password=hash_password("admin"),
                full_name="Amministratore HiWay",
                role=UserRole.ADMIN,
                department="admin",
                is_active=True
            )
            db.add(admin_user)
            await db.commit()
            await db.refresh(admin_user)

        print("Creazione utenti fittizi (se non esistono)...")
        workers_ids: Dict[str, List[str]] = {"ufficio_tecnico": [], "produzione": [], "acquisti": []}
        
        from app.core.security import hash_password
        
        for dept, names in WORKERS.items():
            for name in names:
                username = name.split(" ")[0].lower() + "_" + dept[:3]
                result = await db.execute(select(User).where(User.username == username))
                user = result.scalar_one_or_none()
                if not user:
                    user = User(
                        email=f"{username}@example.com",
                        username=username,
                        hashed_password=hash_password("password123"),
                        full_name=name,
                        role=UserRole.VIEWER,
                        department=dept
                    )
                    db.add(user)
                    await db.commit()
                    await db.refresh(user)
                workers_ids[dept].append(user.username)

        print("Creazione commesse di esempio...")
        today = date.today()
        
        for p_data in PROJECTS:
            # check if exists
            result = await db.execute(select(Project).where(Project.code == p_data["code"]))
            existing_p = result.scalar_one_or_none()
            if existing_p:
                print(f"Commessa {p_data['code']} già esistente, salto.")
                continue
                
            project = Project(
                name=p_data["name"],
                code=p_data["code"],
                client=p_data["client"],
                description=p_data["description"],
                color=p_data["color"],
                status=ProjectStatus.PLANNING,
                start_date=today,
                end_date=today + timedelta(days=60),
                owner_id=admin_user.id
            )
            db.add(project)
            await db.commit()
            await db.refresh(project)
            
            # Crea le fasi sfalsate
            current_date = today
            import json
            
            for dept_group in PHASES_TEMPLATES:
                dept: str = str(dept_group["dept"])
                tasks_list: List[Dict[str, Any]] = cast(List[Dict[str, Any]], dept_group["tasks"])
                for t_data in tasks_list:
                    duration: int = int(t_data["duration"])
                    
                    # Assegna 1 addetto random di quel reparto
                    worker_assigned: str = random.choice(workers_ids[dept])
                    
                    task = Task(
                        project_id=project.id,
                        text=str(t_data["text"]),
                        start_date=current_date,
                        end_date=current_date + timedelta(days=float(duration)),
                        duration=duration,
                        progress=round(random.uniform(0, 0.5), 2), # un po' di progresso
                        type=TaskType.TASK,
                        priority=TaskPriority.MEDIUM,
                        planned_hours=float(duration * 8.0),
                        department=dept,
                        color=str(t_data["color"]),
                        workers=json.dumps([worker_assigned]),
                        worker_hours=json.dumps({worker_assigned: float(duration * 8.0)}),
                        actual_hours=json.dumps({})
                    )
                    db.add(task)
                    current_date += timedelta(days=float(duration)) # sposta la data inizio della prossima fase
                    
            await db.commit()
            print(f"Commessa {p_data['code']} popolata con le fasi.")
            
        print("Seed completato con successo!")

if __name__ == "__main__":
    asyncio.run(seed())
