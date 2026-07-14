import enum
from sqlalchemy import Column, String, Text, Date, Enum, ForeignKey
from sqlalchemy.orm import relationship
from app.models.base import Base, TimestampMixin, uuid_pk, uuid_fk


class ProjectStatus(str, enum.Enum):
    PLANNING = "planning"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class MemberRole(str, enum.Enum):
    MANAGER = "manager"
    MEMBER = "member"
    VIEWER = "viewer"


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id = uuid_pk()
    code = Column(String(50), nullable=True)
    client = Column(String(200), nullable=True)
    color = Column(String(30), nullable=True, default="#185FA5")
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    status = Column(Enum(ProjectStatus), default=ProjectStatus.PLANNING, nullable=False)
    owner_id = Column(uuid_fk(), ForeignKey("users.id"), nullable=False)

    owner = relationship("User", foreign_keys=[owner_id])
    members = relationship("ProjectMember", back_populates="project", cascade="all, delete-orphan")
    tasks = relationship("Task", back_populates="project", cascade="all, delete-orphan")
    links = relationship("Link", back_populates="project", cascade="all, delete-orphan")


class ProjectMember(Base):
    __tablename__ = "project_members"

    id = uuid_pk()
    project_id = Column(uuid_fk(), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(uuid_fk(), ForeignKey("users.id"), nullable=False)
    role = Column(Enum(MemberRole), default=MemberRole.MEMBER, nullable=False)

    project = relationship("Project", back_populates="members")
    user = relationship("User")
