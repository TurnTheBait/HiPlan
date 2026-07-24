from typing import List, Optional, Any, Dict
# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from datetime import datetime


class TicketReplyCreate(BaseModel):
    content: str
    action_type: Optional[str] = None


class TicketReplyOut(BaseModel):
    id: str
    ticket_id: str
    author_id: str
    author_username: Optional[str] = None
    author_full_name: Optional[str] = None
    content: str
    action_type: Optional[str] = None
    attachments: List[Dict[str, Any]] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class TicketCreate(BaseModel):
    title: str
    description: Optional[str] = None
    project_id: Optional[str] = None
    custom_project_code: Optional[str] = None
    assigned_to: List[str] = []  # list of usernames
    priority: Optional[str] = "medium"


class TicketUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    project_id: Optional[str] = None
    custom_project_code: Optional[str] = None
    assigned_to: Optional[List[str]] = None
    priority: Optional[str] = None
    status: Optional[str] = None


class TicketOut(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    project_code: Optional[str] = None
    custom_project_code: Optional[str] = None
    author_id: str
    author_username: Optional[str] = None
    author_full_name: Optional[str] = None
    assigned_to: List[str] = []
    attachments: List[Dict[str, Any]] = []
    status: str
    priority: str
    replies: List[TicketReplyOut] = []
    reply_count: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
