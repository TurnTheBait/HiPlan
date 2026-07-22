from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.core.dependencies import get_db, get_current_user
from app.models.user import User, UserRole
from app.models.phase_template import PhaseTemplate
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/phase-templates", tags=["phase_templates"])


class PhaseTemplateCreate(BaseModel):
    name: str
    department: str = "ufficio_tecnico"
    default_color: str = "#3b82f6"
    is_custom: bool = False


class PhaseTemplateUpdate(BaseModel):
    name: Optional[str] = None
    department: Optional[str] = None
    default_color: Optional[str] = None


@router.get("")
async def list_phase_templates(
    department: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(PhaseTemplate)
    if department and department != "all":
        query = query.where((PhaseTemplate.department == department) | (PhaseTemplate.department == "tutti"))
    
    query = query.order_by(PhaseTemplate.department, PhaseTemplate.name)
    result = await db.execute(query)
    templates = result.scalars().all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "department": t.department,
            "default_color": t.default_color,
            "is_custom": t.is_custom,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in templates
    ]


@router.post("", status_code=201)
async def create_phase_template(
    data: PhaseTemplateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not data.name or not data.name.strip():
        raise HTTPException(status_code=400, detail="Il nome della fase è obbligatorio")

    clean_name = data.name.strip()
    # Controlla se esiste già una fase con lo stesso nome per questo reparto o tutti
    result = await db.execute(
        select(PhaseTemplate).where(
            (PhaseTemplate.name == clean_name) & (PhaseTemplate.department == data.department)
        )
    )
    existing = result.scalar_one_or_none()
    if existing:
        if data.default_color:
            existing.default_color = data.default_color
        await db.commit()
        await db.refresh(existing)
        return {
            "id": existing.id,
            "name": existing.name,
            "department": existing.department,
            "default_color": existing.default_color,
            "is_custom": existing.is_custom,
        }

    template = PhaseTemplate(
        name=clean_name,
        department=data.department,
        default_color=data.default_color or "#3b82f6",
        is_custom=data.is_custom,
    )
    db.add(template)
    await db.commit()
    await db.refresh(template)
    return {
        "id": template.id,
        "name": template.name,
        "department": template.department,
        "default_color": template.default_color,
        "is_custom": template.is_custom,
    }


@router.put("/{template_id}")
async def update_phase_template(
    template_id: str,
    data: PhaseTemplateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(PhaseTemplate).where(PhaseTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Fase preimpostata non trovata")

    if data.name is not None and data.name.strip():
        template.name = data.name.strip()
    if data.department is not None:
        template.department = data.department
    if data.default_color is not None:
        template.default_color = data.default_color

    await db.commit()
    await db.refresh(template)
    return {
        "id": template.id,
        "name": template.name,
        "department": template.department,
        "default_color": template.default_color,
        "is_custom": template.is_custom,
    }


@router.delete("/{template_id}")
async def delete_phase_template(
    template_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(PhaseTemplate).where(PhaseTemplate.id == template_id))
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(status_code=404, detail="Fase preimpostata non trovata")

    await db.delete(template)
    await db.commit()
    return {"ok": True}
