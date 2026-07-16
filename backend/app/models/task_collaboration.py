import enum
from sqlalchemy import Column, String, Text, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import Base, TimestampMixin, uuid_pk, uuid_fk

class TaskComment(Base, TimestampMixin):
    __tablename__ = "task_comments"

    id = uuid_pk()
    task_id = Column(uuid_fk(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    author_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    content = Column(Text, nullable=False)
    
    task = relationship("Task", backref="comments")
    author = relationship("User", foreign_keys=[author_id])

class TaskChecklistItem(Base, TimestampMixin):
    __tablename__ = "task_checklist_items"

    id = uuid_pk()
    task_id = Column(uuid_fk(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    text = Column(String(500), nullable=False)
    is_completed = Column(Boolean, default=False, nullable=False)
    
    task = relationship("Task", backref="checklist_items")
