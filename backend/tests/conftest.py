# pyrefly: ignore [missing-import]
import pytest
# pyrefly: ignore [missing-import]
import pytest_asyncio
# pyrefly: ignore [missing-import]
from httpx import AsyncClient, ASGITransport
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.main import app
from app.core.dependencies import get_db
from app.models.base import Base
from app.core.security import hash_password
from app.models.user import User, UserRole

# Use an in-memory SQLite database for tests
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestingSessionLocal = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)

async def override_get_db():
    async with TestingSessionLocal() as session:
        yield session

app.dependency_overrides[get_db] = override_get_db

@pytest_asyncio.fixture(scope="function", autouse=True)
async def setup_db():
    """Create all tables in the test database before each test and drop them after."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    yield

    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest_asyncio.fixture(scope="function")
async def db_session():
    """Returns an async session for database operations within tests."""
    async with TestingSessionLocal() as session:
        yield session

@pytest_asyncio.fixture(scope="function")
async def client():
    """Provides an AsyncClient for making requests to the FastAPI application."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

@pytest_asyncio.fixture(scope="function")
async def test_user(db_session: AsyncSession):
    """Creates a test user and returns it."""
    user = User(
        email="test@example.com",
        username="testuser",
        hashed_password=hash_password("testpass"),
        full_name="Test User",
        role=UserRole.ADMIN,
        department="admin",
        is_active=True
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user

@pytest_asyncio.fixture(scope="function")
async def auth_token(client: AsyncClient, test_user: User):
    """Returns a valid access token for the test user."""
    response = await client.post(
        "/api/auth/login", 
        json={"email": "test@example.com", "password": "testpass"}
    )
    return response.json()["access_token"]

@pytest_asyncio.fixture(scope="function")
async def auth_headers(auth_token: str):
    """Returns authorization headers using the test user's token."""
    return {"Authorization": f"Bearer {auth_token}"}

from app.models.project import Project
import datetime

@pytest_asyncio.fixture(scope="function")
async def test_project(db_session: AsyncSession, test_user: User):
    project = Project(
        name="Test Project",
        description="A test project for tasks",
        start_date=datetime.date.today(),
        status="active",
        owner_id=test_user.id
    )
    db_session.add(project)
    await db_session.commit()
    await db_session.refresh(project)
    return project
