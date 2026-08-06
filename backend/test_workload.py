import asyncio
from app.models.base import AsyncSessionLocal
from app.api.workload import get_workload_heatmap

async def main():
    async with AsyncSessionLocal() as db:
        res = await get_workload_heatmap(db, None)
        print([data.get("username") for uid, data in res.items()])
        minnie = [data for uid, data in res.items() if data.get("username") == "minnie"][0]
        print(minnie["workload"])

asyncio.run(main())
