import sys
from app.main import app

for route in app.routes:
    print(route.path, route.methods)
