import urllib.request
import urllib.error
import os
import sys

token_query = os.popen("sqlite3 backend/ganttflow.db 'SELECT id FROM users LIMIT 1;'").read().strip()
sys.path.insert(0, "backend")
# pyrefly: ignore [missing-import]
from app.core.security import create_access_token
import json

token = create_access_token({"sub": token_query})

# 1. Create a todo
req = urllib.request.Request("http://127.0.0.1:8000/api/todos", 
    data=json.dumps({"title": "Test Todo", "content": "This is a description"}).encode(),
    headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    method="POST")
with urllib.request.urlopen(req) as response:
    todo = json.loads(response.read().decode())
    print("Created Todo:", todo["id"])

# 2. Search for the description
req2 = urllib.request.Request("http://127.0.0.1:8000/api/search?q=description", headers={"Authorization": f"Bearer {token}"})
with urllib.request.urlopen(req2) as response:
    print("Search Results:", response.read().decode())
