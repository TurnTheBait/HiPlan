from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime

class EmailLogBase(BaseModel):
    recipient: str
    subject: str
    status: str
    error_message: Optional[str] = None

class EmailLogResponse(EmailLogBase):
    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
