# pyrefly: ignore [missing-import]
from sqlalchemy import Column, String, Text, ForeignKey, DateTime
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import relationship

from app.models.base import Base, TimestampMixin, uuid_pk, uuid_fk


class PlanningRun(Base, TimestampMixin):
    """Audit persistente di una ripianificazione automatica e del relativo rollback."""

    __tablename__ = "planning_runs"

    id = uuid_pk()
    batch_id = Column(String(36), nullable=True, index=True)
    project_id = Column(uuid_fk(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    undone_by_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status = Column(String(20), nullable=False, default="applied")
    trigger_summary = Column(Text, nullable=False)
    solution_summary = Column(Text, nullable=False)
    snapshot_json = Column(Text, nullable=False, default="{}")
    allocations_json = Column(Text, nullable=False, default="[]")
    undone_at = Column(DateTime(timezone=True), nullable=True)

    project = relationship("Project")
    created_by = relationship("User", foreign_keys=[created_by_id])
    undone_by = relationship("User", foreign_keys=[undone_by_id])
