from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime
from app.models.project import ProjectStatus, MemberRole


class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: ProjectStatus = ProjectStatus.PLANNING


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[ProjectStatus] = None


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

    class Config:
        from_attributes = True


class ProjectOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: ProjectStatus
    owner_id: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    task_count: int = 0
    member_count: int = 0
    progress: float = 0.0

    class Config:
        from_attributes = True


class ProjectDetail(ProjectOut):
    members: List[MemberOut] = []
