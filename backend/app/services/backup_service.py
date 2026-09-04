import os
import shutil
import zipfile
import tempfile
import threading
from datetime import datetime, timezone
import logging

from app.core.config import BACKEND_DIR

logger = logging.getLogger(__name__)

BACKUP_DIR = os.path.join(BACKEND_DIR, "backups")
# Backup giornaliero alle 20: mantiene le ultime due settimane (14 giorni)
MAX_BACKUPS = 14

_restore_lock = threading.Lock()

def run_backup():
    """Esegue il backup del database e della cartella uploads."""
    logger.info("Avvio del backup giornaliero...")
    os.makedirs(BACKUP_DIR, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_filename = f"backup_{timestamp}.zip"
    backup_path = os.path.join(BACKUP_DIR, backup_filename)
    
    db_path = os.path.join(BACKEND_DIR, "ganttflow.db")
    uploads_dir = os.path.join(BACKEND_DIR, "uploads")
    
    try:
        with zipfile.ZipFile(backup_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            if os.path.exists(db_path):
                zipf.write(db_path, "ganttflow.db")
            
            if os.path.exists(uploads_dir):
                for root, _, files in os.walk(uploads_dir):
                    for file in files:
                        file_path = os.path.join(root, file)
                        arcname = os.path.relpath(file_path, BACKEND_DIR)
                        zipf.write(file_path, arcname)
                        
        logger.info(f"Backup completato: {backup_filename}")
        _cleanup_old_backups()
        return True, backup_path
    except Exception as e:
        logger.error(f"Errore durante il backup: {e}")
        if os.path.exists(backup_path):
            os.remove(backup_path)
        return False, str(e)

def _cleanup_old_backups():
    """Mantiene solo gli ultimi MAX_BACKUPS file di backup."""
    if not os.path.exists(BACKUP_DIR):
        return
        
    backups = []
    for f in os.listdir(BACKUP_DIR):
        if f.startswith("backup_") and f.endswith(".zip"):
            path = os.path.join(BACKUP_DIR, f)
            backups.append((path, os.path.getctime(path)))
            
    # Ordina dal più recente al più vecchio
    backups.sort(key=lambda x: x[1], reverse=True)
    
    # Rimuove i più vecchi
    for old_backup in backups[MAX_BACKUPS:]:
        try:
            os.remove(old_backup[0])
            logger.info(f"Rimosso vecchio backup: {old_backup[0]}")
        except Exception as e:
            logger.error(f"Errore rimozione vecchio backup {old_backup[0]}: {e}")

def get_last_backup_info():
    """Restituisce informazioni sull'ultimo backup effettuato."""
    if not os.path.exists(BACKUP_DIR):
        return None
        
    backups = []
    for f in os.listdir(BACKUP_DIR):
        if f.startswith("backup_") and f.endswith(".zip"):
            path = os.path.join(BACKUP_DIR, f)
            backups.append(path)
            
    if not backups:
        return None
        
    latest_backup = max(backups, key=os.path.getctime)
    ctime = os.path.getctime(latest_backup)
    
    # Ritorna come stringa ISO 8601
    dt = datetime.fromtimestamp(ctime, timezone.utc)
    return {
        "filename": os.path.basename(latest_backup),
        "date": dt.isoformat(),
        "size_mb": round(os.path.getsize(latest_backup) / (1024 * 1024), 2)
    }


def list_backups():
    """Restituisce l'elenco dei backup disponibili (dal più recente al più vecchio)."""
    if not os.path.exists(BACKUP_DIR):
        return []

    backups = []
    for f in os.listdir(BACKUP_DIR):
        if f.startswith("backup_") and f.endswith(".zip"):
            path = os.path.join(BACKUP_DIR, f)
            ctime = os.path.getctime(path)
            backups.append({
                "filename": f,
                "date": datetime.fromtimestamp(ctime, timezone.utc).isoformat(),
                "size_mb": round(os.path.getsize(path) / (1024 * 1024), 2),
            })

    backups.sort(key=lambda x: x["date"], reverse=True)
    return backups


def validate_backup_zip(zip_path):
    """Verifica che l'archivio sia un backup HiPlan valido (contiene ganttflow.db)."""
    try:
        with zipfile.ZipFile(zip_path) as zipf:
            has_db = any(
                os.path.basename(n.replace('\\', '/')) == 'ganttflow.db'
                for n in zipf.namelist()
            )
            if not has_db:
                return False, "L'archivio non contiene il database (ganttflow.db)"
    except Exception as e:
        return False, f"Archivio non valido o corrotto: {e}"
    return True, None


async def restore_backup_from_zip(zip_path):
    """Ripristina il database e gli allegati a partire da un archivio di backup.

    Accetta direttamente lo zip generato dal backup automatico (struttura
    ganttflow.db + cartella uploads), gestendo in modo robusto anche layout
    diversi (separatori di percorso Windows, percorsi annidati, ecc.).
    """
    if not os.path.exists(zip_path):
        return False, "File di backup non trovato"

    ok, err = validate_backup_zip(zip_path)
    if not ok:
        return False, err

    with _restore_lock:
        # Chiude tutte le connessioni attive al database prima di sostituirlo
        try:
            from app.models.base import engine
            await engine.dispose()
        except Exception as e:
            logger.warning(f"Impossibile chiudere le connessioni al DB prima del ripristino: {e}")

        try:
            with tempfile.TemporaryDirectory() as tmp:
                with zipfile.ZipFile(zip_path) as zipf:
                    # Normalizza i separatori (es. backslash di Windows) per rendere
                    # il ripristino robusto anche tra sistemi operativi diversi
                    for member in zipf.infolist():
                        member.filename = member.filename.replace('\\', '/')
                        zipf.extract(member, tmp)

                # Ripristino del database: ricerca ricorsiva (nome file ovunque nello zip)
                db_candidates = []
                for root, _, files in os.walk(tmp):
                    for f in files:
                        if f == 'ganttflow.db':
                            db_candidates.append(os.path.join(root, f))
                if not db_candidates:
                    return False, "Il backup non contiene ganttflow.db"
                shutil.copy2(db_candidates[0], os.path.join(BACKEND_DIR, "ganttflow.db"))

                # Ripristino della cartella uploads: ricerca ricorsiva della directory "uploads"
                uploads_src = None
                for root, dirs, _ in os.walk(tmp):
                    if os.path.basename(root.rstrip('/\\')) == 'uploads':
                        uploads_src = root
                        break
                if uploads_src:
                    dst_uploads = os.path.join(BACKEND_DIR, "uploads")
                    if os.path.exists(dst_uploads):
                        shutil.rmtree(dst_uploads)
                    shutil.copytree(uploads_src, dst_uploads)

            logger.info(f"Ripristino completato dal backup: {os.path.basename(zip_path)}")
            return True, "Ripristino completato con successo"
        except Exception as e:
            logger.error(f"Errore durante il ripristino: {e}")
            return False, f"Errore durante il ripristino: {e}"
