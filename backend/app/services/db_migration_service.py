"""
Servizio di migrazione automatica del database.

All'avvio, confronta le colonne definite nei modelli SQLAlchemy con quelle
presenti nel DB e aggiunge automaticamente quelle mancanti.
Questo garantisce che un DB vecchio venga aggiornato senza perdere dati.
"""
import logging
# pyrefly: ignore [missing-import]
from sqlalchemy import inspect, text
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncConnection

logger = logging.getLogger(__name__)


# Mapping dal tipo Python/SQLAlchemy al tipo SQL SQLite
def _sqlalchemy_type_to_sql(col) -> str:
    """Converte un tipo di colonna SQLAlchemy in stringa SQL per SQLite."""
    type_name = type(col.type).__name__.upper()

    # Map dei tipi comuni
    mapping = {
        "INTEGER": "INTEGER",
        "BIGINTEGER": "INTEGER",
        "SMALLINTEGER": "INTEGER",
        "BOOLEAN": "INTEGER",   # SQLite usa INTEGER per BOOLEAN
        "FLOAT": "REAL",
        "NUMERIC": "REAL",
        "DOUBLE": "REAL",
        "STRING": "VARCHAR(255)",
        "VARCHAR": f"VARCHAR({getattr(col.type, 'length', 255)})",
        "CHAR": f"CHAR({getattr(col.type, 'length', 50)})",
        "TEXT": "TEXT",
        "CLOB": "TEXT",
        "DATETIME": "DATETIME",
        "DATE": "DATE",
        "TIME": "TIME",
        "TIMESTAMP": "TIMESTAMP",
        "JSON": "TEXT",
        "UUID": "VARCHAR(36)",
    }

    sql_type = mapping.get(type_name, "TEXT")

    # Gestisci VARCHAR con lunghezza specifica
    if type_name == "VARCHAR" and hasattr(col.type, "length") and col.type.length:
        sql_type = f"VARCHAR({col.type.length})"

    return sql_type


async def run_auto_migration(conn: AsyncConnection) -> None:
    """
    Esegue la migrazione automatica del DB:
    - per ogni tabella definita nei modelli, confronta le colonne presenti nel DB
      con quelle definite nel modello
    - aggiunge le colonne mancanti con ALTER TABLE

    Non rimuove né rinomina colonne (operazione sicura, nessuna perdita di dati).
    """
    from app.models.base import Base

    # Ottieni l'inspector in modo sincrono tramite run_sync
    def _do_inspect_and_migrate(sync_conn):
        inspector = inspect(sync_conn)
        existing_tables = set(inspector.get_table_names())
        migrations_applied = 0

        for table_name, table in Base.metadata.tables.items():
            if table_name not in existing_tables:
                # Tabella nuova: verrà creata da create_all, skip
                continue

            # Ottieni le colonne esistenti nel DB
            existing_cols = {col["name"] for col in inspector.get_columns(table_name)}

            for col in table.columns:
                if col.name in existing_cols:
                    continue  # Colonna già presente, skip

                # Colonna mancante: calcoliamo la definizione SQL
                sql_type = _sqlalchemy_type_to_sql(col)

                # Default
                default_fragment = ""
                if col.default is not None and col.default.is_scalar:
                    val = col.default.arg
                    if isinstance(val, bool):
                        default_fragment = f" DEFAULT {1 if val else 0}"
                    elif isinstance(val, (int, float)):
                        default_fragment = f" DEFAULT {val}"
                    elif isinstance(val, str):
                        safe_val = val.replace("'", "''")
                        default_fragment = f" DEFAULT '{safe_val}'"
                elif col.nullable:
                    default_fragment = " DEFAULT NULL"

                alter_sql = f"ALTER TABLE {table_name} ADD COLUMN {col.name} {sql_type}{default_fragment};"

                try:
                    sync_conn.exec_driver_sql(alter_sql)
                    logger.info(f"[MIGRATION] Aggiunta colonna mancante: {table_name}.{col.name} ({sql_type})")
                    migrations_applied += 1
                except Exception as e:
                    # Se la colonna esiste già (race condition), ignoriamo
                    err_str = str(e).lower()
                    if "duplicate column" in err_str or "already exists" in err_str:
                        logger.debug(f"[MIGRATION] Colonna già presente (skip): {table_name}.{col.name}")
                    else:
                        logger.error(f"[MIGRATION] Errore aggiunta {table_name}.{col.name}: {e}")

        if migrations_applied > 0:
            logger.info(f"[MIGRATION] Completata: {migrations_applied} colonne aggiunte al DB")
        else:
            logger.info("[MIGRATION] DB aggiornato, nessuna migrazione necessaria")

    await conn.run_sync(_do_inspect_and_migrate)
