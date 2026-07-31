import asyncio, httpx, json
from app.core.security import create_access_token
from app.models.user import UserRole
import uuid

async def main():
    # Make a token for admin
    token = create_access_token({"sub": "admin", "role": "admin"})
    
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {
        "title": "Test",
        "content": "Test content",
        "notify_date": "2026-07-30",
        "due_date": "2026-07-29",
        "assignees": [],
        "notify_email": True,
        "notify_now": True
    }
    
    async with httpx.AsyncClient() as client:
        r = await client.post("http://127.0.0.1:8000/api/todos", json=payload, headers=headers)
        print(r.status_code)
        print(r.text)

asyncio.run(main())
