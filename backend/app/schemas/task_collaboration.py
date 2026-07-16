from pydantic import BaseModel, ConfigDict
from typing import Optional, List
from datetime import datetime

class TaskCommentCreate(BaseModel):
    content: str
    
class TaskCommentOut(BaseModel):
    id: str
    task_id: str
    author_id: Optional[str] = None
    content: str
    created_at: datetime
    updated_at: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)

class TaskChecklistItemCreate(BaseModel):
    text: str
    
class TaskChecklistItemUpdate(BaseModel):
    is_completed: bool

class TaskChecklistItemOut(BaseModel):
    id: str
    task_id: str
    text: str
    is_completed: bool
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)

class TaskAttachmentOut(BaseModel):
    id: str
    task_id: str
    uploader_id: Optional[str] = None
    file_name: str
    file_path: str
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)
