import enum
# pyrefly: ignore [missing-import]
from sqlalchemy import Column, String, Text, ForeignKey, Enum
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import relationship
from app.models.base import Base, TimestampMixin, uuid_pk, uuid_fk

class ActivityCategory(str, enum.Enum):
    PHASE_PROJECT_EDIT = "phase_project_edit"
    HOURS_LOG = "hours_log"

class ActivityLog(Base, TimestampMixin):
    __tablename__ = "activity_logs"

    id = uuid_pk()
    project_id = Column(uuid_fk(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    category = Column(Enum(ActivityCategory), nullable=False)
    action_text = Column(Text, nullable=False)

    project = relationship("Project", back_populates="activity_logs")
    user = relationship("User")
