from sqlalchemy import Column, String, Boolean
from app.models.base import Base, TimestampMixin, uuid_pk


class PhaseTemplate(Base, TimestampMixin):
    __tablename__ = "phase_templates"

    id = uuid_pk()
    name = Column(String(255), nullable=False, index=True)
    department = Column(String(50), nullable=False, index=True)  # ufficio_tecnico | produzione | acquisti | tutti
    default_color = Column(String(50), default="#3b82f6", nullable=False)
    is_custom = Column(Boolean, default=False, nullable=False)
