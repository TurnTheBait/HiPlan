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
    import json
    assigned_workers_list = []
    if project.assigned_workers:
        try:
            parsed_aw = json.loads(project.assigned_workers)
            if isinstance(parsed_aw, list):
                assigned_workers_list = parsed_aw
        except:
            pass

    return ProjectOut(
        id=project.id, name=project.name, code=project.code, client=project.client, color=project.color or "#185FA5",
        description=project.description,
        start_date=project.start_date, end_date=project.end_date,
        status=project.status, owner_id=project.owner_id,
        responsible_id=project.responsible_id,
        responsible_username=project.responsible.username if project.responsible else None,
        responsible_name=project.responsible.full_name if project.responsible else (project.responsible.username if project.responsible else None),
        assigned_workers=assigned_workers_list,
        is_assigned=(current_user.id == project.owner_id or current_user.id == project.responsible_id or current_user.username in assigned_workers_list),
        created_at=project.created_at, updated_at=project.updated_at,
    )


@router.get("/backup/json/test_debug")
async def backup_json_test(db: AsyncSession = Depends(get_db)):
    from app.models.user import User as UserModel
    from app.models.setting import Setting
    from app.models.phase_template import PhaseTemplate
    from app.models.project import Project, ProjectMember
    from app.models.task import Task
    from app.models.note import Note
    from app.models.vacation import Vacation
    from app.models.notification import Notification
    from app.models.link import Link
    from app.models.task_collaboration import TaskComment, TaskChecklistItem
    from sqlalchemy import select
    import datetime
    import uuid
    models_order = [
        UserModel, Setting, PhaseTemplate, Project, ProjectMember,
        Task, Note, Vacation, Notification, Link, TaskComment, TaskChecklistItem
    ]

    data = {}
    for model in models_order:
        res = await db.execute(select(model))
        rows = res.scalars().all()
        model_name = model.__name__
        data[model_name] = []
        for row in rows:
            row_dict = {}
            for col in model.__table__.columns:
                val = getattr(row, col.name)
                if isinstance(val, (datetime.datetime, datetime.date)):
                    val = val.isoformat()
                elif isinstance(val, uuid.UUID):
                    val = str(val)
                elif hasattr(val, "value"): # Enum handling
                    val = val.value
                row_dict[col.name] = val
            data[model_name].append(row_dict)
            
    return {
        "version": 2, 
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(), 
        "data": data
    }

@router.get("/backup/json")
async def backup_json(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.user import User as UserModel
    from app.models.setting import Setting
    from app.models.phase_template import PhaseTemplate
    from app.models.project import Project, ProjectMember
    from app.models.task import Task
    from app.models.note import Note
    from app.models.vacation import Vacation
    from app.models.notification import Notification
    from app.models.link import Link
    from app.models.task_collaboration import TaskComment, TaskChecklistItem
    from sqlalchemy import select
    import datetime
    import uuid

    if current_user.role != UserRole.ADMIN:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Solo gli amministratori possono scaricare il backup completo del sistema.")

    models_order = [
        UserModel, Setting, PhaseTemplate, Project, ProjectMember,
        Task, Note, Vacation, Notification, Link, TaskComment, TaskChecklistItem
    ]

    data = {}
    for model in models_order:
        res = await db.execute(select(model))
        rows = res.scalars().all()
        model_name = model.__name__
        data[model_name] = []
        for row in rows:
            row_dict = {}
            for col in model.__table__.columns:
                val = getattr(row, col.name)
                if isinstance(val, (datetime.datetime, datetime.date)):
                    val = val.isoformat()
                elif isinstance(val, uuid.UUID):
                    val = str(val)
                elif hasattr(val, "value"): # Enum handling
                    val = val.value
                row_dict[col.name] = val
            data[model_name].append(row_dict)
            
    return {
        "version": 2, 
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(), 
        "data": data
    }


@router.post("/restore/json")
async def restore_json(
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.ADMIN, UserRole.EDITOR)),
):
    from app.models.project import Project, ProjectMember
    from app.models.task import Task
    from app.models.user import User as UserModel
    from app.models.setting import Setting
    from app.models.phase_template import PhaseTemplate
    from app.models.note import Note
    from app.models.vacation import Vacation
    from app.models.notification import Notification
    from app.models.link import Link
    from app.models.task_collaboration import TaskComment, TaskChecklistItem
    from sqlalchemy import select, delete
    import json
    import datetime

    version = payload.get("version", 1)

    if version == 1:
        commesse = payload.get("commesse", [])
        restored_projects = 0
        restored_tasks = 0
        for c in commesse:
            cod = c.get("cod", "UT-COMM")
            cli = c.get("cli", "Cliente")
            ds_str = c.get("ds")
            ds = datetime.datetime.strptime(ds_str, "%Y-%m-%d").date() if ds_str else None
            color_obj = c.get("color")
            color_str = color_obj.get("bar", "#185FA5") if isinstance(color_obj, dict) else (color_obj or "#185FA5")

            resp_id = c.get("responsible_id") or current_user.id
            if c.get("responsible_username") and not c.get("responsible_id"):
                u_res = await db.execute(select(UserModel).where(UserModel.username == c.get("responsible_username")))
                u_obj = u_res.scalar_one_or_none()
                if u_obj:
                    resp_id = u_obj.id

            proj = Project(
                name=f"{cod} - {cli}",
                code=cod,
                client=cli,
                color=color_str,
                description=c.get("note", ""),
                start_date=ds,
                owner_id=current_user.id,
                responsible_id=resp_id,
                assigned_workers=json.dumps(c.get("addetti_commessa", []))
            )
            db.add(proj)
            await db.flush()
            restored_projects += 1

            for idx, f in enumerate(c.get("fasi", [])):
                start_str = f.get("start")
                end_str = f.get("end")
                st_date = datetime.datetime.strptime(start_str, "%Y-%m-%d").date() if start_str else None
                en_date = datetime.datetime.strptime(end_str, "%Y-%m-%d").date() if end_str else None

                t = Task(
                    project_id=proj.id,
                    text=f.get("fase", f"Fase {idx+1}"),
                    start_date=st_date,
                    end_date=en_date,
                    duration=(en_date - st_date).days + 1 if en_date and st_date else 1,
                    planned_hours=float(f.get("orePrev", 8.0)),
                    workers=json.dumps(f.get("addetti", [])),
                    actual_hours=json.dumps(f.get("oreEff", {})),
                    sort_order=idx
                )
                db.add(t)
                restored_tasks += 1

        await db.commit()
        return {"message": "Ripristino completato con successo", "projects": restored_projects, "tasks": restored_tasks}

    if version == 2:
        data = payload.get("data", {})
        models_order = [
            UserModel, Setting, PhaseTemplate, Project, ProjectMember,
            Task, Note, Vacation, Notification, Link, TaskComment, TaskChecklistItem
        ]

        # 1. Clear all existing data in reverse order
        for model in reversed(models_order):
            await db.execute(delete(model))
        await db.flush()

        # 2. Re-insert data in correct dependency order
        for model in models_order:
            model_name = model.__name__
            rows_data = data.get(model_name, [])
            for row_dict in rows_data:
                kwargs = {}
                for col in model.__table__.columns:
                    val = row_dict.get(col.name)
                    if val is not None:
                        # Convert string to date/datetime based on col type
                        col_type_name = type(col.type).__name__
                        if "Date" in col_type_name or "DateTime" in col_type_name or "TIMESTAMP" in col_type_name.upper():
                            try:
                                # Simple ISO parsing
                                dt_val = datetime.datetime.fromisoformat(val.replace("Z", "+00:00"))
                                if "DateTime" in col_type_name or "TIMESTAMP" in col_type_name.upper():
                                    val = dt_val
                                else:
                                    val = dt_val.date()
                            except Exception:
                                pass
                    kwargs[col.name] = val
                db.add(model(**kwargs))
        
        await db.commit()
        return {"status": "ok", "message": "Ripristino completo database effettuato con successo!"}


