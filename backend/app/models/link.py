import enum
from sqlalchemy import Column, String, Integer, Enum, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import Base, uuid_pk, uuid_fk


class LinkType(str, enum.Enum):
    FS = "0"  # Finish-to-Start (DHTMLX usa numeri)
    SS = "1"  # Start-to-Start
    FF = "2"  # Finish-to-Finish
    SF = "3"  # Start-to-Finish


class Link(Base):
    __tablename__ = "links"

    id = uuid_pk()
    project_id = Column(uuid_fk(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    source = Column(uuid_fk(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    target = Column(uuid_fk(), ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    type = Column(Enum(LinkType), default=LinkType.FS, nullable=False)
    lag = Column(Integer, default=0, nullable=False)

    project = relationship("Project", back_populates="links")
    source_task = relationship("Task", foreign_keys=[source])
    target_task = relationship("Task", foreign_keys=[target])
