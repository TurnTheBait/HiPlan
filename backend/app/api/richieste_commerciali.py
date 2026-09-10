"""
API per il modulo Richieste Commerciali.
Coordina il workflow: Commerciale → Acquisti → Admin.
"""
import json
import os
import shutil
import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Union

# pyrefly: ignore [missing-import]
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy.future import select
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import selectinload

from app.core.dependencies import get_db, get_current_user
from app.models.user import User, UserRole
from app.models.setting import Setting
from app.models.richiesta_commerciale import RichiestaCommerciale, ArticoloRichiesta, RichiestaStatus
from app.schemas.richiesta_commerciale import (
    RichiestaCreate,
    RichiestaUpdate,
    RichiestaOut,
    RichiestaOutCommerciale,
    RichiestaOutAcquisti,
    ArticoloCreate,
    ArticoloUpdate,
    CompletaRichiestaIn,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/richieste-commerciali", tags=["Richieste Commerciali"])

UPLOAD_DIR = "uploads/richieste_commerciali"
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ─── Helpers per le liste utenti ─────────────────────────────────────────────

async def _get_setting_list(db: AsyncSession, key: str) -> List[str]:
    """Legge una lista JSON dalla tabella settings."""
    res = await db.execute(select(Setting).where(Setting.key == key))
    setting = res.scalar_one_or_none()
    if not setting or not setting.value:
        return []
    try:
        return json.loads(setting.value)
    except Exception:
        return []


async def _get_role(db: AsyncSession, user: User) -> str:
    """
    Determina il ruolo dell'utente nel modulo richieste commerciali.
    Restituisce: 'admin' | 'acquisti' | 'commerciale' | 'none'
    Precedenza: admin HiPlan (default) > rc_admin_users > rc_acquisti_users > rc_commerciale_users
    """
    if user.role == UserRole.ADMIN or str(getattr(user.role, 'value', user.role)).lower() == 'admin':
        return "admin"

    username = str(user.username)
    admin_list = await _get_setting_list(db, "rc_admin_users")
    if username in admin_list:
        return "admin"
    acquisti_list = await _get_setting_list(db, "rc_acquisti_users")
    if username in acquisti_list:
        return "acquisti"
    commerciale_list = await _get_setting_list(db, "rc_commerciale_users")
    if username in commerciale_list:
        return "commerciale"
    return "none"


async def _require_role(db: AsyncSession, user: User, allowed: List[str]) -> str:
    """Verifica che l'utente abbia uno dei ruoli consentiti, altrimenti 403."""
    role = await _get_role(db, user)
    if role not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Non sei autorizzato ad accedere a questa sezione.",
        )
    return role


async def _get_user_emails_by_usernames(db: AsyncSession, usernames: List[str]) -> List[str]:
    """Restituisce le email degli utenti attivi nella lista username."""
    if not usernames:
        return []
    res = await db.execute(
        select(User).where(User.username.in_(usernames), User.is_active == True)
    )
    users = res.scalars().all()
    return [str(u.email) for u in users if u.email]


def _parse_attachments(attachments_str: str) -> List[str]:
    try:
        return json.loads(attachments_str) if attachments_str else []
    except Exception:
        return []


def _to_utc_iso(dt: Union[datetime, None]) -> Union[str, None]:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _richiesta_options():
    return [
        selectinload(RichiestaCommerciale.author),
        selectinload(RichiestaCommerciale.articoli_inserted_by),
        selectinload(RichiestaCommerciale.listino_inserted_by),
        selectinload(RichiestaCommerciale.articoli).selectinload(ArticoloRichiesta.author),
    ]


# ─── Serializzatori per ruolo ─────────────────────────────────────────────────

