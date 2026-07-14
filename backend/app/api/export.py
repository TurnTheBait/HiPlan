from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.dependencies import get_db, get_current_user
from app.models.user import User
from app.services import export_service

router = APIRouter(prefix="/api/projects/{project_id}/export", tags=["export"])


@router.get("/excel")
async def export_excel(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    buffer = await export_service.export_excel(db, project_id)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=project_{project_id}.xlsx"},
    )


@router.get("/pdf")
async def export_pdf(
    project_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    buffer = await export_service.export_pdf(db, project_id)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=project_{project_id}.pdf"},
    )
