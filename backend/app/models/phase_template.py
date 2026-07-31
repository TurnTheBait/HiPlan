from sqlalchemy import Column, String, Boolean, Integer, Float
from app.models.base import Base, TimestampMixin, uuid_pk


class PhaseTemplate(Base, TimestampMixin):
    __tablename__ = "phase_templates"

    id = uuid_pk()
    name = Column(String(255), nullable=False, index=True)
    department = Column(String(50), nullable=False, index=True)  # ufficio_tecnico | produzione | acquisti | tutti
    default_color = Column(String(50), default="#3b82f6", nullable=False)
    is_custom = Column(Boolean, default=False, nullable=False)
    default_days = Column(Integer, nullable=True)
    default_hours = Column(Float, nullable=True)
