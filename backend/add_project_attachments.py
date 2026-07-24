import re

with open("app/api/projects.py", "r") as f:
    content = f.read()

# Make sure to add necessary imports at the top
if "UploadFile" not in content:
    content = content.replace("from fastapi import APIRouter, Depends", "from fastapi import APIRouter, Depends, UploadFile, File, HTTPException\nimport os, uuid\n")

endpoints = """

PROJECTS_UPLOAD_DIR = "uploads/projects"
os.makedirs(PROJECTS_UPLOAD_DIR, exist_ok=True)
MAX_FILE_SIZE_MB = 10

@router.post("/{project_id}/attachments")
async def upload_project_attachment(
    project_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import select
    from app.models.project import Project
    import json
    
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Progetto non trovato")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"File troppo grande (max {MAX_FILE_SIZE_MB}MB)")

    ext = os.path.splitext(file.filename or "")[1]
    filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(PROJECTS_UPLOAD_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)

    attachments = []
    if project.attachments:
        try:
            attachments = json.loads(project.attachments)
            if not isinstance(attachments, list):
                attachments = []
        except:
            pass

    new_att = {"name": file.filename, "path": f"uploads/projects/{filename}"}
    attachments.append(new_att)
    project.attachments = json.dumps(attachments)
    await db.commit()

    return new_att

@router.delete("/{project_id}/attachments/{filename}")
async def delete_project_attachment(
    project_id: str,
    filename: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import select
    from app.models.project import Project
    import json
    
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Progetto non trovato")

    attachments = []
    if project.attachments:
        try:
            attachments = json.loads(project.attachments)
            if not isinstance(attachments, list):
                attachments = []
        except:
            pass

    new_attachments = []
    found = False
    for att in attachments:
        if att.get("path", "").endswith(filename):
            found = True
            filepath = att.get("path")
            if filepath and os.path.exists(filepath):
                os.remove(filepath)
        else:
            new_attachments.append(att)

    if not found:
        raise HTTPException(status_code=404, detail="Allegato non trovato")

    project.attachments = json.dumps(new_attachments)
    await db.commit()
    return {"status": "ok"}
"""

content += endpoints

with open("app/api/projects.py", "w") as f:
    f.write(content)