def _serialize_richiesta(richiesta: RichiestaCommerciale, role: str) -> dict:
    """Serializza una richiesta adattando i dati al ruolo."""
    articoli_inserted_by_user = richiesta.articoli_inserted_by
    articoli_inserted_at_dt = richiesta.articoli_inserted_at
    listino_inserted_by_user = richiesta.listino_inserted_by
    listino_inserted_at_dt = richiesta.listino_inserted_at

    # Se non impostato esplicitamente ma ci sono articoli: fallback
    if not articoli_inserted_by_user and richiesta.articoli:
        for a in richiesta.articoli:
            if getattr(a, 'author', None):
                articoli_inserted_by_user = a.author
                break
    if not articoli_inserted_at_dt and richiesta.articoli:
        articoli_inserted_at_dt = richiesta.articoli[-1].created_at or richiesta.updated_at

    base = {
        "id": richiesta.id,
        "title": richiesta.title,
        "description": richiesta.description,
        "numero_offerta": richiesta.numero_offerta,
        "cliente": richiesta.cliente,
        "attachments": _parse_attachments(str(richiesta.attachments)),
        "status": richiesta.status,
        "author": {
            "id": richiesta.author.id,
            "username": richiesta.author.username,
            "full_name": richiesta.author.full_name,
        } if richiesta.author else None,
        "articoli_inserted_by": {
            "id": articoli_inserted_by_user.id,
            "username": articoli_inserted_by_user.username,
            "full_name": articoli_inserted_by_user.full_name,
        } if articoli_inserted_by_user else None,
        "articoli_inserted_at": _to_utc_iso(articoli_inserted_at_dt),
        "listino_inserted_by": {
            "id": listino_inserted_by_user.id if listino_inserted_by_user else "admin",
            "username": listino_inserted_by_user.username if listino_inserted_by_user else "admin",
            "full_name": listino_inserted_by_user.full_name if listino_inserted_by_user else "Amministrazione",
        } if (listino_inserted_by_user or richiesta.status == RichiestaStatus.COMPLETATA) else None,
        "listino_inserted_at": _to_utc_iso(listino_inserted_at_dt or (richiesta.updated_at if richiesta.status == RichiestaStatus.COMPLETATA else None)),
        "created_at": _to_utc_iso(richiesta.created_at),
        "updated_at": _to_utc_iso(richiesta.updated_at),
    }

    if role == "admin":
        # Admin vede tutto
        base["articoli"] = [_serialize_articolo(a, "admin") for a in richiesta.articoli]
    elif role == "acquisti":
        # Acquisti: tutti i campi tranne prezzo_listino
        base["articoli"] = [_serialize_articolo(a, "acquisti") for a in richiesta.articoli]
    else:
        # Commerciale: solo info essenziali + prezzo listino (quando completata)
        base["articoli"] = [_serialize_articolo(a, "commerciale") for a in richiesta.articoli]

    return base