@router.get("/{project_id}", response_model=ProjectDetail)
async def get_project(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project = await project_service.get_project(db, project_id, current_user)
    members = await project_service.get_project_members(db, project_id)
    import json
    assigned_workers_list = []
    if project.assigned_workers:
        try:
            parsed_aw = json.loads(project.assigned_workers)
            if isinstance(parsed_aw, list):
                assigned_workers_list = parsed_aw
        except:
            pass

    from sqlalchemy import select
    from app.models.task import Task
    tasks_res = await db.execute(select(Task.workers).where(Task.project_id == project_id))
    unique_workers = set()
    for row in tasks_res.all():
        if row.workers:
            try:
                w_list = json.loads(row.workers)
                for w in w_list:
                    unique_workers.add(w)
            except:
                pass

    is_assigned = (
        current_user.id == project.owner_id
        or current_user.id == project.responsible_id
        or (project.responsible and project.responsible.username == current_user.username)
        or (current_user.username in assigned_workers_list)
        or (current_user.full_name and current_user.full_name in assigned_workers_list)
        or (current_user.username in unique_workers)
        or (current_user.full_name and current_user.full_name in unique_workers)
    )

    return ProjectDetail(
        id=project.id, name=project.name, code=project.code, client=project.client, color=project.color or "#185FA5",
        description=project.description,
        start_date=project.start_date, end_date=project.end_date,
        status=project.status, owner_id=project.owner_id,
        responsible_id=project.responsible_id,
        responsible_username=project.responsible.username if project.responsible else None,
        responsible_name=project.responsible.full_name if project.responsible else (project.responsible.username if project.responsible else None),
        assigned_workers=assigned_workers_list,
        is_assigned=is_assigned,
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
    import json
    assigned_workers_list = []
    if project.assigned_workers:
        try:
            parsed_aw = json.loads(project.assigned_workers)
            if isinstance(parsed_aw, list):
                assigned_workers_list = parsed_aw
        except:
            pass

    return ProjectOut(
        id=project.id, name=project.name, code=project.code, client=project.client, color=project.color or "#185FA5",
        description=project.description,
        start_date=project.start_date, end_date=project.end_date,
        status=project.status, owner_id=project.owner_id,
        responsible_id=project.responsible_id,
        responsible_username=project.responsible.username if project.responsible else None,
        responsible_name=project.responsible.full_name if project.responsible else (project.responsible.username if project.responsible else None),
        assigned_workers=assigned_workers_list,
        is_assigned=(current_user.id == project.owner_id or current_user.id == project.responsible_id or current_user.username in assigned_workers_list),
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
