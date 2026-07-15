from pydantic import BaseModel, ConfigDict
from typing import Optional
from datetime import datetime


class PhaseWorkerCreate(BaseModel):
    name: str


class PhaseWorkerOut(BaseModel):
    id: str
    name: str
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
