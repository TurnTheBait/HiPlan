import pytest
from app.services.export_service import export_excel
from app.models.project import Project
from app.models.task import Task
import datetime
from sqlalchemy.ext.asyncio import AsyncSession

@pytest.mark.asyncio
async def test_export_excel_basic(db_session: AsyncSession, test_project: Project):
    try:
        # Call the export function. 
        result = await export_excel(db_session, test_project.id)
        assert hasattr(result, "getvalue")
        assert len(result.getvalue()) > 0
    except Exception as e:
        pytest.fail(f"Export service failed: {str(e)}")
