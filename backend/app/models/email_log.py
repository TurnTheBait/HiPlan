# pyrefly: ignore [missing-import]
from sqlalchemy import Column, Integer, String, Text, DateTime
# pyrefly: ignore [missing-import]
from sqlalchemy.sql import func
from app.models.base import Base

class EmailLog(Base):
    __tablename__ = "email_logs"

    id = Column(Integer, primary_key=True, index=True)
    recipient = Column(String, index=True, nullable=False)
    subject = Column(String, nullable=False)
    status = Column(String, index=True, nullable=False)  # "success" or "error"
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
