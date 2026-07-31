import urllib.request
import urllib.error
import os
import sys

token_query = os.popen("sqlite3 backend/ganttflow.db 'SELECT id FROM users LIMIT 1;'").read().strip()
sys.path.insert(0, "backend")
from app.core.security import create_access_token

token = create_access_token({"sub": token_query})
req = urllib.request.Request("http://127.0.0.1:8000/api/search?q=test", headers={"Authorization": f"Bearer {token}"})

try:
    with urllib.request.urlopen(req) as response:
        print(response.status)
        print(response.read().decode())
except urllib.error.HTTPError as e:
    print(e.code)
    print(e.read().decode())
