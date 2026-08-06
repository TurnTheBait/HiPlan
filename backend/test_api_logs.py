from fastapi.testclient import TestClient
from app.main import app
from app.core.dependencies import get_current_user
from app.models.user import User, UserRole

def override_get_current_user():
    user = User(id="123", username="admin", role=UserRole.ADMIN)
    return user

app.dependency_overrides[get_current_user] = override_get_current_user

client = TestClient(app)

response = client.get("/api/replanning/logs")
print("Logs:", response.status_code)
print(response.json())
