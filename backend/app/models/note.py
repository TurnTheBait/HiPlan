from sqlalchemy import Column, String, Text, Boolean, ForeignKey, DateTime
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import relationship
from app.models.base import Base, TimestampMixin, uuid_pk, uuid_fk


class Note(Base, TimestampMixin):
    __tablename__ = "notes"

    id = uuid_pk()
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=True)
    attachments = Column(Text, nullable=True, default="[]")
    is_shared = Column(Boolean, default=False, nullable=False)
    visibility = Column(String(50), nullable=False, default="private")
    shared_with = Column(Text, nullable=False, default="[]")
    owner_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    deleted_at = Column(DateTime, nullable=True, default=None)

    owner = relationship("User", foreign_keys=[owner_id])

