import asyncio
import json
import random
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from app.models.user import User, UserRole
from app.models.worker import PhaseWorker
from app.core.security import hash_password

from app.core.config import settings
from app.models.base import engine, Base, AsyncSessionLocal
import app.models

NEW_USERS = [
    {"username": "mario.rossi", "full_name": "Mario Rossi", "email": "mario.rossi@gantt.it"},
    {"username": "luigi.verdi", "full_name": "Luigi Verdi", "email": "luigi.verdi@gantt.it"},
    {"username": "giulia.bianchi", "full_name": "Giulia Bianchi", "email": "giulia.bianchi@gantt.it"},
]

async def run_migration():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        # 1. Elimina vecchi phase workers per sicurezza
        await session.execute(text("DELETE FROM phase_workers;"))
        
        # 2. Inserisci nuovi Users e PhaseWorkers
        new_names = []
        for u in NEW_USERS:
            # check if exists
            result = await session.execute(text(f"SELECT id FROM users WHERE username = '{u['username']}'"))
            if not result.first():
                user = User(
                    username=u["username"],
                    full_name=u["full_name"],
                    email=u["email"],
                    hashed_password=hash_password("password123"),
                    role=UserRole.EDITOR,
                    is_active=True
                )
                session.add(user)
            
            # create PhaseWorker
            worker = PhaseWorker(name=u["full_name"])
            session.add(worker)
            new_names.append(u["full_name"])
            
        await session.commit()
        print(f"Users and workers created: {new_names}")
        
        # 3. Aggiorna JSON nei task esistenti
        result = await session.execute(text("SELECT id, workers FROM tasks"))
        tasks = result.all()
        
        updated_count = 0
        for task in tasks:
            task_id = task[0]
            workers_json = task[1]
            if not workers_json:
                continue
                
            try:
                workers_list = json.loads(workers_json)
                if not isinstance(workers_list, list):
                    continue
                
                # Se c'è almeno un elemento, sostituisci con nomi a caso dal nuovo array
                if len(workers_list) > 0:
                    # Rimuoviamo i fittizi se ci sono, ma praticamente rimpiazziamo tutto per sicurezza
                    new_workers_for_task = random.sample(new_names, min(len(workers_list), len(new_names)))
                    new_json = json.dumps(new_workers_for_task)
                    
                    await session.execute(
                        text("UPDATE tasks SET workers = :w WHERE id = :tid"),
                        {"w": new_json, "tid": task_id}
                    )
                    updated_count += 1
            except Exception as e:
                print(f"Errore parse json task {task_id}: {e}")
                
        await session.commit()
        print(f"Updated {updated_count} tasks.")

if __name__ == "__main__":
    asyncio.run(run_migration())
