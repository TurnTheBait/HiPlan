import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.user import User
from app.services.replanning_service import get_replanning_suggestions

@pytest.mark.asyncio
async def test_replan_project_suggestions(db_session: AsyncSession, test_user: User):
    try:
        suggestions = await get_replanning_suggestions(db_session, test_user)
        assert isinstance(suggestions, list)
    except Exception as e:
        pytest.fail(f"Replanning service failed: {str(e)}")
