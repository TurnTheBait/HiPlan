import httpx
try:
    r = httpx.post("http://localhost:8001/api/auth/login", data={"username": "admin", "password": "password"})
    token = r.json().get("access_token")
    if token:
        headers = {"Authorization": f"Bearer {token}"}
        r = httpx.get("http://localhost:8001/api/tickets", headers=headers)
        print("Status code:", r.status_code)
        print("Response:", r.text)
    else:
        print("Login failed:", r.text)
except Exception as e:
    print("Error:", e)
