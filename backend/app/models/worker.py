from sqlalchemy import Column, String, Boolean
from app.models.base import Base, TimestampMixin, uuid_pk


class PhaseWorker(Base, TimestampMixin):
    __tablename__ = "phase_workers"

    id = uuid_pk()
    name = Column(String(150), unique=True, nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
