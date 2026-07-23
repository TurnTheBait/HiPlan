import asyncio
from httpx import AsyncClient
from app.core.security import create_access_token
from app.core.database import SessionLocal
from app.models.user import User as UserModel
from sqlalchemy import select

async def main():
    async with SessionLocal() as db:
        res = await db.execute(select(UserModel).limit(1))
        user = res.scalar_one_or_none()
        if not user:
            print("No user")
            return
        token = create_access_token(data={"sub": user.username})
        
    async with AsyncClient() as client:
        resp = await client.get("http://localhost:8000/api/projects/backup/json", headers={"Authorization": f"Bearer {token}"})
        print(resp.status_code)
        if resp.status_code != 200:
            print(resp.text)

if __name__ == "__main__":
    asyncio.run(main())
