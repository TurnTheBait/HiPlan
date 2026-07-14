from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
import uuid
from sqlalchemy import Column, DateTime, func
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from app.core.config import settings

is_sqlite = "sqlite" in settings.DATABASE_URL

if is_sqlite:
    engine = create_async_engine(settings.DATABASE_URL, echo=settings.DEBUG)
else:
    engine = create_async_engine(settings.DATABASE_URL, echo=settings.DEBUG, pool_size=20, max_overflow=10)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


def generate_uuid():
    return str(uuid.uuid4())


def uuid_pk():
    """Colonna UUID compatibile sia con PostgreSQL che SQLite."""
    if is_sqlite:
        from sqlalchemy import String
        return Column(String(36), primary_key=True, default=generate_uuid)
    return Column(PG_UUID(as_uuid=False), primary_key=True, default=generate_uuid)


def uuid_fk():
    """Colonna UUID per foreign key, compatibile sia con PostgreSQL che SQLite."""
    if is_sqlite:
        from sqlalchemy import String
        return String(36)
    return PG_UUID(as_uuid=False)
