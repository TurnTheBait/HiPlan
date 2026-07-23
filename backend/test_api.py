import asyncio
import httpx

async def test():
    async with httpx.AsyncClient() as client:
        # 1. Login
        resp = await client.post("http://localhost:8000/api/auth/login", data={"username": "admin", "password": "password"})
        if resp.status_code != 200:
            print("Login failed, checking users in DB...")
            # If login fails, let's create a test user or just query without auth
            return
        token = resp.json()["access_token"]
        # 2. Get backup
        headers = {"Authorization": f"Bearer {token}"}
        resp = await client.get("http://localhost:8000/api/projects/backup/json", headers=headers)
        print(f"Status: {resp.status_code}")
        try:
            print(resp.json())
        except:
            print(resp.text)

asyncio.run(test())
