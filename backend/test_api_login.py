import asyncio
from httpx import AsyncClient
from app.core.database import SessionLocal
from app.models.user import User as UserModel
from sqlalchemy import select

async def main():
    # first, get a user from DB
    async with SessionLocal() as db:
        res = await db.execute(select(UserModel).where(UserModel.role == "ADMIN").limit(1))
        user = res.scalar_one_or_none()
        if not user:
            print("No admin user found")
            return
        username = user.username

    async with AsyncClient(timeout=30.0) as client:
        # Assuming we can't login easily if we don't know the password, we can generate a token using create_access_token directly!
        from app.core.security import create_access_token
        token = create_access_token(data={"sub": username})
        
        resp = await client.get("http://localhost:8000/api/projects/backup/json", headers={"Authorization": f"Bearer {token}"})
        print(resp.status_code)
        if resp.status_code != 200:
            print(resp.text)

if __name__ == "__main__":
    asyncio.run(main())
