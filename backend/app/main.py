from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.models.base import Base, engine
import app.models  # Assicura il caricamento di tutti i modelli per create_all
from fastapi.staticfiles import StaticFiles
from app.api import auth, users, projects, tasks, notifications, export, notes, task_collaboration, workload

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Crea le tabelle all'avvio (in sviluppo; in prod usa Alembic)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        try:
            await conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN color VARCHAR(50);")
        except Exception:
            pass  # Colonna già esistente
        try:
            await conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN department VARCHAR(50);")
        except Exception:
            pass
        try:
            await conn.exec_driver_sql("ALTER TABLE tasks ADD COLUMN completed INTEGER DEFAULT 0;")
        except Exception:
            pass
        try:
            await conn.exec_driver_sql("ALTER TABLE projects ADD COLUMN responsible_id VARCHAR(36);")
        except Exception:
            pass
        try:
            await conn.exec_driver_sql("ALTER TABLE projects ADD COLUMN assigned_workers TEXT DEFAULT '[]';")
        except Exception:
            pass

    from app.models.base import AsyncSessionLocal
    from sqlalchemy import select, func
    from app.models.user import User, UserRole
    from app.core.security import hash_password, verify_password

    async with AsyncSessionLocal() as session:
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
            print("👑 [INIT] Creato utente admin predefinito (username: admin / password: admin)")
        else:
            if not verify_password("admin", admin_user.hashed_password):
                admin_user.hashed_password = hash_password("admin")
                await session.commit()
                print("🔄 [INIT] Password utente admin sincronizzata a 'admin'")

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
app.include_router(export.router)
app.include_router(notes.router)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "app": settings.APP_NAME}
