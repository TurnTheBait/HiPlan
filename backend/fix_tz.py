filepath = '/Users/davidegirolamo/Programming/Gantt/backend/app/services/rescheduling_service.py'
with open(filepath, 'r') as f:
    content = f.read()

content = content.replace("run.created_at.isoformat() if run.created_at else None",
                          "run.created_at.isoformat() + 'Z' if run.created_at else None")
content = content.replace("run.undone_at.isoformat() if run.undone_at else None",
                          "run.undone_at.isoformat() + 'Z' if run.undone_at else None")

with open(filepath, 'w') as f:
    f.write(content)

