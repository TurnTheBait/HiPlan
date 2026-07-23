import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import SessionLocal
from app.models.user import User as UserModel
from app.models.setting import Setting
from app.models.phase_template import PhaseTemplate
from app.models.project import Project, ProjectMember
from app.models.task import Task
from app.models.note import Note
from app.models.vacation import Vacation
from app.models.notification import Notification
from app.models.link import Link
from app.models.task_collaboration import TaskComment, TaskChecklistItem
from sqlalchemy import select
import datetime
import uuid

async def test():
    async with SessionLocal() as db:
        models_order = [
            UserModel, Setting, PhaseTemplate, Project, ProjectMember,
            Task, Note, Vacation, Notification, Link, TaskComment, TaskChecklistItem
        ]

        data = {}
        for model in models_order:
            print(f"Testing model {model.__name__}")
            res = await db.execute(select(model))
            rows = res.scalars().all()
            model_name = model.__name__
            data[model_name] = []
            for row in rows:
                row_dict = {}
                for col in model.__table__.columns:
                    val = getattr(row, col.name)
                    if isinstance(val, (datetime.datetime, datetime.date)):
                        val = val.isoformat()
                    elif isinstance(val, uuid.UUID):
                        val = str(val)
                    elif hasattr(val, "value"): # Enum handling
                        val = val.value
                    row_dict[col.name] = val
                data[model_name].append(row_dict)
        print("Success")

asyncio.run(test())
