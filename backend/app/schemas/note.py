from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime
from app.schemas.user import UserOut


class NoteCreate(BaseModel):
    title: str
    content: Optional[str] = ""
    is_shared: bool = False


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    is_shared: Optional[bool] = None


class NoteOut(BaseModel):
    id: str
    title: str
    content: Optional[str] = None
    is_shared: bool
    owner_id: str
    owner: Optional[UserOut] = None
    attachments: List[dict] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
