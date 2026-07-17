from pydantic_settings import BaseSettings
from typing import List
import json
import os

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_DB_PATH = os.path.join(BACKEND_DIR, "ganttflow.db").replace("\\", "/")


class Settings(BaseSettings):
    DATABASE_URL: str = f"sqlite+aiosqlite:///{DEFAULT_DB_PATH}"
    SECRET_KEY: str = "dev-secret-key-not-for-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    CORS_ORIGINS: str = '["http://localhost:5173"]'
    APP_NAME: str = "HiPlan"
    DEBUG: bool = True

    @property
    def cors_origins_list(self) -> List[str]:
        return json.loads(self.CORS_ORIGINS)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

# Risolvi sempre il percorso SQLite come assoluto nella cartella backend/
# per evitare che su Windows o avviando da cartelle diverse il DB venga creato altrove o non trovato
if settings.DATABASE_URL.startswith("sqlite+aiosqlite:///"):
    path_part = settings.DATABASE_URL.split(":///", 1)[1]
    if path_part.startswith("./") or (not path_part.startswith("/") and not (len(path_part) > 1 and path_part[1] == ":")):
        clean_rel = path_part[2:] if path_part.startswith("./") else path_part
        abs_db_path = os.path.abspath(os.path.join(BACKEND_DIR, clean_rel))
        if os.name == "nt" or (len(abs_db_path) > 1 and abs_db_path[1] == ":"):
            settings.DATABASE_URL = f"sqlite+aiosqlite:///{abs_db_path.replace(os.sep, '/')}"
        else:
            settings.DATABASE_URL = f"sqlite+aiosqlite:///{abs_db_path}"
