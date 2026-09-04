# pyrefly: ignore [missing-import]
import pytest
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.task_service import (
    create_task, update_task, delete_task, get_gantt_data, create_link
)
from app.schemas.task import TaskCreate, TaskUpdate, LinkCreate
from app.models.user import User
from app.models.project import Project
from app.models.task import Task
# pyrefly: ignore [missing-import]
from fastapi import HTTPException
import datetime

@pytest.mark.asyncio
async def test_task_service_crud(db_session: AsyncSession, test_user: User, test_project: Project):
    # Create Task
    task_data = TaskCreate(
        text="Service Task",
        start_date=datetime.date.today(),
        duration=5,
        type="task"
    )
    
    task = await create_task(db_session, test_project.id, task_data, test_user)
    assert task.text == "Service Task"
    assert task.duration == 5

    # Get Gantt Data
    gantt_data = await get_gantt_data(db_session, test_project.id)
    assert len(gantt_data.tasks) >= 1
    assert any(t.id == task.id for t in gantt_data.tasks)

    # Update Task
    update_data = TaskUpdate(text="Updated Task Name", progress=0.5)
    updated_task = await update_task(db_session, task.id, update_data, test_user)
    assert updated_task.text == "Updated Task Name"

    # Delete Task
    await delete_task(db_session, task.id, test_user)
    
    gantt_data_after = await get_gantt_data(db_session, test_project.id)
    assert not any(t.id == task.id for t in gantt_data_after.tasks)

@pytest.mark.asyncio
async def test_task_links(db_session: AsyncSession, test_user: User, test_project: Project):
    # Create two tasks
    task1 = await create_task(
        db_session, test_project.id, 
        TaskCreate(text="Task 1", start_date=datetime.date.today(), duration=2, type="task"), 
        test_user
    )
    task2 = await create_task(
        db_session, test_project.id, 
        TaskCreate(text="Task 2", start_date=datetime.date.today() + datetime.timedelta(days=3), duration=2, type="task"), 
        test_user
    )

    # Create link
    link_data = LinkCreate(
        source=task1.id,
        target=task2.id,
        type="0"  # FS
    )
    link = await create_link(db_session, test_project.id, link_data, test_user)
    assert link.source == task1.id
    assert link.target == task2.id

    gantt = await get_gantt_data(db_session, test_project.id)
    assert len(gantt.links) == 1
    assert gantt.links[0].id == link.id

    # Ensure propagating shift or cyclic links can be caught, etc.
    # Note: Just triggering basic flow here for coverage

