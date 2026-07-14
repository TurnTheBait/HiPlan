from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.dependencies import get_db, get_current_user, require_role
from app.models.user import User, UserRole
from app.schemas.project import ProjectCreate, ProjectUpdate, ProjectOut, ProjectDetail, MemberAdd, MemberOut
from app.services import project_service

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=List[ProjectOut])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await project_service.get_user_projects(db, current_user)


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN, UserRole.PM)),
):
    project = await project_service.create_project(db, data, current_user)
    return ProjectOut(
        id=project.id, name=project.name, description=project.description,
        start_date=project.start_date, end_date=project.end_date,
        status=project.status, owner_id=project.owner_id,
        created_at=project.created_at, updated_at=project.updated_at,
    )


@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await project_service.get_project(db, project_id, current_user)
    members = await project_service.get_project_members(db, project_id)
    return ProjectDetail(
        id=project.id, name=project.name, description=project.description,
        start_date=project.start_date, end_date=project.end_date,
        status=project.status, owner_id=project.owner_id,
        created_at=project.created_at, updated_at=project.updated_at,
        members=members,
    )


@router.put("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await project_service.update_project(db, project_id, data, current_user)
    return ProjectOut(
        id=project.id, name=project.name, description=project.description,
        start_date=project.start_date, end_date=project.end_date,
        status=project.status, owner_id=project.owner_id,
        created_at=project.created_at, updated_at=project.updated_at,
    )


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await project_service.delete_project(db, project_id, current_user)


@router.post("/{project_id}/members", response_model=MemberOut, status_code=201)
async def add_member(
    project_id: str,
    data: MemberAdd,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    member = await project_service.add_member(db, project_id, data, current_user)
    # Recupera i dati utente per la response
    from sqlalchemy import select
    from app.models.user import User as UserModel
    result = await db.execute(select(UserModel).where(UserModel.id == member.user_id))
    user = result.scalar_one()
    return MemberOut(
        id=member.id, user_id=member.user_id,
        username=user.username, email=user.email, full_name=user.full_name,
        role=member.role,
    )


@router.delete("/{project_id}/members/{member_id}", status_code=204)
async def remove_member(
    project_id: str,
    member_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await project_service.remove_member(db, project_id, member_id, current_user)
