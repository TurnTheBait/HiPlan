# pyrefly: ignore [missing-import]
import pytest
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.project_service import (
    create_project,  get_project, update_project, 
    delete_project, add_member, remove_member, get_project_members
)
from app.schemas.project import ProjectCreate, ProjectUpdate, MemberAdd
from app.models.user import User
from app.models.project import Project, MemberRole
# pyrefly: ignore [missing-import]
from fastapi import HTTPException
import datetime

@pytest.mark.asyncio
async def test_project_service_creation(db_session: AsyncSession, test_user: User):
    data = ProjectCreate(
        name="Service Project", 
        code="SRV-001",
        start_date=datetime.date.today()
    )
    project = await create_project(db_session, data, test_user)
    assert project.name == "Service Project"
    assert project.code == "SRV-001"
    assert project.owner_id == test_user.id

@pytest.mark.asyncio
async def test_project_service_get(db_session: AsyncSession, test_user: User, test_project: Project):
    # Test getting existing project
    proj = await get_project(db_session, test_project.id, test_user)
    assert proj.id == test_project.id

    # Test not found
    with pytest.raises(HTTPException) as exc:
        await get_project(db_session, "non_existent_id", test_user)
    assert exc.value.status_code == 404

@pytest.mark.asyncio
async def test_project_service_update_and_delete(db_session: AsyncSession, test_user: User, test_project: Project):
    update_data = ProjectUpdate(name="Updated Name", color="#00ff00")
    updated_proj = await update_project(db_session, test_project.id, update_data, test_user)
    
    assert updated_proj.name == "Updated Name"
    assert updated_proj.color == "#00ff00"

    # Test delete
    await delete_project(db_session, test_project.id, test_user)
    
    with pytest.raises(HTTPException):
        await get_project(db_session, test_project.id, test_user)

@pytest.mark.asyncio
async def test_project_members_management(db_session: AsyncSession, test_user: User, test_project: Project):
    # Add another user
    from app.models.user import UserRole
    from app.core.security import hash_password
    other_user = User(
        email="other@example.com",
        username="otheruser",
        hashed_password=hash_password("pass"),
        role=UserRole.EDITOR,
        is_active=True
    )
    db_session.add(other_user)
    await db_session.commit()
    await db_session.refresh(other_user)

    # Add member
    member_data = MemberAdd(user_id=other_user.id, role=MemberRole.MEMBER)
    member = await add_member(db_session, test_project.id, member_data, test_user)
    
    assert member.user_id == other_user.id
    assert member.project_id == test_project.id

    # Get members
    members = await get_project_members(db_session, test_project.id)
    assert len(members) >= 1
    assert any(m.user_id == other_user.id for m in members)

    # Remove member
    await remove_member(db_session, test_project.id, member.id, test_user)
    members_after = await get_project_members(db_session, test_project.id)
    assert not any(m.user_id == other_user.id for m in members_after)
