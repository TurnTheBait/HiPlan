# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional

class SettingBase(BaseModel):
    key: str
    value: Optional[str] = None

class SettingCreate(SettingBase):
    pass

class SettingUpdate(SettingBase):
    pass

class SettingOut(SettingBase):
    class Config:
        from_attributes = True

from datetime import datetime

# Schema for the GlobalBanner
class GlobalBannerItem(BaseModel):
    id: str
    text: str
    type: str = "info" # "info", "warning", "success", "error"
    created_at: datetime

