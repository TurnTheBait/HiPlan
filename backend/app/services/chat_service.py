import os
import re
from datetime import date
# pyrefly: ignore [missing-import]
from sqlalchemy import create_engine, select
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
from langchain_core.runnables import RunnablePassthrough, RunnableLambda
from operator import itemgetter
from app.core.config import settings

import logging

logger = logging.getLogger(__name__)

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
            
            to_ignore = ["activity_logs", "agent_logs", "email_logs", "replan_logs", "planning_runs", "notes", "todos", "calendar_events"]
            ignore_existing = [t for t in to_ignore if t in existing_tables]

            self._db = SQLDatabase(
                self.engine, 
                sample_rows_in_table_info=0,
                ignore_tables=ignore_existing
            )
        return self._db

    async def get_response(self, user_message: str, current_user=None) -> str:
        if not self.llm:
            return "Errore: Chiave API Groq non configurata nel backend."

        try:
            # Crea la catena per generare la query SQL (k=100 per non troncare i risultati a 5)
            generate_query = create_sql_query_chain(self.llm, self.db, k=100)
            
            def clean_sql(query_str: str) -> str:
                # Estrae solo il codice SQL evitando testo allucinato o prefissi (es. "SQL Query:", "SQLQuery:")
                q = query_str.strip()
                if "```sql" in q:
                    q = q.split("```sql")[1].split("```")[0]
                elif "```" in q:
                    q = q.split("```")[1].split("```")[0]
                
                # Cerca la query SELECT tramite regex per isolarla da qualsiasi testo introduttivo
                match = re.search(r'(SELECT\b.+)', q, re.IGNORECASE | re.DOTALL)
                if match:
                    q = match.group(1)
                    if ";" in q:
                        q = q.split(";")[0]
                
                cleaned = q.strip()
                logger.info(f"Query SQL generata dal chatbot: {cleaned}")
                return cleaned
            
            clean_sql_runnable = RunnableLambda(clean_sql)
            
            # Crea lo strumento per eseguire la query
            raw_execute_query = QuerySQLDataBaseTool(db=self.db)
            def execute_and_log(sql_query: str) -> str:
                try:
                    res = raw_execute_query.invoke(sql_query)
                    logger.info(f"Risultato SQL eseguito: {res}")
                    return str(res)
                except Exception as ex:
                    logger.error(f"Errore durante l'esecuzione SQL '{sql_query}': {ex}")
                    return f"Errore SQL: {ex}"

            execute_query_runnable = RunnableLambda(execute_and_log)
            
            # Prompt finale per formulare la risposta in linguaggio naturale
            answer_prompt = PromptTemplate.from_template(
                "Dati i seguenti risultati estratti dal database e il contesto fornito, rispondi alla domanda dell'utente in italiano in modo chiaro, pratico e professionale.\n"
                "Se nel contesto della domanda sono elencate 'SEGNALAZIONI ATTIVE DI SISTEMA', utilizzale prioritariamente per rispondere a domande su sovraccarichi, conflitti, ferie, ritardi o mancate consuntivazioni.\n"
                "Se l'utente chiede consigli o proposte di RIPROGRAMMAZIONE/RISOLUZIONE di fasi o sovraccarichi:\n"
                "  * DIVIETO ASSOLUTO DI INVENTARE NOMI FITTIZI (es. Marco Rossi, Mario, Lucia). Fai riferimento SOLO ed ESCLUSIVAMENTE agli addetti reali registrati nel sistema.\n"
                "  * DIVIETO DI LINGUAGGIO DA DATABASE: non dire MAI 'aggiorna la colonna workers' o 'modifica il campo'. Parla in modo operativo: 'Assegna la fase anche all'addetto X', 'Modifica la durata della fase', ecc.\n"
                "  * DISPONIBILITÀ ESATTA: indica con precisione le date di calendario (es. 'dal 7 all'11 settembre') in cui l'addetto è effettivamente libero (0 ore o ore parziali e nessuna ferie) per recuperare o svolgere le ore necessarie.\n"
                "  * Rispetta i vincoli di inizio/fine della commessa padre e verifica che gli slot proposti siano realmente liberi da ferie e sotto le 8h/giorno.\n"
                "  * NESSUN CONSIGLIO GENERALISTA: Se non ci sono problemi o non hai risultati utili, non inventare 'azioni consigliate' generiche (es. 'monitorare la situazione').\n"
                "Se la ricerca non ha prodotto risultati (es. liste vuote o nessun record) indicalo chiaramente e semplicemente, dicendo che non ci sono dati corrispondenti.\n"
                "IMPORTANTE: L'utente finale è un addetto aziendale non tecnico. "
                "NON usare MAI parole come 'query', 'sql', 'database' o 'esecuzione SQL'. "
                "NON menzionare MAI nomi di campi tecnici (come id, is_active, workers, status ecc.) né ID numerici o UUID. "
                "Traduci tutto in linguaggio umano (es. al posto di is_active usa 'attivo', al posto di id usa il nome della commessa/persona). "
                "Formatta le date in modo naturale e ometti informazioni inutili per un utente normale.\n"
                "REGOLA FONDAMENTALE STILISTICA E FORMATTAZIONE: Vai dritto al punto! NON usare MAI saluti (es. Buongiorno, Ciao) all'inizio, e NON usare MAI formule di chiusura (es. Resto a disposizione, Cordiali saluti, ecc.). Inizia direttamente con i fatti. Usa Markdown pulito, lineare e compatto: elenchi puntati/numerati chiari con grassetti per nomi di commesse, fasi, addetti e date, senza interlinee o spaziature disordinate.\n\n"
                "Domanda: {question}\n"
                "Dati grezzi estratti (da non menzionare mai come 'query' o 'risultato SQL'): {result}\n\n"
                "Risposta finale:"
            )
            
            # Catena completa: Genera -> Esegui -> Rispondi
            chain = (
                RunnablePassthrough.assign(query=generate_query | clean_sql_runnable).assign(
                    result=itemgetter("query") | execute_query_runnable
                )
                | answer_prompt
                | self.llm
                | StrOutputParser()
            )
            
            today_str = date.today().strftime('%d/%m/%Y (%Y-%m-%d)')
            
            # Recupera in tempo reale le segnalazioni avanzate di replanning e l'elenco degli addetti reali
            suggestions_text = ""
            users_list_str = ""
            try:
                from app.models.base import AsyncSessionLocal
                from app.models.user import User
                from app.services.replanning_service import get_replanning_suggestions
                async with AsyncSessionLocal() as session:
                    # 1. Suggerimenti
                    suggestions = await get_replanning_suggestions(session, current_user)
                    if suggestions:
                        lines = []
                        for s in suggestions[:30]:
                            s_type = s.get("type", "")
                            reason = s.get("reason", "")
                            p_name = s.get("project_name", "")
                            t_name = s.get("task_name", "")
                            w = s.get("worker", "")
                            d = s.get("date", "")
                            lines.append(f"- [{s_type}] {reason} (Commessa: {p_name}, Fase: {t_name}, Data: {d}, Addetto: {w})")
                        suggestions_text = "\nSEGNALAZIONI ATTIVE DI SISTEMA (SOVRACCARICHI, CONFLITTI, RITARDI, MANCATE CONSUNTIVAZIONI):\n" + "\n".join(lines) + "\n"
                    
                    # 2. Utenti reali
                    users_res = await session.execute(select(User).where(User.is_active == True))
                    real_users = users_res.scalars().all()
                    if real_users:
                        u_entries = [f"{u.full_name or u.username} (username: {u.username}, reparto: {u.department or 'generale'})" for u in real_users]
                        users_list_str = "\nADDETTI REALI DEL SISTEMA (Usa SOLO questi nomi, non inventare colleghi fittizi):\n- " + "\n- ".join(u_entries) + "\n"
            except Exception as e_sugg:
                logger.warning(f"Impossibile recuperare i suggerimenti/utenti per la chat: {e_sugg}")

            user_info = ""
            if current_user:
                user_role = getattr(current_user.role, 'value', current_user.role) if hasattr(current_user, 'role') else ''
                user_info = f"L'utente che interroga il db ha ID '{current_user.id}' e ruolo '{user_role}'. "

            domain_context = (
                "Contesto aziendale e regole database (SQLite):\n"
                f"- Data odierna del sistema: {today_str}\n"
                f"{users_list_str}"
                "- TABELLA 'projects' (Commesse / Progetti):\n"
                "  * Nome / Titolo commessa: colonna 'name'\n"
                "  * Codice commessa: colonna 'code'\n"
                "  * Cliente: colonna 'client'\n"
                "  * Stato: colonna 'status' ('planning', 'active', 'completed', 'archived')\n"
                "  * Date: 'start_date', 'end_date'\n"
                "  * Responsabile: 'responsible_id' (collegato a users.id)\n"
                "  * Addetti commessa: colonna 'assigned_workers' (lista JSON di nomi)\n"
                "  * Descrizione e note: 'description', 'notes'\n"
                "- TABELLA 'tasks' (Fasi / Compiti delle Commesse):\n"
                "  * Nome fase: colonna 'text'\n"
                "  * Commessa di appartenenza: 'project_id' (collegato a projects.id)\n"
                "  * Date: 'start_date', 'end_date', 'duration'\n"
                "  * Ore pianificate: 'planned_hours'\n"
                "  * Addetti assegnati alla fase: 'workers' (lista JSON di nomi/utenti) e 'worker_hours' (dict JSON {nome: ore})\n"
                "  * Stato/Avanzamento: 'progress' (0.0 - 1.0), 'completed' (1=completato, 0=in corso)\n"
                "  * Reparto: 'department'\n"
                "- TABELLA 'phase_templates' (Fasi Preimpostate / Modelli di Fase / Fasi Predefinite / Fasi Creabili):\n"
                "  * Contiene tutte le fasi di lavoro predefinite/preimpostate che gli utenti possono creare o inserire nelle commesse.\n"
                "  * Nome della fase preimpostata: colonna 'name'\n"
                "  * Reparto di appartenenza: colonna 'department' (ufficio_tecnico, produzione, acquisti, condivisa)\n"
                "  * Giorni predefiniti / Ore predefinite: 'default_days', 'default_hours'\n"
                "  * Colore predefinito: 'default_color'\n"
                "- TABELLA 'users' (Utenti / Dipendenti / Addetti):\n"
                "  * Username: 'username', Nome completo: 'full_name', Email: 'email', Ruolo: 'role' (admin, editor, viewer), Reparto: 'department', Attivo: 'is_active'\n"
                "- TABELLA 'vacations' (Ferie / Assenze / Permessi):\n"
                "  * Utente: 'user_id' (collegato a users.id), Inizio/Fine: 'start_date', 'end_date', Motivo: 'reason'\n"
                "- TABELLA 'tickets' (Ticket di assistenza / Segnalazioni):\n"
                "  * Titolo: 'title', Descrizione: 'description', Commessa collegata: 'project_id', Creatore: 'author_id', Responsabile: 'responsible_id', Assegnati: 'assigned_to' (lista JSON di username), Stato: 'status' ('Da gestire', 'In attesa del cliente', 'Completato'), Priorità: 'priority' ('low', 'medium', 'high')\n"
                "- TABELLA 'ticket_replies' (Risposte / Conversazioni nei Ticket):\n"
                "  * Ticket: 'ticket_id', Autore: 'user_id', Messaggio: 'message', Data: 'created_at'\n"
                "- TABELLA 'task_comments' (Commenti sulle Fasi):\n"
                "  * Fase: 'task_id', Autore: 'author_id', Testo: 'content', Data: 'created_at'\n"
                "- TABELLA 'task_checklist_items' (Checklist / Sotto-attività delle Fasi):\n"
                "  * Fase: 'task_id', Descrizione: 'text', Completato: 'is_completed' (1=fatto, 0=in corso)\n"
                "- TABELLA 'project_members' (Membri assegnati al Team di una Commessa):\n"
                "  * Commessa: 'project_id', Utente: 'user_id', Ruolo nel progetto: 'role' (manager, member, viewer)\n"
                "- TABELLA 'links' (Dipendenze e collegamenti Gantt tra fasi):\n"
                "  * Commessa: 'project_id', Fase origine: 'source' (task_id), Fase destinazione: 'target' (task_id), Tipo: 'type'\n"
                "- REGOLA DI RICERCA FLESSIBILE (MOLTO IMPORTANTE):\n"
                "  * Quando l'utente chiede 'fasi preimpostate', 'fasi predefinite', 'modelli di fase', o 'possibili fasi che si possono creare', INTERROGA LA TABELLA 'phase_templates'!\n"
                "  * Quando cerchi una commessa, progetto, utente o fase per nome/codice (es. 'commessa1', 'commessa 1', 'COMM1', 'elena'), usa SEMPRE `LIKE '%...%' COLLATE NOCASE` o `LOWER(...) LIKE '%...'` e cerca sia in 'name' che in 'code' (es. `WHERE name LIKE '%1%' OR code LIKE '%1%' OR name LIKE '%commessa%' COLLATE NOCASE`). Mai usare uguaglianze rigide '=' che falliscono se ci sono spazi o maiuscole diverse.\n"
                "  * Quando l'utente chiede una 'panoramica' o dettagli di una commessa, estrai i dati della commessa da 'projects' E le relative fasi da 'tasks' (facendo JOIN o query correlata su tasks.project_id = projects.id) per mostrare anche le fasi, le date e gli addetti.\n"
                "- REGOLE DI RIPROGRAMMAZIONE (REPLANNING & AIUTO DECISIONALE):\n"
                "  * Quando ti viene chiesto aiuto per riprogrammare o risolvere conflitti/sovraccarichi, valuta le fasi di tutte le commesse e i carichi di lavoro.\n"
                "  * MAI USARE NOMI DI PERSONE INVENTATI: usa SOLO i colleghi reali indicati nella lista ADDETTI REALI DEL SISTEMA.\n"
                "  * MAI USARE TERMINI DA DATABASE ('aggiorna la colonna workers'): usa indicazioni operative e colloquiali comprensibili da personale d'ufficio.\n"
                "  * INDICA I GIORNI ESATTI DI DISPONIBILITÀ: calcola e indica con chiarezza i giorni specifici di calendario in cui l'addetto (o il collega sostituto) è libero (senza ferie e senza altre fasi concomitanti che superino le 8h/giorno).\n"
                "  * PRESTA MASSIMA ATTENZIONE alle date di inizio e fine della Commessa ('start_date' ed 'end_date' di 'projects'): le fasi riprogrammate devono restare all'interno della durata della commessa, oppure segnala chiaramente che la scadenza della commessa andrà posticipata.\n"
                "- Conflitto: ferie e ore assegnate nello stesso giorno, OPPURE più fasi con totale ore > 8h in un giorno lavorativo.\n"
                "- Sovraccarico: quando un utente ha pianificate (in una o più fasi) più di 8h in un giorno lavorativo.\n"
                "- Mancata consuntivazione: quando un utente aveva ore pianificate in un giorno passato ma non risultano consuntivate/registrate.\n"
                "- Ritardo (Delay): quando la data di fine (end_date) di un task o progetto è minore di oggi e non è completato (completed=0).\n"
                "- Dati mancanti: fai notare se mancano campi essenziali (NULL) o valori necessari a un calcolo.\n"
                f"{suggestions_text}"
                "REGOLE DI SICUREZZA E PRIVACY DATI (CRITICO E INVALICABILE):\n"
                "- Le note dell'applicazione contengono dati personali e sensibili: sono TOTALMENTE ESCLUSE e NON ACCESSIBILI dal chatbot. Se l'utente chiede informazioni su note o appunti personali, spiega cortesemente che per motivi di riservatezza e privacy le note non sono consultabili tramite l'assistente virtuale.\n\n"
                f"Domanda dell'utente: {user_message}"
            )
            
            response = chain.invoke({"question": domain_context})
            return response.strip()
            
        except Exception as e:
            logger.error(f"Errore nel chatbot durante l'elaborazione del messaggio '{user_message}': {e}", exc_info=True)
            error_msg = str(e)
            return f"Si è verificato un errore durante l'elaborazione della tua richiesta: {error_msg}"

chat_service = ChatService()
