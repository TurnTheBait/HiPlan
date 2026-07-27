import asyncio
from app.models.base import engine
from sqlalchemy import text

async def add_column():
    async with engine.begin() as conn:
        try:
            await conn.execute(text("ALTER TABLE notifications ADD COLUMN task_id VARCHAR(36)"))
            print("Colonna aggiunta con successo")
        except Exception as e:
            print("Errore (forse esiste già?):", e)

asyncio.run(add_column())
