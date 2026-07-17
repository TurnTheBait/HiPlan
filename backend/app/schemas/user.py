from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime
from app.models.user import UserRole

try:
    import email_validator  # type: ignore
    from pydantic import EmailStr
    EmailType: Any = EmailStr
except ImportError:
    EmailType: Any = str


class UserCreate(BaseModel):
    email: EmailType
    username: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=1, max_length=128)
    full_name: Optional[str] = None
    department: Optional[str] = None  # ufficio_tecnico | produzione | acquisti


class UserLogin(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    username: str
    full_name: Optional[str] = None
    role: UserRole
    is_active: bool
    department: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
    department: Optional[str] = None


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenRefresh(BaseModel):
    refresh_token: str
