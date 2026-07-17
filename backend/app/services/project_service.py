from typing import List, Optional
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select, func
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import selectinload
from app.models.project import Project, ProjectMember, MemberRole
from app.models.task import Task
from app.models.user import User, UserRole
from app.schemas.project import ProjectCreate, ProjectUpdate, MemberAdd, ProjectOut, MemberOut
from app.models.notification import Notification, NotificationType
# pyrefly: ignore [missing-import]
from fastapi import HTTPException, status


async def get_user_projects(db: AsyncSession, user: User) -> List[ProjectOut]:
    result = await db.execute(select(Project).order_by(Project.created_at.desc()))
    projects = result.scalars().all()

    output = []
    for p in projects:
        tasks_data = await db.execute(
            select(Task.id, Task.progress, Task.workers)
            .where(Task.project_id == p.id)
        )
        tasks_rows = tasks_data.all()
        
        task_count = len(tasks_rows)
        avg_progress = sum((row.progress or 0) for row in tasks_rows) / task_count if task_count > 0 else 0.0
        
        unique_workers = set()
        import json
        for row in tasks_rows:
            if row.workers:
                try:
                    w_list = json.loads(row.workers)
                    for w in w_list:
                        unique_workers.add(w)
                except:
                    pass
        
        worker_count = len(unique_workers)

        out = ProjectOut(
            id=p.id, name=p.name, code=p.code, client=p.client, color=p.color or "#185FA5",
            description=p.description,
            start_date=p.start_date, end_date=p.end_date,
            status=p.status, owner_id=p.owner_id,
            created_at=p.created_at, updated_at=p.updated_at,
            task_count=task_count, member_count=worker_count,
            progress=round(avg_progress, 2),
        )
        output.append(out)
    return output


async def create_project(db: AsyncSession, data: ProjectCreate, owner: User) -> Project:
    project = Project(
        name=data.name, code=data.code, client=data.client, color=data.color or "#185FA5",
        description=data.description,
        start_date=data.start_date, end_date=data.end_date,
        status=data.status, owner_id=owner.id,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


async def get_project(db: AsyncSession, project_id: str, user: User) -> Project:
    result = await db.execute(
        select(Project).options(selectinload(Project.members)).where(Project.id == project_id).execution_options(populate_existing=True)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Progetto non trovato")

    return project


async def update_project(db: AsyncSession, project_id: str, data: ProjectUpdate, user: User) -> Project:
    project = await get_project(db, project_id, user)
    if user.role != UserRole.ADMIN and project.owner_id != user.id:
        member = next((m for m in project.members if m.user_id == user.id), None)
        if not member or member.role != MemberRole.MANAGER:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo owner/manager possono modificare")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(project, key, value)
    await db.commit()
    return await get_project(db, project_id, user)


async def delete_project(db: AsyncSession, project_id: str, user: User):
    project = await get_project(db, project_id, user)
    if user.role != UserRole.ADMIN and project.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo owner/admin possono eliminare")
    await db.delete(project)
    await db.commit()


async def add_member(db: AsyncSession, project_id: str, data: MemberAdd, user: User) -> ProjectMember:
    project = await get_project(db, project_id, user)

    # Verifica permessi
    if user.role != UserRole.ADMIN and project.owner_id != user.id:
        member = next((m for m in project.members if m.user_id == user.id), None)
        if not member or member.role != MemberRole.MANAGER:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo owner/manager possono aggiungere membri")

    # Verifica che l'utente esista
    target = await db.execute(select(User).where(User.id == data.user_id))
    if not target.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Utente non trovato")

    # Verifica duplicato
    existing = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == data.user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Utente già membro del progetto")

    member = ProjectMember(project_id=project_id, user_id=data.user_id, role=data.role)
    db.add(member)

    # Notifica
    notification = Notification(
        user_id=data.user_id,
        title=f"Aggiunto al progetto: {project.name}",
        message=f"Sei stato aggiunto come {data.role.value} al progetto '{project.name}'",
        type=NotificationType.ASSIGNMENT,
        project_id=project_id,
    )
    db.add(notification)

    await db.commit()
    await db.refresh(member)
    return member


async def remove_member(db: AsyncSession, project_id: str, member_id: str, user: User):
    project = await get_project(db, project_id, user)
    if user.role != UserRole.ADMIN and project.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo owner/admin possono rimuovere membri")

    result = await db.execute(
        select(ProjectMember).where(ProjectMember.id == member_id, ProjectMember.project_id == project_id)
    )
    member = result.scalar_one_or_none()
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membro non trovato")

    await db.delete(member)
    await db.commit()


async def get_project_members(db: AsyncSession, project_id: str) -> List[MemberOut]:
    result = await db.execute(
        select(ProjectMember, User)
        .join(User, User.id == ProjectMember.user_id)
        .where(ProjectMember.project_id == project_id)
    )
    members = []
    for pm, u in result.all():
        members.append(MemberOut(
            id=pm.id, user_id=pm.user_id,
            username=u.username, email=u.email, full_name=u.full_name,
            role=pm.role,
        ))
    return members
