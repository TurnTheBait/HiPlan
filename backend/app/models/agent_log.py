import enum
# pyrefly: ignore [missing-import]
from sqlalchemy import Column, String, Text, Date, Integer, ForeignKey
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import relationship
from app.models.base import Base, TimestampMixin, uuid_pk, uuid_fk


class AgentActionType(str, enum.Enum):
    PHASE_RESCHEDULED = "phase_rescheduled"      # Fase spostata per conflitto/ritardo
    CASCADE_RESCHEDULED = "cascade_rescheduled"  # Fase spostata a cascata da dipendenza
    CONFLICT_DETECTED = "conflict_detected"      # Conflitto rilevato ma non auto-risolto
    VACATION_CONFLICT = "vacation_conflict"      # Conflitto con ferie dell'addetto
    LAG_DETECTED = "lag_detected"               # Fase in ritardo senza attività


class AgentLog(Base, TimestampMixin):
    __tablename__ = "agent_logs"

    id = uuid_pk()

    # Tipo di azione
    action_type = Column(String(50), nullable=False)

    # Fase coinvolta
    task_id = Column(uuid_fk(), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True)
    task_name = Column(String(500), nullable=False, default="")

    # Commessa
    project_id = Column(uuid_fk(), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    project_name = Column(String(200), nullable=False, default="")
    project_code = Column(String(50), nullable=True)

    # Addetto coinvolto
    worker = Column(String(200), nullable=True)

    # Date originali (per revoca)
    old_start_date = Column(Date, nullable=True)
    old_end_date = Column(Date, nullable=True)
    old_duration = Column(Integer, nullable=True)

    # Date nuove dopo ripianificazione
    new_start_date = Column(Date, nullable=True)
    new_end_date = Column(Date, nullable=True)
    new_duration = Column(Integer, nullable=True)

    # Motivazione testuale
    reason = Column(Text, nullable=True)

    # Stato revoca
    reverted = Column(Integer, default=0, nullable=False)   # 0=no, 1=sì
    reverted_at = Column(String(50), nullable=True)          # ISO timestamp
    reverted_by = Column(String(200), nullable=True)         # username admin

    # Relazioni (opzionali, per join)
    task = relationship("Task", foreign_keys=[task_id])
    project = relationship("Project", foreign_keys=[project_id])
