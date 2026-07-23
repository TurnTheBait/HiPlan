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
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo gli admin possono aggiornare la bacheca aziendale")
        
    res = await db.execute(select(Setting).where(Setting.key == "global_banner"))
    setting = res.scalar_one_or_none()
    
    if not setting or not setting.value:
        return
        
    try:
        current_items = json.loads(setting.value)
        new_items = [item for item in current_items if item.get("id") != banner_id]
        
        if len(new_items) != len(current_items):
            setting.value = json.dumps(new_items)
            await db.commit()
    except Exception:
        pass

