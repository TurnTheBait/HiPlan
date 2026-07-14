import enum
from sqlalchemy import Column, String, Text, Boolean, Enum, ForeignKey
from app.models.base import Base, TimestampMixin, uuid_pk, uuid_fk


class NotificationType(str, enum.Enum):
    ASSIGNMENT = "assignment"
    DEADLINE = "deadline"
    UPDATE = "update"


class Notification(Base, TimestampMixin):
    __tablename__ = "notifications"

    id = uuid_pk()
    user_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=True)
    type = Column(Enum(NotificationType), default=NotificationType.UPDATE, nullable=False)
    is_read = Column(Boolean, default=False, nullable=False)
    project_id = Column(uuid_fk(), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
