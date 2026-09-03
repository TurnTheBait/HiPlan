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
        
        primary_llm = None
        if settings.GROQ_API_KEY:
            primary_llm = ChatGroq(
                model="openai/gpt-oss-120b", 
                groq_api_key=settings.GROQ_API_KEY,
                temperature=0
            )

        fallbacks: list = []
        if settings.GEMINI_API_KEY:
            # pyrefly: ignore [missing-import]
            from langchain_google_genai import ChatGoogleGenerativeAI
            fallbacks.append(ChatGoogleGenerativeAI(
                model="gemini-3.6-flash",
                google_api_key=settings.GEMINI_API_KEY,
                temperature=0,
                max_retries=1
            ))
            
        if settings.COHERE_API_KEY:
            # pyrefly: ignore [missing-import]
            from langchain_cohere import ChatCohere
            fallbacks.append(ChatCohere(
                model="command-r-plus",
                cohere_api_key=settings.COHERE_API_KEY,
                temperature=0
            ))
            
        if primary_llm and fallbacks:
            self.llm = primary_llm.with_fallbacks(fallbacks)
        elif primary_llm:
            self.llm = primary_llm
        elif fallbacks:
            self.llm = fallbacks[0].with_fallbacks(fallbacks[1:]) if len(fallbacks) > 1 else fallbacks[0]
        else:
            self.llm = None

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

    def _classify_intent(self, user_message: str) -> str:
        m = user_message.strip().lower()
        
        # 1. Chat generica / Saluti / Aiuto / Ringraziamenti
        greetings = ["ciao", "salve", "buongiorno", "buonasera", "buondi", "buondì", "hey", "hello", "buon pomeriggio"]
        if m in greetings or (any(m.startswith(g) for g in greetings) and len(m.split()) <= 4):
            return "chat"
        if any(k in m for k in ["chi sei", "cosa puoi fare", "cosa sai fare", "come ti chiami", "come funzioni", "come puoi aiutarmi", "istruzioni"]):
            return "chat"
        if m in ["grazie", "grazie mille", "ok grazie", "perfetto", "ottimo", "grazie!", "ricevuto", "chiudi", "basta"]:
            return "chat"

        # 2. Conflitti, allarmi, sovraccarichi, ritardi, replanning o email di avviso anomalie
        alarm_keywords = [
            "conflitt", "sovraccaric", "allarm", "ritard", "mancat", "consuntiv",
            "riprogramm", "replan", "segnalazion", "alert", "problemi di carico",
            "criticit", "sovrapposiz"
        ]
        is_alarm = any(k in m for k in alarm_keywords)
        is_email = any(k in m for k in ["mail", "email", "bozza", "scrivi", "comunica", "avvisa", "avvisalo", "avvisare"])

        if is_alarm or (is_email and any(k in m for k in ["responsabile", "problem", "avvis", "programmazion", "commess"])):
            return "alarms"

        # 3. Default: interrogazione database via SQL
        return "sql"

    async def get_response(self, user_message: str, current_user=None, history=None) -> str:
        if not self.llm:
            return "Errore: Chiave API AI non configurata nel backend."

        today_str = date.today().strftime('%d/%m/%Y (%Y-%m-%d)')
        intent = self._classify_intent(user_message)
        logger.info(f"Chatbot Router: messaggio '{user_message}' classificato come INTENT '{intent}'")

        # Formatta la cronologia recente della chat per mantenere il contesto delle domande di follow-up
        history_context = ""
        if history:
            h_lines = []
            for h in history[-4:]:
                s = "Utente" if h.get("sender") == "user" else "Assistente"
                t = (h.get("text") or "").strip()
                if len(t) > 280:
                    t = t[:280] + "..."
                h_lines.append(f"{s}: {t}")
            if h_lines:
                history_context = "CRONOLOGIA RECENTE DELLA CHAT:\n" + "\n".join(h_lines) + "\n\n"

        try:
            # ==========================================
            # PATH 1: CHAT GENERICA / SALUTI (Ultra-veloce, ~200 token)
            # ==========================================
            if intent == "chat":
                chat_prompt = PromptTemplate.from_template(
                    "Sei l'assistente virtuale ufficiale di HiPlan, la piattaforma aziendale di gestione commesse, pianificazione Gantt e controllo carichi di lavoro.\n"
                    "Rispondi in modo cortese, professionale, accogliente e chiaro in italiano.\n"
                    "Se l'utente saluta o chiede chi sei/cosa puoi fare, riassumi brevemente che puoi:\n"
                    "- Fornire dettagli, fasi di lavoro, date e avanzamento delle commesse\n"
                    "- Rilevare conflitti di calendario, ferie concomitanti, ritardi e sovraccarichi degli addetti\n"
                    "- Suggerire soluzioni di riprogrammazione operativa (replanning)\n"
                    "- Consultare e filtrare ticket di assistenza e supporto\n"
                    "- Redigere bozze di comunicazioni ed email operative basate sui dati reali\n\n"
                    "Messaggio dell'utente: {message}\n\n"
                    "Risposta:"
                )
                chat_chain = chat_prompt | self.llm | StrOutputParser()
                res = await chat_chain.ainvoke({"message": user_message})
                return res.strip()

            # ==========================================
            # PATH 2: ALLARMI, CONFLITTI, REPLANNING & BOZZE EMAIL (Latenza ~1s, no SQL)
            # ==========================================
            if intent == "alarms":
                suggestions_text = "Nessuna anomalia o conflitto rilevato al momento."
                users_list_str = ""
                try:
                    from app.models.base import AsyncSessionLocal
                    from app.models.user import User
                    from app.services.replanning_service import get_replanning_suggestions
                    async with AsyncSessionLocal() as session:
                        # Segnalazioni replanning in tempo reale
                        suggestions = await get_replanning_suggestions(session, current_user)
                        if suggestions:
                            type_labels = {
                                "missing_data": "Dati incompleti",
                                "zero_hours": "Mancata consuntivazione",
                                "vacation_conflict": "Conflitto con ferie",
                                "overload_conflict": "Sovraccarico lavorativo",
                                "delay_conflict": "Fase in ritardo",
                                "project_end_exceeded": "Scadenza commessa superata",
                            }
                            lines = []
                            for s in suggestions[:30]:
                                raw_type = s.get("type", "")
                                h_type = type_labels.get(raw_type, raw_type.replace("_", " ").capitalize())
                                reason = s.get("reason", "")
                                p_name = s.get("project_name", "")
                                t_name = s.get("task_name", "")
                                w = s.get("worker", "")
                                d = s.get("date", "")
                                lines.append(f"- [{h_type}] {reason} (Commessa: {p_name}, Fase: {t_name}, Data: {d}, Addetto: {w})")
                            suggestions_text = "\n".join(lines)
                        
                        # Addetti reali
                        users_res = await session.execute(select(User).where(User.is_active == True))
                        real_users = users_res.scalars().all()
                        if real_users:
                            u_entries = [f"{u.full_name or u.username} (email: {u.email or 'N/D'}, reparto: {u.department or 'generale'})" for u in real_users]
                            users_list_str = "- " + "\n- ".join(u_entries)
                except Exception as e_sugg:
                    logger.warning(f"Errore recupero segnalazioni/utenti per path alarms: {e_sugg}")

                alarms_prompt = PromptTemplate.from_template(
                    "Sei l'assistente virtuale di HiPlan, esperto di gestione commesse e pianificazione Gantt.\n"
                    "Data di oggi: {today_str}\n\n"
                    "{history_context}"
                    "ADDETTI REALI DEL SISTEMA:\n{users_list_str}\n\n"
                    "SEGNALAZIONI ATTIVE DI SISTEMA (CONFLITTI, SOVRACCARICHI, RITARDI, MANCATE CONSUNTIVAZIONI):\n{suggestions_text}\n\n"
                    "REGOLE E ISTRUZIONI OPERATIVE:\n"
                    "1. DIVIETO ASSOLUTO DI TERMINI TECNICI O DA PROGRAMMATORE:\n"
                    "   * Non usare MAI espressioni in codice o in snake_case (come 'missing_data', 'zero_hours', 'vacation_conflict', 'overload_conflict', 'delay_conflict', ecc.).\n"
                    "   * Usa sempre e solo un linguaggio discorsivo, naturale e professionale da ufficio (es. 'Dati incompleti', 'Mancata consuntivazione delle ore', 'Conflitto con ferie programmate', 'Sovraccarico lavorativo', 'Ritardo di pianificazione').\n"
                    "2. Se l'utente chiede una EMAIL o COMUNICAZIONE:\n"
                    "   * Redigi una bozza formale, chiara e pronta all'uso (includi 'Oggetto:' e il corpo dell'email ben strutturato con punti elenco o tabelle discorsive).\n"
                    "   * Riporta con precisione le commesse, le fasi, i colleghi coinvolti e le date dei problemi emersi.\n"
                    "3. Se l'utente chiede CONSIGLI DI RIPROGRAMMAZIONE o ANALISI:\n"
                    "   * Fai riferimento SOLO agli addetti reali del sistema. NON inventare mai colleghi o nomi fittizi.\n"
                    "   * Parla in modo operativo: 'Assegna la fase anche all'addetto X', 'Posticipa la fase al giorno Y'. Non usare termini da database ('aggiorna la colonna').\n"
                    "4. Se non ci sono segnalazioni attive, spiegalo con chiarezza e positività.\n"
                    "5. Sii chiaro, completo e collaborativo nelle spiegazioni.\n\n"
                    "Richiesta dell'utente: {message}\n\n"
                    "Risposta:"
                )
                alarms_chain = alarms_prompt | self.llm | StrOutputParser()
                res = await alarms_chain.ainvoke({
                    "today_str": today_str,
                    "history_context": history_context,
                    "users_list_str": users_list_str,
                    "suggestions_text": suggestions_text,
                    "message": user_message
                })
                return res.strip()

            # ==========================================
            # PATH 3: QUERY SQL SUL DATABASE (Tabelle, date, statistiche, filtri)
            # ==========================================
            user_id = str(current_user.id) if current_user else ""
            username = str(current_user.username) if current_user else ""
            user_role = str(getattr(current_user.role, 'value', current_user.role)).upper() if (current_user and hasattr(current_user, 'role')) else ""
            
            is_admin = (user_role == "ADMIN")
            is_observer = False
            try:
                import json
                from app.models.base import AsyncSessionLocal
                from app.models.setting import Setting
                async with AsyncSessionLocal() as session:
                    res_obs = await session.execute(select(Setting).where(Setting.key == "ticket_observers"))
                    setting_obs = res_obs.scalar_one_or_none()
                    if setting_obs and setting_obs.value:
                        obs_list = json.loads(str(setting_obs.value))
                        if username in obs_list:
                            is_observer = True
            except Exception as e_obs:
                logger.warning(f"Errore lettura osservatori ticket: {e_obs}")

            has_full_ticket_access = (is_admin or is_observer)
            if has_full_ticket_access:
                ticket_permission_rule = (
                    f"- REGOLA PERMESSI TICKET PER L'UTENTE CORRENTE (username: '{username}', ruolo: '{user_role}'):\n"
                    f"  * L'utente è AMMINISTRATORE o OSSERVATORE: HA ACCESSO A TUTTI I TICKET del sistema senza alcuna restrizione di visibilità."
                )
            else:
                ticket_permission_rule = (
                    f"- REGOLA PERMESSI TICKET PER L'UTENTE CORRENTE (username: '{username}', ID: '{user_id}', ruolo: '{user_role}'):\n"
                    f"  * L'utente NON è amministratore né osservatore. HA ACCESSO ESCLUSIVAMENTE ai ticket in cui è direttamente coinvolto:\n"
                    f"    1. Creatore / Autore (tickets.author_id = '{user_id}')\n"
                    f"    2. Responsabile / Referente (tickets.responsible_id = '{user_id}')\n"
                    f"    3. Assegnato (tickets.assigned_to LIKE '%{username}%')\n"
                    f"  * Nelle query SQL sui ticket per questo utente DEVI SEMPRE APPLICARE IL FILTRO DI SICUREZZA:\n"
                    f"    `AND (tickets.author_id = '{user_id}' OR tickets.responsible_id = '{user_id}' OR tickets.assigned_to LIKE '%{username}%')`"
                )

            sql_query_template = """Sei un esperto SQLite per il database aziendale di HiPlan.
Data odierna: {today_str}

Genera SOLO ed ESCLUSIVAMENTE la query SQL SQLite corretta per rispondere alla richiesta (massimo {top_k} risultati).
Non aggiungere spiegazioni, commenti, apici markdown o testo oltre alla query SQL.

REGOLE CRITICHE SUI DATI E PERMESSI:
{ticket_permission_rule}
- Tabella 'tickets':
  * La colonna 'status' contiene ESCLUSIVAMENTE uno di questi tre valori in MAIUSCOLO: 'DA_GESTIRE', 'IN_ATTESA', 'COMPLETATO'.
  * Ticket 'aperti' / 'attivi' / 'da risolvere' / 'in corso': usa SEMPRE `status IN ('DA_GESTIRE', 'IN_ATTESA')` oppure `status != 'COMPLETATO'`. MAI cercare 'open' o 'aperto'!
  * Ticket 'chiusi' / 'completati': usa `status = 'COMPLETATO'`.
  * Per panoramiche o elenchi di ticket, fai una LEFT JOIN con 'projects' (su tickets.project_id = projects.id) per estrarre anche il nome della commessa ('projects.name').
- Tabella 'projects':
  * 'status' è uno tra: 'PLANNING', 'ACTIVE', 'COMPLETED', 'ARCHIVED'.
- Tabella 'tasks' (fasi delle commesse):
  * 'project_id' è collegato a 'projects.id'.
  * Se l'utente fa una domanda di follow-up (es. 'dammi anche le loro fasi', 'mostrami le fasi', ecc.), unisci 'tasks' con 'projects' per estrarre le fasi delle commesse discusse.
- Tabella 'users':
  * 'role' è uno tra: 'ADMIN', 'EDITOR', 'VIEWER'.
- Per ricerche testuali usa `LIKE '%...%' COLLATE NOCASE` o `LOWER(...)`.
- Non interrogare la tabella 'notes' per motivi di privacy.

{history_context}Schema database:
{table_info}

Domanda dell'utente: {input}
SQLQuery:"""

            sql_query_prompt = PromptTemplate(
                input_variables=["input", "table_info", "top_k"],
                partial_variables={
                    "today_str": today_str,
                    "ticket_permission_rule": ticket_permission_rule,
                    "history_context": history_context
                },
                template=sql_query_template
            )

            generate_query = create_sql_query_chain(self.llm, self.db, prompt=sql_query_prompt, k=100)
            
            def clean_sql(query_str: str) -> str:
                q = query_str.strip()
                if "```sql" in q:
                    q = q.split("```sql")[1].split("```")[0]
                elif "```" in q:
                    q = q.split("```")[1].split("```")[0]
                if "SQLQuery:" in q:
                    q = q.split("SQLQuery:")[1]
                match = re.search(r'(SELECT\b.+)', q, re.IGNORECASE | re.DOTALL)
                if match:
                    q = match.group(1)
                if ";" in q:
                    q = q.split(";")[0]
                cleaned = q.strip()
                logger.info(f"Query SQL generata: {cleaned}")
                return cleaned
            
            clean_sql_runnable = RunnableLambda(clean_sql)
            
            def execute_and_log(sql_query: str) -> str:
                try:
                    res = self.db.run(sql_query)
                    logger.info(f"Risultato SQL: {res}")
                    return str(res)
                except Exception as ex:
                    logger.error(f"Errore esecuzione SQL '{sql_query}': {ex}")
                    return f"Errore SQL: {ex}"

            execute_query_runnable = RunnableLambda(execute_and_log)
            
            answer_prompt = PromptTemplate.from_template(
                "Sei l'assistente virtuale ufficiale di HiPlan, amichevole, professionale ed esperto di pianificazione.\n"
                "Rispondi alla richiesta dell'utente in italiano in modo chiaro, discorsivo ed esauriente, basandoti sui dati estratti dal database.\n\n"
                "LINEE GUIDA PER LA RISPOSTA:\n"
                "1. TONO PROFESSIONALE E DISCORSIVO:\n"
                "   * NON limitarti a stampare una tabella secca o un elenco senza testo!\n"
                "   * Introduci sempre i risultati con una breve frase naturale di presentazione.\n"
                "   * Quando presenti dati strutturati (come commesse, fasi o ticket), usa tabelle o elenchi puntati curati in Markdown, con grassetti per nomi, date e stati.\n"
                "   * Concludi con un commento di sintesi o una disponibilità ad approfondire se utile.\n"
                "2. CONTINUITÀ CONVERSAZIONALE:\n"
                "   * Se la domanda dell'utente fa riferimento al contesto precedente (es. 'dammi anche le loro fasi', 'approfondisci', 'chi se ne occupa?'), rispondi ricollegandoti chiaramente all'argomento precedente.\n"
                "3. TRADUZIONE CODICI:\n"
                "   * Stato ticket: 'DA_GESTIRE' -> 'Da gestire', 'IN_ATTESA' -> 'In attesa del cliente', 'COMPLETATO' -> 'Completato'.\n"
                "   * Priorità: 'LOW' -> 'Bassa', 'MEDIUM' -> 'Media', 'HIGH' -> 'Alta'.\n"
                "   * Stato commesse: 'PLANNING' -> 'In pianificazione', 'ACTIVE' -> 'Attiva', 'COMPLETED' -> 'Completata', 'ARCHIVED' -> 'Archiviata'.\n"
                "4. Non usare termini informatici da database (mai 'query', 'sql', 'tabella db', ID tecnici numerici o UUID).\n"
                "5. Se non ci sono record corrispondenti, spiega con gentilezza e chiarezza cosa hai cercato e che al momento non risultano elementi registrati.\n\n"
                "{history_context}"
                "Domanda dell'utente: {question}\n"
                "Dati estratti dal sistema: {result}\n\n"
                "Risposta completa e naturale:"
            )
            
            answer_prompt_bound = answer_prompt.partial(history_context=history_context)
            
            chain = (
                RunnablePassthrough.assign(query=generate_query | clean_sql_runnable).assign(
                    result=itemgetter("query") | execute_query_runnable
                )
                | answer_prompt_bound
                | self.llm
                | StrOutputParser()
            )

            response = await chain.ainvoke({"question": user_message})
            return response.strip()
            
        except Exception as e:
            logger.error(f"Errore nel chatbot durante l'elaborazione del messaggio '{user_message}': {e}", exc_info=True)
            error_msg = str(e)
            return f"Si è verificato un errore durante l'elaborazione della tua richiesta: {error_msg}"

    async def generate_admin_report(self, db) -> dict:
        import json
        from datetime import date, datetime, timedelta
        from sqlalchemy import select
        from app.models.project import Project, ProjectStatus
        from app.models.task import Task
        from app.models.user import User

        today = date.today()
        today_str = today.strftime("%d/%m/%Y")

        # 1. Carica progetti non eliminati
        res_proj = await db.execute(select(Project).where(Project.deleted_at.is_(None)))
        projects = res_proj.scalars().all()

        # 2. Carica task
        res_tasks = await db.execute(select(Task))
        tasks = res_tasks.scalars().all()

        # 3. Carica utenti attivi
        res_users = await db.execute(select(User).where(User.is_active.is_(True)))
        users = res_users.scalars().all()

        # Calcolo KPI
        total_projects = len(projects)
        active_projects = [p for p in projects if p.status == ProjectStatus.ACTIVE]
        planning_projects = [p for p in projects if p.status == ProjectStatus.PLANNING]
        completed_projects = [p for p in projects if p.status == ProjectStatus.COMPLETED]
        archived_projects = [p for p in projects if p.status == ProjectStatus.ARCHIVED]

        total_tasks = len(tasks)
        completed_tasks = [t for t in tasks if t.completed == 1 or (t.progress is not None and t.progress >= 1.0)]
        active_tasks = [t for t in tasks if t not in completed_tasks]

        overdue_tasks = []
        upcoming_tasks = []
        for t in active_tasks:
            if t.end_date:
                if t.end_date < today:
                    overdue_tasks.append(t)
                elif t.end_date <= today + timedelta(days=7):
                    upcoming_tasks.append(t)

        # Mappatura task per progetto
        proj_map = {str(p.id): p for p in projects}

        # Statistiche per addetto
        worker_stats = {}
        for t in tasks:
            w_list = []
            if t.workers:
                try:
                    w_list = json.loads(t.workers) if isinstance(t.workers, str) else t.workers
                except Exception:
                    w_list = [t.workers] if isinstance(t.workers, str) else []
            if isinstance(w_list, list):
                for w in w_list:
                    if not w or not str(w).strip():
                        continue
                    w_name = str(w).strip()
                    if w_name not in worker_stats:
                        worker_stats[w_name] = {"total": 0, "completed": 0, "active": 0, "overdue": 0}
                    worker_stats[w_name]["total"] += 1
                    if t.completed == 1 or (t.progress is not None and t.progress >= 1.0):
                        worker_stats[w_name]["completed"] += 1
                    else:
                        worker_stats[w_name]["active"] += 1
                        if t.end_date and t.end_date < today:
                            worker_stats[w_name]["overdue"] += 1

        # Genera testi di riepilogo dati
        active_proj_lines = []
        for p in active_projects:
            p_tasks = [t for t in tasks if str(t.project_id) == str(p.id)]
            p_done = [t for t in p_tasks if t.completed == 1 or (t.progress is not None and t.progress >= 1.0)]
            p_pct = int((len(p_done) / len(p_tasks) * 100)) if p_tasks else 0
            end_str = p.end_date.strftime("%d/%m/%Y") if p.end_date else "N/D"
            active_proj_lines.append(f"- **{p.name}** ({p.code or 'No Code'}) | Cliente: {p.client or 'Interno'} | Scadenza: {end_str} | Fasi: {len(p_done)}/{len(p_tasks)} ({p_pct}%)")

        if not active_proj_lines:
            active_proj_text = "Nessuna commessa attiva al momento."
        else:
            active_proj_text = "\n".join(active_proj_lines)

        # Dettaglio ritardi
        overdue_lines = []
        for t in overdue_tasks[:15]:
            proj = proj_map.get(str(t.project_id))
            p_name = proj.name if proj and proj.name else "Commessa sconosciuta"
            w_str = t.workers or "Non assegnato"
            overdue_lines.append(f"- *{t.text}* (Commessa: **{p_name}**) | Scaduta il: {t.end_date.strftime('%d/%m/%Y')} | Addetti: {w_str}")
        
        overdue_text = "\n".join(overdue_lines) if overdue_lines else "Nessuna attività scaduta in ritardo."

        # Distribuzione addetti
        worker_lines = []
        sorted_workers = sorted(worker_stats.items(), key=lambda x: x[1]["active"], reverse=True)
        for w_name, s in sorted_workers:
            worker_lines.append(f"- **{w_name}**: {s['active']} attive in corso, {s['completed']} completate, {s['overdue']} in ritardo (Totale: {s['total']})")
        
        worker_text = "\n".join(worker_lines) if worker_lines else "Nessun addetto attualmente assegnato a fasi di commessa."

        # Scadenze prossimi 7 giorni
        upcoming_lines = []
        for t in upcoming_tasks[:15]:
            proj = proj_map.get(str(t.project_id))
            p_name = proj.name if proj and proj.name else "Commessa sconosciuta"
            w_str = t.workers or "Non assegnato"
            upcoming_lines.append(f"- *{t.text}* (Commessa: **{p_name}**) | Scadenza: {t.end_date.strftime('%d/%m/%Y')} | Addetti: {w_str}")
        upcoming_text = "\n".join(upcoming_lines) if upcoming_lines else "Nessuna scadenza critica nei prossimi 7 giorni."

        # Tentativo chiamata LLM
        report_markdown = ""
        if self.llm:
            try:
                system_prompt = (
                    f"Sei un Senior Project Management AI Consultant per la piattaforma HiPlan.\n"
                    f"Oggi è il {today_str}.\n"
                    f"Genera un Resoconto Esecutivo chiaro, professionale, completo e altamente azionabile per la direzione aziendale e gli amministratori.\n\n"
                    f"DATI AGGIORNATI DEL SISTEMA:\n"
                    f"- Commesse Totali: {total_projects} (Attive: {len(active_projects)}, In Pianificazione: {len(planning_projects)}, Completate: {len(completed_projects)}, Archiviate: {len(archived_projects)})\n"
                    f"- Fasi / Attività Totali: {total_tasks} (Completate: {len(completed_tasks)}, In Corso: {len(active_tasks)}, In Ritardo: {len(overdue_tasks)})\n"
                    f"- Scadenze nei prossimi 7 giorni: {len(upcoming_tasks)}\n\n"
                    f"COMMESSE ATTIVE:\n{active_proj_text}\n\n"
                    f"ATTIVITÀ SCADUTE O IN RITARDO:\n{overdue_text}\n\n"
                    f"CARICO ADDETTI:\n{worker_text}\n\n"
                    f"SCADENZE IMMINENTI (PROSSIMI 7 GIORNI):\n{upcoming_text}\n\n"
                    f"ISTRUZIONI RIGOROSE:\n"
                    f"Formatta il testo in Markdown pulito ed elegante. Non inserire preamboli come 'Ecco il report' o saluti.\n"
                    f"Usa esattamente questa struttura:\n"
                    f"# 📑 Resoconto Esecutivo: Stato Commesse & Addetti ({today_str})\n\n"
                    f"### 1. 📊 Sintesi Esecutiva & Stato Commesse\n"
                    f"Descrivi la situazione complessiva con tono professionale, mettendo in evidenza avanzamento e stato delle commesse attive.\n\n"
                    f"### 2. 👥 Analisi Carico di Lavoro & Distribuzione Addetti\n"
                    f"Evidenzia la concentrazione dei carichi: chi è maggiormente occupato, chi ha task in ritardo e come bilanciare le risorse.\n\n"
                    f"### 3. ⚠️ Criticità, Ritardi & Scadenze Imminenti\n"
                    f"Analizza le attività in ritardo e quelle che scadono a breve termine, indicando possibili colli di bottiglia o rischi di consegna.\n\n"
                    f"### 4. 💡 Raccomandazioni Strategiche & Operative\n"
                    f"Fornisci 3-4 punti pratici e operativi per gli amministratori e project manager per ottimizzare la pianificazione.\n"
                )
                response = await self.llm.ainvoke(system_prompt)
                content = getattr(response, "content", response)
                if isinstance(content, str):
                    report_markdown = content
                elif isinstance(content, list):
                    report_markdown = "\n".join(str(c) for c in content)
                else:
                    report_markdown = str(content)
            except Exception as e:
                logger.error(f"Errore nella generazione report con LLM: {e}")

        # Fallback se LLM non disponibile o fallito
        if not report_markdown:
            report_markdown = (
                f"# 📑 Resoconto Esecutivo: Stato Commesse & Addetti ({today_str})\n\n"
                f"### 1. 📊 Sintesi Esecutiva & Stato Commesse\n"
                f"Nel sistema risultano registrate **{total_projects} commesse complessive**, di cui **{len(active_projects)} attive**, "
                f"**{len(planning_projects)} in fase di pianificazione** e **{len(completed_projects)} completate**.\n\n"
                f"**Stato delle commesse attive:**\n"
                f"{active_proj_text}\n\n"
                f"### 2. 👥 Analisi Carico di Lavoro & Distribuzione Addetti\n"
                f"Gli addetti coinvolti nelle attività sono **{len(worker_stats)}**. Di seguito il riepilogo del carico di ciascun membro del team:\n\n"
                f"{worker_text}\n\n"
                f"### 3. ⚠️ Criticità, Ritardi & Scadenze Imminenti\n"
                f"Attualmente si registrano **{len(overdue_tasks)} attività in ritardo** rispetto alla data di oggi e **{len(upcoming_tasks)} attività in scadenza nei prossimi 7 giorni**.\n\n"
                f"**Attività in ritardo:**\n{overdue_text}\n\n"
                f"**Scadenze nei prossimi 7 giorni:**\n{upcoming_text}\n\n"
                f"### 4. 💡 Raccomandazioni Strategiche & Operative\n"
                f"- **Riequilibrio carichi**: verificare la disponibilità degli addetti con il maggior numero di attività aperte per evitare sovraccarichi.\n"
                f"- **Priorità alle fasi scadute**: intervenire con solleciti o riprogrammazione sulle {len(overdue_tasks)} attività in ritardo.\n"
                f"- **Monitoraggio ravvicinato**: verificare l'avanzamento delle {len(upcoming_tasks)} fasi con consegna programmata entro i prossimi 7 giorni."
            )

        final_report = str(report_markdown).strip()
        return {
            "report": final_report,
            "kpis": {
                "total_projects": total_projects,
                "active_projects": len(active_projects),
                "planning_projects": len(planning_projects),
                "completed_projects": len(completed_projects),
                "total_tasks": total_tasks,
                "active_tasks": len(active_tasks),
                "overdue_tasks": len(overdue_tasks),
                "total_workers": len(worker_stats),
                "upcoming_deadlines_count": len(upcoming_tasks)
            },
            "generated_at": datetime.now().strftime("%d/%m/%Y alle %H:%M"),
            "generated_timestamp": int(datetime.now().timestamp() * 1000)
        }

chat_service = ChatService()