def _serialize_articolo(articolo: ArticoloRichiesta, role: str) -> dict:
    """Serializza un articolo adattando i campi al ruolo."""
    base = {
        "id": articolo.id,
        "richiesta_id": articolo.richiesta_id,
        "author": {
            "id": articolo.author.id,
            "username": articolo.author.username,
            "full_name": articolo.author.full_name,
        } if getattr(articolo, 'author', None) else None,
        "titolo": articolo.titolo,
        "descrizione": articolo.descrizione,
        "is_standard": articolo.is_standard,
        "is_atex": articolo.is_atex,
        "is_alimentare": articolo.is_alimentare,
        "tipo_fornitura": articolo.tipo_fornitura,
        "attachments": _parse_attachments(str(articolo.attachments)),
        "created_at": _to_utc_iso(articolo.created_at),
        "updated_at": _to_utc_iso(articolo.updated_at),
    }

    if role == "admin":
        base["costo"] = articolo.costo
        base["prezzo_listino"] = articolo.prezzo_listino
        base["testo_originale_acquisti"] = articolo.testo_originale_acquisti
        base["note_admin"] = articolo.note_admin
    elif role == "acquisti":
        base["costo"] = articolo.costo
    else:
        # Commerciale: MAI il costo dell'ufficio acquisti! Solo prezzo listino e note admin
        base["prezzo_listino"] = articolo.prezzo_listino
        base["note_admin"] = articolo.note_admin

    return base


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/my-role")
async def get_my_role(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Restituisce il ruolo dell'utente corrente nel modulo RC (admin | acquisti | commerciale | none)."""
    role = await _get_role(db, current_user)
    return {"role": role, "enabled": role != "none"}


@router.get("/")
async def list_richieste(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista richieste filtrata per ruolo."""
    role = await _require_role(db, current_user, ["admin", "acquisti", "commerciale"])

    query = (
        select(RichiestaCommerciale)
        .options(
            *_richiesta_options(),
        )
        .where(RichiestaCommerciale.deleted_at.is_(None))
        .order_by(RichiestaCommerciale.created_at.desc())
    )

    if role == "commerciale":
        # Il commerciale vede solo le proprie richieste
        query = query.where(RichiestaCommerciale.author_id == current_user.id)
    elif role == "acquisti":
        # L'acquisti vede tutte le richieste (ma non i prezzi di listino)
        pass
    # admin vede tutto senza filtri

    res = await db.execute(query)
    richieste = res.scalars().all()
    return [_serialize_richiesta(r, role) for r in richieste]


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_richiesta(
    data: RichiestaCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Crea una nuova richiesta (solo commerciale o admin)."""
    role = await _require_role(db, current_user, ["commerciale", "admin"])

    richiesta = RichiestaCommerciale(
        title=data.title,
        description=data.descrizione,
        numero_offerta=data.numero_offerta,
        cliente=data.cliente,
        attachments="[]",
        author_id=current_user.id,
        status=RichiestaStatus.APERTA,
    )
    db.add(richiesta)
    await db.commit()
    await db.refresh(richiesta)

    # Carica relazioni per la risposta
    res = await db.execute(
        select(RichiestaCommerciale)
        .options(
            *_richiesta_options(),
        )
        .where(RichiestaCommerciale.id == richiesta.id)
    )
    richiesta = res.scalar_one()

    # Email notifica agli acquisti
    await _notify_acquisti_nuova_richiesta(db, richiesta, current_user)

    return _serialize_richiesta(richiesta, role)


# ─── Cestino (Trash - Solo Admin) ─────────────────────────────────────────────

async def _purge_expired_trash(db: AsyncSession):
    """Elimina definitivamente le richieste nel cestino da più di 90 giorni."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    res = await db.execute(
        select(RichiestaCommerciale).where(
            RichiestaCommerciale.deleted_at.isnot(None),
            RichiestaCommerciale.deleted_at <= cutoff,
        )
    )
    expired = res.scalars().all()
    for r in expired:
        folder = os.path.join(UPLOAD_DIR, str(r.id))
        if os.path.isdir(folder):
            shutil.rmtree(folder, ignore_errors=True)
        await db.delete(r)
    if expired:
        await db.commit()


@router.get("/trash")
async def list_trash(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Restituisce le richieste nel cestino con giorni rimanenti (solo admin)."""
    await _require_role(db, current_user, ["admin"])
    await _purge_expired_trash(db)

    res = await db.execute(
        select(RichiestaCommerciale)
        .options(
            *_richiesta_options(),
        )
        .where(RichiestaCommerciale.deleted_at.isnot(None))
        .order_by(RichiestaCommerciale.deleted_at.desc())
    )
    trashed = res.scalars().all()
    now = datetime.now(timezone.utc)
    items = []
    for r in trashed:
        deleted_dt = r.deleted_at or now
        if deleted_dt.tzinfo is None:
            deleted_dt = deleted_dt.replace(tzinfo=timezone.utc)
        elapsed = (now - deleted_dt).days
        days_left = max(0, 90 - elapsed)
        items.append({
            "id": r.id,
            "title": r.title,
            "cliente": r.cliente,
            "numero_offerta": r.numero_offerta,
            "status": r.status,
            "deleted_at": _to_utc_iso(r.deleted_at),
            "days_left": days_left,
            "author": {
                "id": r.author.id,
                "username": r.author.username,
                "full_name": r.author.full_name,
            } if r.author else None,
            "articoli_count": len(r.articoli),
        })
    return items


@router.post("/trash/{richiesta_id}/restore")
async def restore_richiesta(
    richiesta_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ripristina una richiesta dal cestino (solo admin)."""
    await _require_role(db, current_user, ["admin"])

    res = await db.execute(
        select(RichiestaCommerciale)
        .options(
            *_richiesta_options(),
        )
        .where(RichiestaCommerciale.id == richiesta_id)
    )
    richiesta = res.scalar_one_or_none()
    if not richiesta:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")

    richiesta.deleted_at = None
    richiesta.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(richiesta)

    # Ricarica per serializzazione
    res = await db.execute(
        select(RichiestaCommerciale)
        .options(
            *_richiesta_options(),
        )
        .where(RichiestaCommerciale.id == richiesta_id)
    )
    richiesta = res.scalar_one()
    return _serialize_richiesta(richiesta, "admin")


@router.delete("/trash/empty")
async def empty_trash(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Svuota completamente il cestino delle richieste (solo admin)."""
    await _require_role(db, current_user, ["admin"])

    res = await db.execute(
        select(RichiestaCommerciale).where(RichiestaCommerciale.deleted_at.isnot(None))
    )
    trashed = res.scalars().all()
    for r in trashed:
        folder = os.path.join(UPLOAD_DIR, str(r.id))
        if os.path.isdir(folder):
            shutil.rmtree(folder, ignore_errors=True)
        await db.delete(r)

    if trashed:
        await db.commit()
    return {"message": "Cestino svuotato con successo"}


@router.delete("/trash/{richiesta_id}")
async def hard_delete_richiesta(
    richiesta_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Elimina definitivamente una richiesta dal cestino (solo admin)."""
    await _require_role(db, current_user, ["admin"])

    res = await db.execute(
        select(RichiestaCommerciale).where(RichiestaCommerciale.id == richiesta_id)
    )
    richiesta = res.scalar_one_or_none()
    if not richiesta:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")

    folder = os.path.join(UPLOAD_DIR, str(richiesta.id))
    if os.path.isdir(folder):
        shutil.rmtree(folder, ignore_errors=True)

    await db.delete(richiesta)
    await db.commit()
    return {"message": "Richiesta eliminata definitivamente"}


@router.get("/{richiesta_id}")
async def get_richiesta(
    richiesta_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Dettaglio singola richiesta."""
    role = await _require_role(db, current_user, ["admin", "acquisti", "commerciale"])

    res = await db.execute(
        select(RichiestaCommerciale)
        .options(
            *_richiesta_options(),
        )
        .where(
            RichiestaCommerciale.id == richiesta_id,
            RichiestaCommerciale.deleted_at.is_(None),
        )
    )
    richiesta = res.scalar_one_or_none()
    if not richiesta:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")

    # Commerciale: accede solo alle proprie richieste
    if role == "commerciale" and str(richiesta.author_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Non autorizzato")

    return _serialize_richiesta(richiesta, role)


@router.put("/{richiesta_id}")
async def update_richiesta(
    richiesta_id: str,
    data: RichiestaUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Modifica una richiesta:
    - Admin: può modificare qualsiasi campo (titolo, descrizione, numero offerta, cliente)
      e cambiare liberamente lo stato (aperta, in_lavorazione, manca_listino, completata).
    - Commerciale: può modificare solo le proprie richieste se ancora in stato APERTA.
    """
    role = await _require_role(db, current_user, ["commerciale", "admin"])

    res = await db.execute(
        select(RichiestaCommerciale)
        .options(
            *_richiesta_options(),
        )
        .where(
            RichiestaCommerciale.id == richiesta_id,
            RichiestaCommerciale.deleted_at.is_(None),
        )
    )
    richiesta = res.scalar_one_or_none()
    if not richiesta:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")

    if role == "commerciale":
        if str(richiesta.author_id) != str(current_user.id):
            raise HTTPException(status_code=403, detail="Non puoi modificare richieste di altri utenti")
        if richiesta.status != RichiestaStatus.APERTA:
            raise HTTPException(status_code=400, detail="Puoi modificare la richiesta solo finché è in stato Aperta")
        if data.status is not None and data.status != richiesta.status:
            raise HTTPException(status_code=403, detail="Non hai i permessi per modificare lo stato")

    if data.title is not None:
        richiesta.title = data.title  # type: ignore
    if data.descrizione is not None:
        richiesta.description = data.descrizione  # type: ignore
    if data.numero_offerta is not None:
        richiesta.numero_offerta = data.numero_offerta  # type: ignore
    if data.cliente is not None:
        richiesta.cliente = data.cliente  # type: ignore
    if role == "admin" and data.status is not None:
        richiesta.status = data.status  # type: ignore

    richiesta.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(richiesta)
    return _serialize_richiesta(richiesta, role)


@router.delete("/{richiesta_id}")
async def delete_richiesta(
    richiesta_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sposta la richiesta nel cestino - Soft Delete per 90 giorni (solo admin)."""
    await _require_role(db, current_user, ["admin"])

    res = await db.execute(
        select(RichiestaCommerciale).where(
            RichiestaCommerciale.id == richiesta_id,
            RichiestaCommerciale.deleted_at.is_(None),
        )
    )
    richiesta = res.scalar_one_or_none()
    if not richiesta:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")

    richiesta.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return {"message": "Richiesta spostata nel cestino (conservata per 90 giorni)"}


@router.post("/{richiesta_id}/attachments")
async def upload_attachments_richiesta(
    richiesta_id: str,
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload allegati per la richiesta (solo autore o admin)."""
    role = await _require_role(db, current_user, ["commerciale", "admin"])

    res = await db.execute(
        select(RichiestaCommerciale).where(RichiestaCommerciale.id == richiesta_id)
    )
    richiesta = res.scalar_one_or_none()
    if not richiesta:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")

    if role == "commerciale" and str(richiesta.author_id) != str(current_user.id):
        raise HTTPException(status_code=403, detail="Non autorizzato")

    saved_paths = []
    folder = os.path.join(UPLOAD_DIR, richiesta_id)
    os.makedirs(folder, exist_ok=True)

    for file in files:
        ext = os.path.splitext(file.filename or "file")[1]
        filename = f"{uuid.uuid4()}{ext}"
        filepath = os.path.join(folder, filename)
        content = await file.read()
        with open(filepath, "wb") as f:
            f.write(content)
        saved_paths.append(f"/uploads/richieste_commerciali/{richiesta_id}/{filename}")

    current = _parse_attachments(str(richiesta.attachments))
    current.extend(saved_paths)
    richiesta.attachments = json.dumps(current)  # type: ignore
    await db.commit()

    return {"attachments": current}


@router.put("/{richiesta_id}/prendi-in-carico")
async def prendi_in_carico(
    richiesta_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Acquisti prende in carico la richiesta (APERTA → IN_LAVORAZIONE)."""
    role = await _require_role(db, current_user, ["acquisti", "admin"])

    res = await db.execute(
        select(RichiestaCommerciale)
        .options(
            *_richiesta_options(),
        )
        .where(RichiestaCommerciale.id == richiesta_id)
    )
    richiesta = res.scalar_one_or_none()
    if not richiesta:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")

    if richiesta.status != RichiestaStatus.APERTA:
        raise HTTPException(status_code=400, detail="La richiesta non è in stato APERTA")

    richiesta.status = RichiestaStatus.IN_LAVORAZIONE  # type: ignore
    richiesta.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(richiesta)

    return _serialize_richiesta(richiesta, role)


@router.post("/{richiesta_id}/articoli", status_code=status.HTTP_201_CREATED)
async def add_articolo(
    richiesta_id: str,
    data: ArticoloCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Acquisti aggiunge un articolo alla richiesta."""
    role = await _require_role(db, current_user, ["acquisti", "admin"])

    res = await db.execute(
        select(RichiestaCommerciale).where(RichiestaCommerciale.id == richiesta_id)
    )
    richiesta = res.scalar_one_or_none()
    if not richiesta:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")

    if richiesta.status == RichiestaStatus.APERTA:
        raise HTTPException(
            status_code=400,
            detail="La richiesta deve essere presa in carico dall'Ufficio Acquisti prima di poter inserire articoli",
        )

    if role != "admin" and richiesta.status != RichiestaStatus.IN_LAVORAZIONE:
        raise HTTPException(
            status_code=400,
            detail="Puoi aggiungere articoli solo quando la richiesta è IN LAVORAZIONE",
        )

    articolo = ArticoloRichiesta(
        richiesta_id=richiesta_id,
        author_id=current_user.id,
        titolo=data.titolo,
        costo=data.costo,
        descrizione=data.descrizione,
        is_standard=data.is_standard,
        is_atex=data.is_atex,
        is_alimentare=data.is_alimentare,
        tipo_fornitura=data.tipo_fornitura,
        prezzo_listino=data.prezzo_listino if role == "admin" else None,
        note_admin=data.note_admin if role == "admin" else None,
        attachments="[]",
    )
    richiesta.articoli_inserted_by_id = current_user.id
    richiesta.articoli_inserted_at = datetime.now(timezone.utc)
    richiesta.updated_at = datetime.now(timezone.utc)
    db.add(articolo)
    await db.commit()
    await db.refresh(articolo)

    return _serialize_articolo(articolo, role)


@router.put("/{richiesta_id}/articoli/{articolo_id}")
async def update_articolo(
    richiesta_id: str,
    articolo_id: str,
    data: ArticoloUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Acquisti o Admin modifica un articolo."""
    role = await _require_role(db, current_user, ["acquisti", "admin"])

    res_req = await db.execute(
        select(RichiestaCommerciale).where(RichiestaCommerciale.id == richiesta_id)
    )
    richiesta = res_req.scalar_one_or_none()
    if not richiesta:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")

    if richiesta.status == RichiestaStatus.APERTA:
        raise HTTPException(
            status_code=400,
            detail="La richiesta deve essere presa in carico dall'Ufficio Acquisti prima di poter modificare articoli",
        )

    if role != "admin" and richiesta.status != RichiestaStatus.IN_LAVORAZIONE:
        raise HTTPException(
            status_code=400,
            detail="Puoi modificare articoli solo quando la richiesta è IN LAVORAZIONE",
        )

    res = await db.execute(
        select(ArticoloRichiesta).where(
            ArticoloRichiesta.id == articolo_id,
            ArticoloRichiesta.richiesta_id == richiesta_id,
        )
    )
    articolo = res.scalar_one_or_none()
    if not articolo:
        raise HTTPException(status_code=404, detail="Articolo non trovato")

    if data.titolo is not None:
        articolo.titolo = data.titolo  # type: ignore
    if data.costo is not None:
        articolo.costo = data.costo  # type: ignore
    if data.descrizione is not None:
        articolo.descrizione = data.descrizione  # type: ignore
    if data.is_standard is not None:
        articolo.is_standard = data.is_standard  # type: ignore
    if data.is_atex is not None:
        articolo.is_atex = data.is_atex  # type: ignore
    if data.is_alimentare is not None:
        articolo.is_alimentare = data.is_alimentare  # type: ignore
    if "tipo_fornitura" in data.model_fields_set:
        articolo.tipo_fornitura = data.tipo_fornitura  # type: ignore

    # Campi solo admin
    if role == "admin":
        if data.prezzo_listino is not None:
            articolo.prezzo_listino = data.prezzo_listino  # type: ignore
        if data.note_admin is not None:
            articolo.note_admin = data.note_admin  # type: ignore

    await db.commit()
    await db.refresh(articolo)
    return _serialize_articolo(articolo, role)


@router.delete("/{richiesta_id}/articoli/{articolo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_articolo(
    richiesta_id: str,
    articolo_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Acquisti elimina un articolo."""
    role = await _require_role(db, current_user, ["acquisti", "admin"])

    res_req = await db.execute(
        select(RichiestaCommerciale).where(RichiestaCommerciale.id == richiesta_id)
    )
    richiesta = res_req.scalar_one_or_none()
    if not richiesta:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")

    if richiesta.status == RichiestaStatus.APERTA:
        raise HTTPException(
            status_code=400,
            detail="La richiesta deve essere presa in carico dall'Ufficio Acquisti prima di poter eliminare articoli",
        )

    if role != "admin" and richiesta.status != RichiestaStatus.IN_LAVORAZIONE:
        raise HTTPException(
            status_code=400,
            detail="Puoi eliminare articoli solo quando la richiesta è IN LAVORAZIONE",
        )

    res = await db.execute(
        select(ArticoloRichiesta).where(
            ArticoloRichiesta.id == articolo_id,
            ArticoloRichiesta.richiesta_id == richiesta_id,
        )
    )
    articolo = res.scalar_one_or_none()
    if not articolo:
        raise HTTPException(status_code=404, detail="Articolo non trovato")

    await db.delete(articolo)
    await db.commit()


@router.post("/{richiesta_id}/articoli/{articolo_id}/attachments")
async def upload_attachments_articolo(
    richiesta_id: str,
    articolo_id: str,
    files: List[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload allegati per un articolo."""
    role = await _require_role(db, current_user, ["acquisti", "admin"])

    res_req = await db.execute(
        select(RichiestaCommerciale).where(RichiestaCommerciale.id == richiesta_id)
    )
    richiesta = res_req.scalar_one_or_none()
    if not richiesta:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")

    if richiesta.status == RichiestaStatus.APERTA:
        raise HTTPException(
            status_code=400,
            detail="La richiesta deve essere presa in carico dall'Ufficio Acquisti prima di poter caricare allegati",
        )

    if role != "admin" and richiesta.status != RichiestaStatus.IN_LAVORAZIONE:
        raise HTTPException(
            status_code=400,
            detail="Puoi caricare allegati solo quando la richiesta è IN LAVORAZIONE",
        )

    res = await db.execute(
        select(ArticoloRichiesta).where(
            ArticoloRichiesta.id == articolo_id,
            ArticoloRichiesta.richiesta_id == richiesta_id,
        )
    )
    articolo = res.scalar_one_or_none()
    if not articolo:
        raise HTTPException(status_code=404, detail="Articolo non trovato")

    saved_paths = []
    folder = os.path.join(UPLOAD_DIR, richiesta_id, "articoli", articolo_id)
    os.makedirs(folder, exist_ok=True)

    for file in files:
        ext = os.path.splitext(file.filename or "file")[1]
        filename = f"{uuid.uuid4()}{ext}"
        filepath = os.path.join(folder, filename)
        content = await file.read()
        with open(filepath, "wb") as f:
            f.write(content)
        saved_paths.append(
            f"/uploads/richieste_commerciali/{richiesta_id}/articoli/{articolo_id}/{filename}"
        )

    current = _parse_attachments(str(articolo.attachments))
    current.extend(saved_paths)
    articolo.attachments = json.dumps(current)  # type: ignore
    await db.commit()

    return {"attachments": current}


@router.put("/{richiesta_id}/invia-a-admin")
async def invia_a_admin(
    richiesta_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Acquisti invia la richiesta all'admin per il prezzo di listino.
    Salva lo snapshot del testo originale acquisti per il diff.
    (IN_LAVORAZIONE → MANCA_LISTINO)
    """
    await _require_role(db, current_user, ["acquisti", "admin"])

    res = await db.execute(
        select(RichiestaCommerciale)
        .options(
            *_richiesta_options(),
        )
        .where(RichiestaCommerciale.id == richiesta_id)
    )
    richiesta = res.scalar_one_or_none()
    if not richiesta:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")

    if richiesta.status != RichiestaStatus.IN_LAVORAZIONE:
        raise HTTPException(
            status_code=400,
            detail="La richiesta deve essere IN LAVORAZIONE per inviarla all'admin",
        )

    if not richiesta.articoli:
        raise HTTPException(
            status_code=400,
            detail="Aggiungi almeno un articolo prima di inviare all'admin",
        )

    # Salva snapshot testo originale acquisti per ogni articolo
    for articolo in richiesta.articoli:
        snapshot = {
            "titolo": articolo.titolo,
            "descrizione": articolo.descrizione or "",
            "costo": articolo.costo,
        }
        articolo.testo_originale_acquisti = json.dumps(snapshot)  # type: ignore

    richiesta.status = RichiestaStatus.MANCA_LISTINO  # type: ignore
    if not richiesta.articoli_inserted_by_id:
        richiesta.articoli_inserted_by_id = current_user.id
    if not richiesta.articoli_inserted_at:
        richiesta.articoli_inserted_at = datetime.now(timezone.utc)
    richiesta.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(richiesta)

    # Email notifica agli admin
    await _notify_admin_manca_listino(db, richiesta, current_user)

    return _serialize_richiesta(richiesta, "acquisti")


@router.put("/{richiesta_id}/completa")
async def completa_richiesta(
    richiesta_id: str,
    data: CompletaRichiestaIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Admin aggiunge prezzi di listino e completa la richiesta.
    (MANCA_LISTINO → COMPLETATA)
    """
    await _require_role(db, current_user, ["admin"])

    res = await db.execute(
        select(RichiestaCommerciale)
        .options(
            *_richiesta_options(),
        )
        .where(RichiestaCommerciale.id == richiesta_id)
    )
    richiesta = res.scalar_one_or_none()
    if not richiesta:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")

    if richiesta.status != RichiestaStatus.MANCA_LISTINO:
        raise HTTPException(
            status_code=400,
            detail="La richiesta deve essere in stato MANCA LISTINO per completarla",
        )

    # Aggiorna ogni articolo con prezzo listino e eventuali modifiche
    articolo_map = {str(a.id): a for a in richiesta.articoli}
    for item in data.articoli:
        articolo = articolo_map.get(item.id)
        if not articolo:
            continue
        articolo.prezzo_listino = item.prezzo_listino  # type: ignore
        if item.titolo is not None:
            articolo.titolo = item.titolo  # type: ignore
        if item.descrizione is not None:
            articolo.descrizione = item.descrizione  # type: ignore
        if item.note_admin is not None:
            articolo.note_admin = item.note_admin  # type: ignore

    richiesta.status = RichiestaStatus.COMPLETATA  # type: ignore
    richiesta.listino_inserted_by_id = current_user.id  # type: ignore
    richiesta.listino_inserted_at = datetime.now(timezone.utc)  # type: ignore
    await db.commit()
    await db.refresh(richiesta)

    # Email notifica al commerciale
    await _notify_commerciale_completata(db, richiesta, current_user)

    return _serialize_richiesta(richiesta, "admin")


# ─── Funzioni di notifica email ───────────────────────────────────────────────

async def _is_email_enabled(db: AsyncSession) -> bool:
    res = await db.execute(select(Setting).where(Setting.key == "rc_email_enabled"))
    setting = res.scalar_one_or_none()
    if not setting:
        return True  # default: abilitato
    return str(setting.value).lower() != "false"


async def _notify_acquisti_nuova_richiesta(
    db: AsyncSession,
    richiesta: RichiestaCommerciale,
    author: User,
):
    """Notifica l'ufficio acquisti di una nuova richiesta."""
    if not await _is_email_enabled(db):
        return
    try:
        from app.services.email_service import send_richiesta_commerciale_email

        acquisti_usernames = await _get_setting_list(db, "rc_acquisti_users")
        emails = await _get_user_emails_by_usernames(db, acquisti_usernames)
        if emails:
            await send_richiesta_commerciale_email(
                to_addresses=emails,
                richiesta_title=str(richiesta.title),
                cliente=str(richiesta.cliente),
                author_name=str(author.full_name or author.username),
                phase="nuova_richiesta",
            )
    except Exception as e:
        logger.error(f"[RC] Errore notifica acquisti: {e}")


async def _notify_admin_manca_listino(
    db: AsyncSession,
    richiesta: RichiestaCommerciale,
    by_user: User,
):
    """Notifica gli admin che manca il prezzo di listino."""
    if not await _is_email_enabled(db):
        return
    try:
        from app.services.email_service import send_richiesta_commerciale_email

        admin_usernames = await _get_setting_list(db, "rc_admin_users")
        conditions = [User.role == "admin"]
        if admin_usernames:
            conditions.append(User.username.in_(admin_usernames))
        from sqlalchemy import or_
        res = await db.execute(
            select(User).where(or_(*conditions), User.is_active == True)
        )
        users = res.scalars().all()
        emails = [str(u.email) for u in users if u.email]
        if emails:
            await send_richiesta_commerciale_email(
                to_addresses=emails,
                richiesta_title=str(richiesta.title),
                cliente=str(richiesta.cliente),
                author_name=str(by_user.full_name or by_user.username),
                phase="manca_listino",
            )
    except Exception as e:
        logger.error(f"[RC] Errore notifica admin: {e}")


async def _notify_commerciale_completata(
    db: AsyncSession,
    richiesta: RichiestaCommerciale,
    by_user: User,
):
    """Notifica il commerciale che la richiesta è completata."""
    if not await _is_email_enabled(db):
        return
    try:
        from app.services.email_service import send_richiesta_commerciale_email

        # Notifica l'autore della richiesta
        emails = []
        if richiesta.author and richiesta.author.email:
            emails.append(str(richiesta.author.email))
        if emails:
            await send_richiesta_commerciale_email(
                to_addresses=emails,
                richiesta_title=str(richiesta.title),
                cliente=str(richiesta.cliente),
                author_name=str(by_user.full_name or by_user.username),
                phase="completata",
            )
    except Exception as e:
        logger.error(f"[RC] Errore notifica commerciale: {e}")
