# pyrefly: ignore [missing-import]
import pytest
# pyrefly: ignore [missing-import]
from httpx import AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_read_main(client: AsyncClient):
    response = await client.get("/docs")
    assert response.status_code == 200

@pytest.mark.asyncio
async def test_lifespan(db_session):
    from app.main import lifespan
    async with lifespan(app):
        pass
    
    # pyrefly: ignore [missing-import]
    from sqlalchemy.ext.asyncio import AsyncSession
    # pyrefly: ignore [missing-import]
    from sqlalchemy import select
    from app.models.phase_template import PhaseTemplate
    
    result = await db_session.execute(select(PhaseTemplate))
    templates = result.scalars().all()
    assert isinstance(templates, list)
