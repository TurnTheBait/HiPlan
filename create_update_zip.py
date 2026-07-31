import os
import zipfile

ZIP_NAME = 'hiplan_update.zip'

EXCLUDE_DIRS = {
    'backend/venv',
    'backend/__pycache__',
    'frontend/node_modules',
    '.git',
    'logs'
}

def should_exclude(root, name, is_dir):
    rel_path = os.path.relpath(os.path.join(root, name), '.')
    rel_path = rel_path.replace('\\', '/')
    
    if is_dir:
        for ex in EXCLUDE_DIRS:
            if rel_path == ex or rel_path.startswith(ex + '/'):
                return True
    else:
        # Match exact file names we want to exclude everywhere
        if name == 'gantt.db' or name == '.env' or name == '.DS_Store' or name == ZIP_NAME:
            return True
        if name.endswith('.pyc'):
            return True
            
    return False

def create_zip():
    if os.path.exists(ZIP_NAME):
        os.remove(ZIP_NAME)
        
    print(f"Preparazione del pacchetto: {ZIP_NAME} ...")
    
    # Check if we are in the right folder (check for backend and frontend dirs)
    if not os.path.exists('backend') or not os.path.exists('frontend'):
        print("Errore: Esegui lo script dalla cartella principale del progetto.")
        return

    count = 0
    with zipfile.ZipFile(ZIP_NAME, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk('.'):
            # filter dirs in place to avoid traversing them
            dirs[:] = [d for d in dirs if not should_exclude(root, d, True)]
            
            for f in files:
                if not should_exclude(root, f, False):
                    file_path = os.path.join(root, f)
                    arcname = os.path.relpath(file_path, '.')
                    zf.write(file_path, arcname)
                    count += 1
                    
    print(f"Fatto! Il file {ZIP_NAME} e' stato creato correttamente con {count} file.")
    print("Puoi caricarlo sul server, estrarlo per aggiornare i file e poi lanciare update_windows.bat.")

if __name__ == '__main__':
    create_zip()
