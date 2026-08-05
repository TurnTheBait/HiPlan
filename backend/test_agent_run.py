import asyncio
from app.models.base import AsyncSessionLocal
from app.services.rescheduling_agent import run_rescheduling_agent, get_agent_status

async def main():
    async with AsyncSessionLocal() as session:
        print("Before:", await get_agent_status(session))
    
    await run_rescheduling_agent(dry_run=False)
    
    async with AsyncSessionLocal() as session:
        print("After:", await get_agent_status(session))

if __name__ == "__main__":
    asyncio.run(main())
