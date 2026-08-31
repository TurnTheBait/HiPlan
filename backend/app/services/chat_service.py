import os
import re
# pyrefly: ignore [missing-import]
from sqlalchemy import create_engine
# pyrefly: ignore [missing-import]
from langchain_community.utilities import SQLDatabase
# pyrefly: ignore [missing-import]
from langchain_groq import ChatGroq
# pyrefly: ignore [missing-import]
from langchain.chains import create_sql_query_chain
# pyrefly: ignore [missing-import]
from langchain_community.tools.sql_database.tool import QuerySQLDataBaseTool
# pyrefly: ignore [missing-import]
from langchain_core.prompts import PromptTemplate
# pyrefly: ignore [missing-import]
from langchain_core.output_parsers import StrOutputParser
# pyrefly: ignore [missing-import]
from langchain_core.runnables import RunnablePassthrough
from operator import itemgetter
from app.core.config import settings

def get_sync_db_url(async_url: str) -> str:
    if async_url.startswith("sqlite+aiosqlite:///"):
        return async_url.replace("sqlite+aiosqlite:///", "sqlite:///")
    if async_url.startswith("postgresql+asyncpg://"):
        return async_url.replace("postgresql+asyncpg://", "postgresql://")
    return async_url

class ChatService:
    def __init__(self):
        self.sync_db_url = get_sync_db_url(settings.DATABASE_URL)
        self.engine = create_engine(self.sync_db_url)
        self._db = None
        
        if not settings.GROQ_API_KEY:
            self.llm = None
        else:
            self.llm = ChatGroq(
                model="openai/gpt-oss-120b", 
                groq_api_key=settings.GROQ_API_KEY,
                temperature=0
            )

    @property
    def db(self):
        if self._db is None:
            # pyrefly: ignore [missing-import]
            from sqlalchemy import inspect
            inspector = inspect(self.engine)
            existing_tables = set(inspector.get_table_names())
            
            to_ignore = ["activity_logs", "agent_logs", "email_logs", "replan_logs", "planning_runs"]
            ignore_existing = [t for t in to_ignore if t in existing_tables]

            self._db = SQLDatabase(
                self.engine, 
                sample_rows_in_table_info=0,
                ignore_tables=ignore_existing
            )
        return self._db

    async def get_response(self, user_message: str) -> str:
        if not self.llm:
            return "Errore: Chiave API Groq non configurata nel backend."

        try:
            # Crea la catena per generare la query SQL
            generate_query = create_sql_query_chain(self.llm, self.db)
            
            # Crea lo strumento per eseguire la query
            execute_query = QuerySQLDataBaseTool(db=self.db)
            
            # Prompt finale per formulare la risposta in linguaggio naturale
            answer_prompt = PromptTemplate.from_template(
                "Dati i seguenti risultati estratti dal database, rispondi alla domanda dell'utente in italiano in modo chiaro e professionale.\n"
                "Se i risultati sono vuoti, di' che non hai trovato informazioni a riguardo.\n"
                "IMPORTANTE: L'utente finale è un addetto aziendale non tecnico. "
                "NON mostrare MAI dettagli tecnici come ID, UUID, chiavi del database, nomi di colonne grezze o flag di sistema (es. is_active=1). "
                "Formatta le date in modo naturale e ometti informazioni inutili per un utente normale.\n\n"
                "Domanda: {question}\n"
                "Query SQL eseguita: {query}\n"
                "Risultato SQL: {result}\n\n"
                "Risposta finale:"
            )
            
            # Catena completa: Genera -> Esegui -> Rispondi
            chain = (
                RunnablePassthrough.assign(query=generate_query).assign(
                    result=itemgetter("query") | execute_query
                )
                | answer_prompt
                | self.llm
                | StrOutputParser()
            )
            
            response = chain.invoke({"question": user_message})
            return response.strip()
            
        except Exception as e:
            error_msg = str(e)
            return f"Si è verificato un errore durante l'elaborazione della tua richiesta: {error_msg}"

chat_service = ChatService()
