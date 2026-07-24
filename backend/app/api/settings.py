import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import List
# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException, status
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy.future import select
from app.core.dependencies import get_db, get_current_user
from app.models.user import User, UserRole
from app.models.setting import Setting
from app.schemas.setting import GlobalBannerItem
# pyrefly: ignore [missing-import]
from pydantic import BaseModel

router = APIRouter(prefix="/api/settings", tags=["settings"])

class BannerCreate(BaseModel):
    text: str
    type: str = "info"

@router.get("/global-banner", response_model=List[GlobalBannerItem])
async def get_global_banners(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    res = await db.execute(select(Setting).where(Setting.key == "global_banner"))
    setting = res.scalar_one_or_none()
    
    if not setting or not setting.value:
        return []
    
    try:
        data = json.loads(setting.value)
        # Parse items and filter expired (>24h)
        now = datetime.now(timezone.utc)
        active_items = []
        changed = False
        
        for item in data:
            try:
                created_at = datetime.fromisoformat(item.get("created_at"))
                if now - created_at <= timedelta(hours=24):
                    active_items.append(item)
                else:
                    changed = True
            except (ValueError, TypeError):
                changed = True
        
        if changed:
            setting.value = json.dumps(active_items)
            await db.commit()
            
        return [GlobalBannerItem(**item) for item in active_items]
    except Exception:
        return []

@router.post("/global-banner", response_model=GlobalBannerItem)
async def create_global_banner(
    config: BannerCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo gli admin possono aggiornare la bacheca aziendale")
    
    res = await db.execute(select(Setting).where(Setting.key == "global_banner"))
    setting = res.scalar_one_or_none()
    
    current_items = []
    if setting and setting.value:
        try:
            parsed = json.loads(setting.value)
            if isinstance(parsed, list):
                current_items = parsed
        except Exception:
            current_items = []
            
    new_item = {
        "id": str(uuid.uuid4()),
        "text": config.text,
        "type": config.type,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    current_items.append(new_item)
    value_str = json.dumps(current_items)
    
    if setting:
        setting.value = value_str
    else:
        setting = Setting(key="global_banner", value=value_str)
        db.add(setting)
        
    await db.commit()
    return GlobalBannerItem(**new_item)

@router.delete("/global-banner/{banner_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_global_banner(
    banner_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo gli admin possono eliminare i banner")
    
    res = await db.execute(select(Setting).where(Setting.key == "global_banner"))
    setting = res.scalar_one_or_none()
    
    if not setting or not setting.value:
        return
        
    try:
        current_items = json.loads(setting.value)
        filtered_items = [item for item in current_items if item.get("id") != banner_id]
        
        setting.value = json.dumps(filtered_items)
        await db.commit()
    except Exception:
        pass


class TicketPhasesUpdate(BaseModel):
    phases: List[str]

@router.get("/ticket_phases", response_model=List[str])
async def get_ticket_phases(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    res = await db.execute(select(Setting).where(Setting.key == "ticket_phases"))
    setting = res.scalar_one_or_none()
    if not setting or not setting.value:
        return ["📝 Nota Interna", "📤 Inviato al cliente", "📥 Risposta dal cliente", "🔧 Intervento tecnico", "✅ Risoluzione"]
    try:
        return json.loads(setting.value)
    except Exception:
        return ["📝 Nota Interna"]

@router.put("/ticket_phases", response_model=List[str])
async def update_ticket_phases(
    config: TicketPhasesUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo gli admin possono gestire le fasi dei ticket")
    
    res = await db.execute(select(Setting).where(Setting.key == "ticket_phases"))
    setting = res.scalar_one_or_none()
    
    value_str = json.dumps(config.phases)
    if setting:
        setting.value = value_str
    else:
        setting = Setting(key="ticket_phases", value=value_str)
        db.add(setting)
        
    await db.commit()
    return config.phases

from app.services.backup_service import get_last_backup_info, run_backup

@router.get("/backup/status")
async def get_backup_status(
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo gli admin possono vedere lo stato dei backup")
    
    info = get_last_backup_info()
    return {"last_backup": info}

@router.post("/backup/trigger")
async def trigger_manual_backup(
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo gli admin possono forzare un backup")
    
    success, result = run_backup()
    if not success:
        raise HTTPException(status_code=500, detail=f"Errore durante il backup: {result}")
    
    info = get_last_backup_info()
    return {"message": "Backup completato con successo", "last_backup": info}
