import asyncio
import httpx
import json
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from app.core.security import create_access_token
from app.models.user import UserRole

async def main():
    engine = create_async_engine("sqlite+aiosqlite:///ganttflow.db")
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as db:
        res = await db.execute(text("SELECT * FROM users WHERE username='admin'"))
        user = res.fetchone()
        
    token = create_access_token(data={"sub": user.id, "role": "admin"})
    
    async with httpx.AsyncClient() as client:
        resp = await client.put(
            "http://127.0.0.1:8000/api/projects/a7279a72-df24-4f51-8660-cb406762c300",
            headers={"Authorization": f"Bearer {token}"},
            json={"notes": "fastapi test from pluto"}
        )
        print("STATUS:", resp.status_code)
        print("BODY:", resp.text)

if __name__ == "__main__":
    asyncio.run(main())
