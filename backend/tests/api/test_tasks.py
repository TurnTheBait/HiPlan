# pyrefly: ignore [missing-import]
import pytest
# pyrefly: ignore [missing-import]
from httpx import AsyncClient
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.project import Project
from app.models.vacation import Vacation
from app.models.task import Task
import datetime

@pytest.mark.asyncio
async def test_create_task(client: AsyncClient, auth_headers: dict, test_project: Project):
    response = await client.post(
        f"/api/projects/{test_project.id}/tasks",
        headers=auth_headers,
        json={
            "text": "New Task",
            "start_date": "2026-10-01",
            "duration": 5,
            "type": "task",
            "progress": 0.0,
            "parent_id": None,
            "workers": [],
            "planned_hours": 40.0
        }  )
    assert response.status_code == 201
    data = response.json()
    assert data["text"] == "New Task"
    assert "id" in data


@pytest.mark.asyncio
async def test_assignment_during_vacation_uses_earliest_available_capacity(
    client: AsyncClient,
    auth_headers: dict,
    test_project: Project,
    test_user,
    db_session: AsyncSession,
):
    db_session.add(Vacation(
        user_id=test_user.id,
        start_date=datetime.date(2026, 10, 1),
        end_date=datetime.date(2026, 10, 2),
        reason="Ferie programmate",
    ))
    await db_session.commit()

    response = await client.post(
        f"/api/projects/{test_project.id}/tasks",
        headers=auth_headers,
        json={
            "text": "Fase assegnata durante le ferie",
            "start_date": "2026-10-01",
            "end_date": "2026-10-01",
            "duration": 1,
            "type": "task",
            "workers": [test_user.username],
            "worker_hours": {test_user.username: 8},
            "planned_hours": 8,
        },
    )

    assert response.status_code == 201, response.text
    created = response.json()
    assert created["start_date"].startswith("2026-10-05")
    assert created["end_date"].startswith("2026-10-05")
    assert created["has_vacation_conflict"] == 0


@pytest.mark.asyncio
async def test_updating_assignee_during_vacation_reschedules_instead_of_blocking(
    client: AsyncClient,
    auth_headers: dict,
    test_project: Project,
    test_user,
    db_session: AsyncSession,
):
    task = Task(
        text="Fase da assegnare",
        start_date=datetime.date(2026, 10, 1),
        end_date=datetime.date(2026, 10, 1),
        duration=1,
        planned_hours=8,
        workers="[]",
        worker_hours="{}",
        project_id=test_project.id,
    )
    db_session.add_all([
        task,
        Vacation(
            user_id=test_user.id,
            start_date=datetime.date(2026, 10, 1),
            end_date=datetime.date(2026, 10, 2),
            reason="Ferie programmate",
        ),
    ])
    await db_session.commit()

    response = await client.put(
        f"/api/projects/{test_project.id}/tasks/{task.id}",
        headers=auth_headers,
        json={
            "workers": [test_user.username],
            "worker_hours": {test_user.username: 8},
            "planned_hours": 8,
        },
    )

    assert response.status_code == 200, response.text
    updated = response.json()
    assert updated["start_date"].startswith("2026-10-05")
    assert updated["end_date"].startswith("2026-10-05")

@pytest.mark.asyncio
async def test_get_tasks(client: AsyncClient, auth_headers: dict, test_project: Project, db_session: AsyncSession):
    # Add a task to DB
    task = Task(
        text="Sample Task",
        start_date=datetime.date(2026, 10, 1),
        duration=3,
        project_id=test_project.id,
        type="task"
    )
    db_session.add(task)
    await db_session.commit()

    response = await client.get(f"/api/projects/{test_project.id}/gantt", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    
    assert "tasks" in data
    assert isinstance(data["tasks"], list)
    assert any(t["text"] == "Sample Task" for t in data["tasks"])

@pytest.mark.asyncio
async def test_update_task(client: AsyncClient, auth_headers: dict, test_project: Project, db_session: AsyncSession):
    task = Task(
        text="Task to Update",
        start_date=datetime.date(2026, 10, 1),
        duration=3,
        project_id=test_project.id,
        type="task"
    )
    db_session.add(task)
    await db_session.commit()
    await db_session.refresh(task)

    response = await client.put(
        f"/api/projects/{test_project.id}/tasks/{task.id}",
        headers=auth_headers,
        json={
            "text": "Updated Task",
            "duration": 4
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["text"] == "Updated Task"
    assert data["duration"] == 4

@pytest.mark.asyncio
async def test_delete_task(client: AsyncClient, auth_headers: dict, test_project: Project, db_session: AsyncSession):
    task = Task(
        text="Task to Delete",
        start_date=datetime.date(2026, 10, 1),
        duration=3,
        project_id=test_project.id,
        type="task"
    )
    db_session.add(task)
    await db_session.commit()
    await db_session.refresh(task)

    response = await client.delete(f"/api/projects/{test_project.id}/tasks/{task.id}", headers=auth_headers)
    assert response.status_code == 204

    # Verify it's deleted
    response_get = await client.get(f"/api/projects/{test_project.id}/gantt", headers=auth_headers)
    assert response_get.status_code == 200
    data = response_get.json()
    assert all(t["id"] != task.id for t in data["tasks"])

@pytest.mark.asyncio
async def test_create_link(client: AsyncClient, auth_headers: dict, test_project: Project, db_session: AsyncSession):
    task1 = Task(text="Task 1", start_date=datetime.date(2026, 10, 1), duration=3, project_id=test_project.id)
    task2 = Task(text="Task 2", start_date=datetime.date(2026, 10, 5), duration=3, project_id=test_project.id)
    db_session.add_all([task1, task2])
    await db_session.commit()
    await db_session.refresh(task1)
    await db_session.refresh(task2)

    response = await client.post(
        f"/api/projects/{test_project.id}/links",
        headers=auth_headers,
        json={
            "source": str(task1.id),
            "target": str(task2.id),
            "type": "0"
        }
    )
    assert response.status_code == 201
    data = response.json()
    assert data["source"] == str(task1.id)
    assert data["target"] == str(task2.id)
