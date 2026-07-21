from sqlalchemy import Column, Date, String, ForeignKey, Text
from app.models.base import Base, TimestampMixin, uuid_pk, uuid_fk


class Vacation(Base, TimestampMixin):
    __tablename__ = "vacations"

    id = uuid_pk()
    user_id = Column(uuid_fk(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    reason = Column(String(255), nullable=True)
