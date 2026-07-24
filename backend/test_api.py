import httpx

try:
    headers = {"Authorization": "Bearer invalidtoken"}
    r = httpx.get("http://localhost:8000/api/tickets", headers=headers)
    print("Status code:", r.status_code)
    print("Response:", r.text)
except Exception as e:
    print("Error:", e)
