import os
import re
# pyrefly: ignore [missing-import]
from sqlalchemy import create_engine
# pyrefly: ignore [missing-import]
from langchain_community.utilities import SQLDatabase
# pyrefly: ignore [missing-import]
from langchain_community.agent_toolkits import create_sql_agent, SQLDatabaseToolkit
# pyrefly: ignore [missing-import]
from langchain_groq import ChatGroq
from app.core.config import settings

def get_sync_db_url(async_url: str) -> str:
    """
    Converts the async SQLAlchemy URL to a sync URL for Langchain SQLDatabase.
    e.g. sqlite+aiosqlite:///./ganttflow.db -> sqlite:///./ganttflow.db
    """
    if async_url.startswith("sqlite+aiosqlite:///"):
        return async_url.replace("sqlite+aiosqlite:///", "sqlite:///")
    if async_url.startswith("postgresql+asyncpg://"):
        return async_url.replace("postgresql+asyncpg://", "postgresql://")
    return async_url

class ChatService:
    def __init__(self):
        self.sync_db_url = get_sync_db_url(settings.DATABASE_URL)
        self.engine = create_engine(self.sync_db_url)
        self.db = SQLDatabase(self.engine)
        
        # Inizializza il modello Groq (Llama 3)
        if not settings.GROQ_API_KEY:
            self.llm = None
        else:
            self.llm = ChatGroq(
                model="openai/gpt-oss-120b", 
                groq_api_key=settings.GROQ_API_KEY,
                temperature=0
            )

    async def get_response(self, user_message: str) -> str:
        if not self.llm:
            return "Errore: Chiave API Groq non configurata nel backend."

        try:
            toolkit = SQLDatabaseToolkit(db=self.db, llm=self.llm)
            agent_executor = create_sql_agent(
                llm=self.llm,
                toolkit=toolkit,
                verbose=True,
                agent_type="openai-tools"
            )
            
            # Prompts personalizzati potrebbero essere aggiunti qui
            prefix = (
                "Sei un assistente AI per l'applicazione HiPlan, un software aziendale di project management. "
                "Il tuo compito è aiutare un addetto aziendale (che utilizza il software) rispondendo alle sue domande "
                "recuperando le informazioni dal database. "
                "Le tabelle principali includono users, projects, tasks, tickets, ecc. "
                "ATTENZIONE: Esegui ESCLUSIVAMENTE query di tipo SELECT. Non modificare o cancellare MAI i dati. "
                "Rispondi in italiano in modo chiaro, utile e professionale."
            )
            
            full_prompt = f"{prefix}\n\nDomanda utente: {user_message}"
            
            response = agent_executor.invoke({"input": full_prompt})
            
            output = response.get("output", "Non sono riuscito a trovare una risposta.")
            
            # Pulizia per evitare che scriva Final Answer nella chat (retaggio del ReAct loop)
            output = output.replace("**Final Answer:**", "").replace("Final Answer:", "").strip()
            
            return output
            
        except Exception as e:
            error_msg = str(e)
            if "Could not parse LLM output: `" in error_msg:
                return error_msg.split("Could not parse LLM output: `")[1].rsplit("`", 1)[0]
            elif "Could not parse LLM output: '" in error_msg:
                return error_msg.split("Could not parse LLM output: '")[1].rsplit("'", 1)[0]
            
            return f"Si è verificato un errore durante l'elaborazione della tua richiesta: {error_msg}"

chat_service = ChatService()
