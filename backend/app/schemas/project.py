# pyrefly: ignore [missing-import]
from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List
from datetime import date, datetime
from app.models.project import ProjectStatus, MemberRole


class ProjectCreate(BaseModel):
    name: Optional[str] = Field(default="", max_length=200)
    code: Optional[str] = None
    client: Optional[str] = None
    color: Optional[str] = "#185FA5"
    description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: ProjectStatus = ProjectStatus.PLANNING
    responsible_id: Optional[str] = None
    assigned_workers: List[str] = []


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    code: Optional[str] = None
    client: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[ProjectStatus] = None
    responsible_id: Optional[str] = None
    assigned_workers: Optional[List[str]] = None


class MemberAdd(BaseModel):
    user_id: str
    role: MemberRole = MemberRole.MEMBER


class MemberOut(BaseModel):
    id: str
    user_id: str
    username: str = ""
    email: str = ""
    full_name: Optional[str] = None
    role: MemberRole

    model_config = ConfigDict(from_attributes=True)


class ProjectOut(BaseModel):
    id: str
    name: str
    code: Optional[str] = None
    client: Optional[str] = None
    color: Optional[str] = "#185FA5"
    description: Optional[str] = None
    notes: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: ProjectStatus
    owner_id: str
    responsible_id: Optional[str] = None
    responsible_username: Optional[str] = None
    responsible_name: Optional[str] = None
    assigned_workers: List[str] = []
    attachments: List[dict] = []
    is_assigned: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    task_count: int = 0
    member_count: int = 0
    progress: float = 0.0
    deleted_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ProjectDetail(ProjectOut):
    members: List[MemberOut] = []


class ProjectTrashOut(BaseModel):
    id: str
    name: str
    code: Optional[str] = None
    client: Optional[str] = None
    color: Optional[str] = "#185FA5"
    status: ProjectStatus
    deleted_at: Optional[datetime] = None
    days_left: int = 90
    task_count: int = 0

    model_config = ConfigDict(from_attributes=True)

