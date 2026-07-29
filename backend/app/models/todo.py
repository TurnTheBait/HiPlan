# pyrefly: ignore [missing-import]
from sqlalchemy import Column, String, Text, Boolean, DateTime, ForeignKey
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import relationship
from app.models.base import Base, TimestampMixin, uuid_pk, uuid_fk


class Todo(Base, TimestampMixin):
    __tablename__ = "todos"

    id = uuid_pk()
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=True)

    # Date
    notify_date = Column(DateTime, nullable=True)   # data in cui inviare la notifica (se notify_email=True)
    due_date = Column(DateTime, nullable=True)       # data di scadenza; reminder il giorno prima se non completato

    # Assegnazione
    creator_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    assignees = Column(Text, default="[]", nullable=False)   # JSON list of user IDs

    # Allegati
    attachments = Column(Text, default="[]", nullable=False)  # JSON list of file paths

    # Flags
    notify_email = Column(Boolean, default=False, nullable=False)
    notify_sent = Column(Boolean, default=False, nullable=False)
    due_reminder_sent = Column(Boolean, default=False, nullable=False)
    is_completed = Column(Boolean, default=False, nullable=False)

    creator = relationship("User", foreign_keys=[creator_id])
