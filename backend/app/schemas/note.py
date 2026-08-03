# pyrefly: ignore [missing-import]
from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime
from app.schemas.user import UserOut


class NoteCreate(BaseModel):
    title: str
    content: Optional[str] = ""
    is_shared: bool = False
    visibility: Optional[str] = "private"
    shared_with: Optional[List[str]] = []


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    is_shared: Optional[bool] = None
    visibility: Optional[str] = None
    shared_with: Optional[List[str]] = None


class NoteOut(BaseModel):
    id: str
    title: str
    content: Optional[str] = None
    is_shared: bool
    visibility: str
    shared_with: List[str]
    owner_id: str
    owner: Optional[UserOut] = None
    attachments: List[dict] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
