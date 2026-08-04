from contextlib import asynccontextmanager
# pyrefly: ignore [missing-import]
from fastapi import FastAPI
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.models.base import Base, engine
import app.models  # Assicura il caricamento di tutti i modelli per create_all
# pyrefly: ignore [missing-import]
from fastapi.staticfiles import StaticFiles
from app.api import (
    auth, users, projects, tasks, notes, export, 
    notifications, phase_templates, workload, vacations, 
    tickets, task_collaboration, websockets, settings as api_settings, activity_logs, todos, email_logs, search,
    rescheduling
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.services.db_migration_service import run_auto_migration
    async with engine.begin() as conn:
        # 1) Crea le tabelle nuove (non tocca quelle esistenti)
        await conn.run_sync(Base.metadata.create_all)
        # 2) Aggiunge automaticamente le colonne mancanti al DB esistente
        #    Garantisce che un DB vecchio venga aggiornato senza perdere dati
        await run_auto_migration(conn)

    from app.models.base import AsyncSessionLocal
    # pyrefly: ignore [missing-import]
    from sqlalchemy import select, func
    from app.models.user import User, UserRole
    from app.models.phase_template import PhaseTemplate
    from app.core.security import hash_password, verify_password

    async with AsyncSessionLocal() as session:
        # Check and seed PhaseTemplates
        count_res = await session.execute(select(func.count(PhaseTemplate.id)))
        if count_res.scalar_one() == 0:
            default_templates = [
                # Ufficio Tecnico
                ("Layout - Invio al cliente per approvazione", "ufficio_tecnico", "#3b82f6"),
                ("Approvazione cliente", "ufficio_tecnico", "#10b981"),
                ("Utenze elettriche", "ufficio_tecnico", "#f59e0b"),
                ("Calcolo strutturale", "ufficio_tecnico", "#84cc16"),
                ("Progettazione esecutiva - Messa in tavola - Codifica - Distinta base", "ufficio_tecnico", "#8b5cf6"),
                ("Targhette", "ufficio_tecnico", "#ec4899"),
                ("Documentazione tecnica (Manuali)", "ufficio_tecnico", "#d97706"),
                ("Certificati", "ufficio_tecnico", "#06b6d4"),
                ("Certificati - Approvazione Responsabile", "ufficio_tecnico", "#f43f5e"),
                ("Compilazione modulo check list", "ufficio_tecnico", "#e11d48"),
                ("Inserimento costi in Higest", "ufficio_tecnico", "#fb7185"),
                # Produzione
                ("Taglio lamiere laser", "produzione", "#ef4444"),
                ("Saldatura carpenteria", "produzione", "#f97316"),
                ("Verniciatura", "produzione", "#eab308"),
                ("Assemblaggio meccanico ed elettrico", "produzione", "#22c55e"),
                ("Assemblaggio finale", "produzione", "#14b8a6"),
                ("Collaudo interno", "produzione", "#06b6d4"),
                ("Imballo e preparazione spedizione", "produzione", "#3b82f6"),
                ("Spedizione al cliente", "produzione", "#6366f1"),
                # Acquisti
                ("Richiesta preventivi motoriduttori e componenti", "acquisti", "#8b5cf6"),
                ("Ordine materiale ferroso e lamiere", "acquisti", "#ec4899"),
                ("Ordine componentistica commerciale e pneumatica", "acquisti", "#f43f5e"),
                ("Attesa consegna materiali", "acquisti", "#64748b"),
                ("Controllo arrivo merce e smistamento", "acquisti", "#10b981"),
                ("Sollecito fornitori per ritardi", "acquisti", "#e11d48"),
            ]
            for name, dept, col in default_templates:
                session.add(PhaseTemplate(name=name, department=dept, default_color=col, is_custom=False))
            await session.commit()
            print("[INIT] Inserite fasi preimpostate di default per tutti i reparti")

        result = await session.execute(select(User).where(func.lower(User.username) == "admin"))
        admin_user = result.scalar_one_or_none()
        if not admin_user:
            admin_user = User(
                email="admin@hiway.it",
                username="admin",
                hashed_password=hash_password("admin"),
                full_name="Amministratore HiWay",
                role=UserRole.ADMIN,
                department="admin",
                is_active=True
            )
            session.add(admin_user)
            await session.commit()
            print("[INIT] Creato utente admin predefinito (username: admin / password: admin)")
        else:
            if not verify_password("admin", admin_user.hashed_password):
                admin_user.hashed_password = hash_password("admin")
                await session.commit()
                print("[INIT] Password utente admin sincronizzata a 'admin'")

    # pyrefly: ignore [missing-import]
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from app.services.backup_service import run_backup

    scheduler = AsyncIOScheduler(timezone="Europe/Rome")
    scheduler.add_job(run_backup, 'cron', day_of_week='sun', hour=3, minute=0)

    # Scheduler: invia notifiche TODO regolarmente controllando la data e ora esatta
    async def run_todo_notifications():
        from app.models.base import AsyncSessionLocal
        from app.models.todo import Todo
        from app.models.notification import Notification, NotificationType
        from app.models.user import User
        from app.services.email_service import send_todo_notification_email
        import json
        from datetime import datetime, timedelta
        # pyrefly: ignore [missing-import]
        from sqlalchemy import select

        now = datetime.now()
        tomorrow_now = now + timedelta(days=1)

        async with AsyncSessionLocal() as session:
            # Leggi l'email di notifica default configurata dall'admin
            from app.models.setting import Setting as AppSetting
            default_email_res = await session.execute(
                select(AppSetting).where(AppSetting.key == "todo_notification_email")
            )
            default_email_setting = default_email_res.scalar_one_or_none()
            default_notification_email = (default_email_setting.value or "").strip() if default_email_setting else ""

            # 1) Invia notifica se notify_date è passato e non ancora inviato
            todos_notify = await session.execute(
                select(Todo).where(
                    Todo.notify_date <= now,
                    Todo.is_completed == False,
                    Todo.notify_sent == False
                )
            )
            for todo in todos_notify.scalars().all():
                todo.notify_sent = True
                try:
                    assignees = json.loads(todo.assignees) if todo.assignees else []
                except Exception:
                    assignees = []

                # Notifica in-app
                for uid in assignees:
                    notif = Notification(
                        user_id=uid,
                        title=f"📋 TODO: {todo.title}",
                        message="Data di notifica raggiunta per il tuo TODO.",
                        type=NotificationType.DEADLINE,
                    )
                    session.add(notif)

                # Email: invia sempre se c'è notify_date (notify_email=True impostato dal frontend)
                if todo.notify_email:
                    users_res = await session.execute(
                        select(User).where(User.id.in_(assignees), User.is_active == True)
                    )
                    users_list = users_res.scalars().all()
                    emails = [u.email for u in users_list if u.email]
                    # Aggiungi email default admin se configurata e non già presente
                    if default_notification_email and default_notification_email not in emails:
                        emails.append(default_notification_email)
                    creator_res = await session.execute(select(User).where(User.id == todo.creator_id))
                    creator = creator_res.scalar_one_or_none()
                    if emails:
                        await send_todo_notification_email(
                            to_addresses=emails,
                            todo_title=todo.title,
                            todo_content=todo.content,
                            creator_name=creator.full_name or creator.username if creator else "HiPlan",
                            notify_type="notification",
                        )

            await session.commit()

            await session.commit()

            # 2) Invia reminder scadenza se manca <= 24 ore e non ancora inviato
            todos_due = await session.execute(
                select(Todo).where(
                    Todo.due_date <= tomorrow_now,
                    Todo.is_completed == False,
                    Todo.due_reminder_sent == False
                )
            )
            for todo in todos_due.scalars().all():
                todo.due_reminder_sent = True
                try:
                    assignees = json.loads(todo.assignees) if todo.assignees else []
                except Exception:
                    assignees = []

                # Notifica in-app
                for uid in assignees:
                    notif = Notification(
                        user_id=uid,
                        title=f"⏰ Scadenza domani: {todo.title}",
                        message="Un TODO non ancora completato è in scadenza domani.",
                        type=NotificationType.DEADLINE,
                    )
                    session.add(notif)

                # Email scadenza (invia se notify_email=True, ovvero se ha una due_date)
                if todo.notify_email:
                    users_res = await session.execute(
                        select(User).where(User.id.in_(assignees), User.is_active == True)
                    )
                    users_list = users_res.scalars().all()
                    emails = [u.email for u in users_list if u.email]
                    # Aggiungi email default admin se configurata e non già presente
                    if default_notification_email and default_notification_email not in emails:
                        emails.append(default_notification_email)
                    creator_res = await session.execute(select(User).where(User.id == todo.creator_id))
                    creator = creator_res.scalar_one_or_none()
                    if emails:
                        await send_todo_notification_email(
                            to_addresses=emails,
                            todo_title=todo.title,
                            todo_content=todo.content,
                            creator_name=creator.full_name or creator.username if creator else "HiPlan",
                            notify_type="due_reminder",
                        )

            await session.commit()

    scheduler.add_job(run_todo_notifications, 'interval', minutes=5)
    from app.services.rescheduling_service import run_daily_rescheduling
    scheduler.add_job(
        run_daily_rescheduling,
        'cron',
        hour=1,
        minute=15,
        id='daily_planning_agent',
        max_instances=1,
        coalesce=True,
    )
    from datetime import datetime as scheduler_datetime, timedelta as scheduler_timedelta
    scheduler.add_job(
        run_daily_rescheduling,
        'date',
        run_date=scheduler_datetime.now() + scheduler_timedelta(seconds=10),
        id='startup_planning_agent',
    )
    scheduler.start()
    print("[INIT] Scheduler avviato (TODO ogni 5 minuti, agente pianificazione ogni giorno alle 01:15)")

    yield
    await engine.dispose()

app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="Software di Project Management con Diagrammi di Gantt",
    lifespan=lifespan,
)

# Serviamo la cartella uploads
import os
os.makedirs("uploads", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list + [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(projects.router)
app.include_router(tasks.router)
app.include_router(task_collaboration.router)
app.include_router(workload.router)
app.include_router(notifications.router)
app.include_router(api_settings.router)
app.include_router(export.router)
app.include_router(notes.router)
app.include_router(vacations.router)
app.include_router(phase_templates.router)
app.include_router(tickets.router)
app.include_router(activity_logs.router)
app.include_router(websockets.router)
app.include_router(todos.router)
app.include_router(email_logs.router, prefix="/api/admin/email-logs", tags=["Admin"])
app.include_router(search.router)
app.include_router(rescheduling.router)

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "app": settings.APP_NAME}
