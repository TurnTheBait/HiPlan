import enum
# pyrefly: ignore [missing-import]
from sqlalchemy import Column, String, Text, Enum, ForeignKey
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import relationship
from app.models.base import Base, TimestampMixin, uuid_pk, uuid_fk


class TicketStatus(str, enum.Enum):
    OPEN = "open"
    CLOSED = "closed"


class TicketPriority(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Ticket(Base, TimestampMixin):
    __tablename__ = "tickets"

    id = uuid_pk()
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    project_id = Column(uuid_fk(), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    custom_project_code = Column(String(255), nullable=True)
    author_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    assigned_to = Column(Text, default="[]", nullable=False)  # JSON list of usernames
    attachments = Column(Text, default="[]", nullable=False)  # JSON list of file paths
    status = Column(Enum(TicketStatus), default=TicketStatus.OPEN, nullable=False)
    priority = Column(Enum(TicketPriority), default=TicketPriority.MEDIUM, nullable=False)

    author = relationship("User", foreign_keys=[author_id])
    project = relationship("Project", foreign_keys=[project_id])
    replies = relationship("TicketReply", back_populates="ticket", cascade="all, delete-orphan", order_by="TicketReply.created_at")


class TicketReply(Base, TimestampMixin):
    __tablename__ = "ticket_replies"

    id = uuid_pk()
    ticket_id = Column(uuid_fk(), ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False)
    author_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    content = Column(Text, nullable=False)
    attachments = Column(Text, default="[]", nullable=False)  # JSON list of file paths

    ticket = relationship("Ticket", back_populates="replies")
    author = relationship("User", foreign_keys=[author_id])
