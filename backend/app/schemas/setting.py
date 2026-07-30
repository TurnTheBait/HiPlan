# pyrefly: ignore [missing-import]
from pydantic import BaseModel, ConfigDict
from typing import Optional

class SettingBase(BaseModel):
    key: str
    value: Optional[str] = None

class SettingCreate(SettingBase):
    pass

class SettingUpdate(SettingBase):
    pass

class SettingOut(SettingBase):
    model_config = ConfigDict(from_attributes=True)

from datetime import datetime

# Schema for the GlobalBanner
class GlobalBannerItem(BaseModel):
    id: str
    text: str
    type: str = "info" # "info", "warning", "success", "error"
    duration_hours: int = 24
    created_at: datetime

