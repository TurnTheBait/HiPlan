# pyrefly: ignore [missing-import]
from sqlalchemy import Column, String
from app.models.base import Base

class Setting(Base):
    __tablename__ = "settings"

    key = Column(String, primary_key=True, index=True)
    value = Column(String, nullable=True)
