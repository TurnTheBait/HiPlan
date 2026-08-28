import pytest
from app.services.project_service import create_project
from app.schemas.project import ProjectCreate, ProjectUpdate
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.project import Project

@pytest.mark.asyncio
async def test_project_service_creation(db_session: AsyncSession):
    pass

@pytest.mark.asyncio
async def test_project_service_get(db_session: AsyncSession):
    pass
