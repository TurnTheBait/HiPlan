# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional, List
from datetime import date, datetime


class TodoCreate(BaseModel):
    title: str
    content: Optional[str] = None
    notify_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    assignees: List[str] = []
    notify_email: bool = False
    notify_now: Optional[bool] = False


class TodoUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    notify_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    assignees: Optional[List[str]] = None
    notify_email: Optional[bool] = None
    notify_now: Optional[bool] = None
    is_completed: Optional[bool] = None


class TodoAssigneeOut(BaseModel):
    id: str
    username: str
    full_name: Optional[str] = None
    email: str


class TodoOut(BaseModel):
    id: str
    title: str
    content: Optional[str] = None
    notify_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    creator_id: str
    creator_username: Optional[str] = None
    creator_full_name: Optional[str] = None
    assignees: List[str] = []
    assignees_detail: List[TodoAssigneeOut] = []
    attachments: List[dict] = []
    notify_email: bool = False
    is_completed: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
