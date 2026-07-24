import os
import shutil
import zipfile
from datetime import datetime, timezone
import logging

from app.core.config import BACKEND_DIR

logger = logging.getLogger(__name__)

BACKUP_DIR = os.path.join(BACKEND_DIR, "backups")
MAX_BACKUPS = 4

def run_backup():
    """Esegue il backup del database e della cartella uploads."""
    logger.info("Avvio del backup settimanale...")
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
