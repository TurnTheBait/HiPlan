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
    current_user: User = Depends(require_role(UserRole.ADMIN, UserRole.EDITOR)),
):
    project = await project_service.create_project(db, data, current_user)
    return ProjectOut(
        id=project.id, name=project.name, code=project.code, client=project.client, color=project.color or "#185FA5",
        description=project.description,
        start_date=project.start_date, end_date=project.end_date,
        status=project.status, owner_id=project.owner_id,
        created_at=project.created_at, updated_at=project.updated_at,
    )


@router.get("/backup/json")
async def backup_json(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import select
    from app.models.project import Project
    from app.models.task import Task
    import json

    result = await db.execute(select(Project))
    projects = result.scalars().all()
    commesse = []
    for p in projects:
        task_res = await db.execute(select(Task).where(Task.project_id == p.id).order_by(Task.sort_order))
        tasks = task_res.scalars().all()
        fasi = []
        for t in tasks:
            fasi.append({
                "id": t.id,
                "fase": t.text,
                "addetti": json.loads(t.workers) if t.workers else [],
                "start": t.start_date.strftime("%Y-%m-%d") if t.start_date else "",
                "end": t.end_date.strftime("%Y-%m-%d") if t.end_date else "",
                "orePrev": t.planned_hours or 8.0,
                "oreEff": json.loads(t.actual_hours) if t.actual_hours else {}
            })
        commesse.append({
            "id": p.id,
            "cod": p.code or p.name[:15],
            "cli": p.client or "Cliente Non Specificato",
            "ds": p.start_date.strftime("%Y-%m-%d") if p.start_date else "",
            "note": p.description or "",
            "color": {"bar": p.color or "#185FA5"},
            "fasi": fasi
        })
    return {"version": 1, "savedAt": "now", "commesse": commesse}


@router.post("/restore/json")
async def restore_json(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN, UserRole.EDITOR)),
):
    from app.models.project import Project
    from app.models.task import Task
    import json
    from datetime import datetime

    commesse = payload.get("commesse", [])
    restored_projects = 0
    restored_tasks = 0
    for c in commesse:
        cod = c.get("cod", "UT-COMM")
        cli = c.get("cli", "Cliente")
        ds_str = c.get("ds")
        ds = datetime.strptime(ds_str, "%Y-%m-%d").date() if ds_str else None
        color_obj = c.get("color")
        color_str = color_obj.get("bar", "#185FA5") if isinstance(color_obj, dict) else (color_obj or "#185FA5")

        proj = Project(
            name=f"{cod} - {cli}",
            code=cod,
            client=cli,
            color=color_str,
            description=c.get("note", ""),
            start_date=ds,
            owner_id=current_user.id
        )
        db.add(proj)
        await db.flush()
        restored_projects += 1

        for idx, f in enumerate(c.get("fasi", [])):
            fs_str = f.get("start")
            fe_str = f.get("end")
            fs = datetime.strptime(fs_str, "%Y-%m-%d").date() if fs_str else (ds or datetime.today().date())
            fe = datetime.strptime(fe_str, "%Y-%m-%d").date() if fe_str else fs

            t = Task(
                project_id=proj.id,
                text=f.get("fase", "Fase Lavorazione"),
                start_date=fs,
                end_date=fe,
                duration=(fe - fs).days + 1 if fe and fs else 1,
                planned_hours=float(f.get("orePrev", 8.0)),
                workers=json.dumps(f.get("addetti", [])),
                actual_hours=json.dumps(f.get("oreEff", {})),
                sort_order=idx
            )
            db.add(t)
            restored_tasks += 1

    await db.commit()
    return {"message": "Ripristino completato con successo", "projects": restored_projects, "tasks": restored_tasks}



@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await project_service.get_project(db, project_id, current_user)
    members = await project_service.get_project_members(db, project_id)
    return ProjectDetail(
        id=project.id, name=project.name, code=project.code, client=project.client, color=project.color or "#185FA5",
        description=project.description,
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
    return project


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
