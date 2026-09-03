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

def parse_clean_workers(val) -> list[str]:
    """Estrae una lista pulita di nomi/username degli addetti dal campo workers (escludendo parentesi quadre e virgolette JSON)."""
    if not val:
        return []
    if isinstance(val, list):
        out = []
        for x in val:
            c = str(x).strip(" '\"[]\t\r\n")
            if c:
                out.append(c)
        return out
    s = str(val).strip()
    if (s.startswith("[") and s.endswith("]")) or (s.startswith('"') and s.endswith('"')):
        try:
            import json
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [str(x).strip(" '\"[]\t\r\n") for x in parsed if str(x).strip(" '\"[]\t\r\n")]
            elif isinstance(parsed, str):
                s = parsed
        except Exception:
            pass
    # Rimuovi parentesi quadre residue
    s = s.strip("[]")
    parts = re.split(r"[,;]+", s)
    return [p.strip(" '\"[]\t\r\n") for p in parts if p.strip(" '\"[]\t\r\n")]

def format_clean_workers(val) -> str:
    """Restituisce una stringa leggibile (es. 'mario, luigi') o '-' se vuoto."""
    workers = parse_clean_workers(val)
    return ", ".join(workers) if workers else "-"

def normalize_progress(raw_progress) -> int:
    """
    Converte progress (salvato nel DB come float 0.0-1.0 o come percentuale 0-100) in un intero 0-100.
    Esempi: 0.7 -> 70, 0.97 -> 97, 0.17 -> 17, 1.0 -> 100, 70 -> 70.
    """
    if raw_progress is None:
        return 0
    try:
        val = float(raw_progress)
        if 0 < val <= 1.0:
            return round(val * 100)
        return round(val)
    except (ValueError, TypeError):
        return 0

class ChatService:
    def __init__(self):
        self.sync_db_url = get_sync_db_url(settings.DATABASE_URL)
        self.engine = create_engine(self.sync_db_url)
        self._db = None
        
        # Temperatura differenziata:
        # sql_llm (0.0): massima precisione e rigore deterministico per query SQL
        # chat_llm (0.3): tono naturale, analisi strategica, fluidità e raccomandazioni
        self.sql_llm = self._build_llm(temperature=0.0)
        self.chat_llm = self._build_llm(temperature=0.3)
        self.llm = self.chat_llm

    def _build_llm(self, temperature: float = 0.0):
        primary_llm = None
        if settings.GROQ_API_KEY:
            primary_llm = ChatGroq(
                model="openai/gpt-oss-120b", 
                groq_api_key=settings.GROQ_API_KEY,
                temperature=temperature
            )

        fallbacks: list = []
        if settings.GEMINI_API_KEY:
            from langchain_google_genai import ChatGoogleGenerativeAI
            fallbacks.append(ChatGoogleGenerativeAI(
                model="gemini-2.5-flash",
                google_api_key=settings.GEMINI_API_KEY,
                temperature=temperature,
                max_retries=1
            ))
            
        if settings.COHERE_API_KEY:
            from langchain_cohere import ChatCohere
            fallbacks.append(ChatCohere(
                model="command-r-plus",
                cohere_api_key=settings.COHERE_API_KEY,
                temperature=temperature
            ))
            
        if primary_llm and fallbacks:
            return primary_llm.with_fallbacks(fallbacks)
        elif primary_llm:
            return primary_llm
        elif fallbacks:
            return fallbacks[0].with_fallbacks(fallbacks[1:]) if len(fallbacks) > 1 else fallbacks[0]
        return None

    @property
    def db(self):
        if self._db is None:
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

    # =========================================================================
    # TOOL DEDICATI (AGENTIC TOOLS - Zero errori SQL, massima accuratezza)
    # =========================================================================
    async def _tool_get_user_tasks(self, current_user) -> str:
        """Estrae le attività assegnate all'utente connesso con stato, scadenze e consigli pratici."""
        if not current_user:
            return "Per vedere le tue attività personali è necessario essere autenticati."
            
        username = str(getattr(current_user, 'username', '')).strip()
        full_name = str(getattr(current_user, 'full_name', '')).strip()
        user_id = getattr(current_user, 'id', None)
        display_name = full_name or username
        
        from app.models.base import AsyncSessionLocal
        from app.models.task import Task
        from app.models.project import Project
        
        async with AsyncSessionLocal() as session:
            stmt = (
                select(Task, Project.name.label("proj_name"), Project.code.label("proj_code"))
                .join(Project, Task.project_id == Project.id)
                .where(Project.deleted_at.is_(None))
            )
            res = await session.execute(stmt)
            all_rows = res.all()
            
            user_tasks: list = []
            for t, p_name, p_code in all_rows:
                workers_list = [w.lower() for w in parse_clean_workers(getattr(t, 'workers', None))]
                assigned_str = str(t.assigned_to) if t.assigned_to else ""
                
                matched = False
                if username and username.lower() in workers_list:
                    matched = True
                elif full_name and full_name.lower() in workers_list:
                    matched = True
                elif user_id and str(user_id) == assigned_str:
                    matched = True
                    
                if matched:
                    user_tasks.append((t, str(p_code or ""), str(p_name or "Senza nome")))
                    
            if not user_tasks:
                return (
                    f"### 📋 Nessuna attività assegnata a **{display_name}**\n\n"
                    f"Al momento non risultano fasi o compiti operativi assegnati direttamente al tuo profilo nelle commesse attive.\n\n"
                    f"---\n"
                    f"💡 **Azione consigliata:** Verifica con il responsabile di commessa o consulta l'elenco generale per visualizzare le fasi di reparto aperte."
                )
                
            today = date.today()
            overdue_count = 0
            upcoming_count = 0
            
            lines = [
                f"Ecco il riepilogo aggiornato delle tue attività operative, **{display_name}** ({len(user_tasks)} fasi totali):\n",
                "| Stato | Fase / Attività | Commessa | Scadenza | Avanzamento | Ore Previste |",
                "| :---: | :--- | :--- | :---: | :---: | :---: |"
            ]
            
            def get_sort_key(item_tuple):
                raw_d = getattr(item_tuple[0], 'end_date', None)
                if raw_d and hasattr(raw_d, 'date'):
                    return raw_d.date()
                return raw_d or date.max
                
            for task_obj, p_code, p_name in sorted(user_tasks, key=get_sort_key):
                p_label = f"**{p_code}**" if p_code else p_name
                raw_end = getattr(task_obj, 'end_date', None)
                end_d: date | None = raw_end.date() if (raw_end and hasattr(raw_end, 'date')) else raw_end
                end_str = end_d.strftime("%d/%m/%Y") if end_d else "N/D"
                prog_val = normalize_progress(getattr(task_obj, 'progress', 0))
                prog = f"{prog_val}%"
                planned_h = getattr(task_obj, 'planned_hours', None)
                hours = f"{planned_h}h" if planned_h else "-"
                
                is_completed = bool(getattr(task_obj, 'completed', False)) or prog_val >= 100
                if is_completed:
                    status_badge = "🟢 Completata"
                elif end_d and end_d < today:
                    status_badge = "🔴 In ritardo"
                    overdue_count += 1
                elif end_d and (end_d - today).days <= 7:
                    status_badge = "🟡 In scadenza"
                    upcoming_count += 1
                else:
                    status_badge = "🔵 In corso"
                    
                task_title = str(getattr(task_obj, 'text', 'Attività'))
                lines.append(f"| {status_badge} | **{task_title}** | {p_label} | {end_str} | {prog} | {hours} |")
                
            lines.append("\n---")
            if overdue_count > 0:
                lines.append(f"💡 **Azione consigliata:** Rilevate **{overdue_count} fasi in ritardo**. Ti suggerisco di aggiornare lo stato di avanzamento o segnalare una data di ripianificazione al tuo responsabile di commessa.")
            elif upcoming_count > 0:
                lines.append(f"💡 **Azione consigliata:** Hai **{upcoming_count} fasi in scadenza nei prossimi 7 giorni**. Ti raccomando di verificare la disponibilità dei materiali e l'avanzamento per completarle nei tempi previsti.")
            else:
                lines.append("💡 **Azione consigliata:** Tutte le attività risultano regolari e in linea con le tempistiche stimate.")
                
            return "\n".join(lines)

    async def _tool_get_projects_overview(self) -> str:
        """Estrae la panoramica delle commesse attive e in pianificazione formattata con tabella ricca."""
        from app.models.base import AsyncSessionLocal
        from app.models.project import Project, ProjectStatus
        from app.models.task import Task, TaskType
        
        async with AsyncSessionLocal() as session:
            p_res = await session.execute(
                select(Project).where(Project.deleted_at.is_(None)).order_by(Project.end_date.asc())
            )
            projects = p_res.scalars().all()
            
            if not projects:
                return "Attualmente non ci sono commesse registrate nel sistema."
                
            t_res = await session.execute(select(Task))
            all_tasks = t_res.scalars().all()
            
            # Mappa task per commessa
            tasks_by_proj: dict = {}
            for t in all_tasks:
                tasks_by_proj.setdefault(str(t.project_id), []).append(t)
                
            today = date.today()
            lines = [
                f"Ecco la panoramica aggiornata dello stato delle commesse aziendali ({len(projects)} commesse registrate):\n",
                "| Stato | Codice | Commessa | Cliente | Scadenza | Avanzamento | Fasi (Compl./Tot) |",
                "| :---: | :--- | :--- | :--- | :---: | :---: | :---: |"
            ]
            
            overdue_p = 0
            for p in projects:
                p_tasks = tasks_by_proj.get(str(p.id), [])
                # Escludiamo milestone per perfetta coerenza con il calcolo del frontend e di project_service
                progress_tasks = [
                    t for t in p_tasks 
                    if getattr(t, 'type', None) != TaskType.MILESTONE and 'milestone' not in str(getattr(t, 'type', '')).lower()
                ]
                tot_t = len(progress_tasks)
                compl_t = sum(1 for t in progress_tasks if getattr(t, 'completed', 0) == 1 or normalize_progress(getattr(t, 'progress', 0)) >= 100)
                
                tot_prog = sum(normalize_progress(getattr(t, 'progress', 0)) for t in progress_tasks)
                avg_prog = round(tot_prog / tot_t) if tot_t > 0 else 0
                raw_end = getattr(p, 'end_date', None)
                end_d: date | None = raw_end.date() if (raw_end and hasattr(raw_end, 'date')) else raw_end
                end_str = end_d.strftime("%d/%m/%Y") if end_d else "N/D"
                
                st_val = getattr(p.status, 'value', p.status)
                if st_val == ProjectStatus.COMPLETED or st_val == "COMPLETED":
                    st_badge = "🟢 Completata"
                elif st_val == ProjectStatus.ARCHIVED or st_val == "ARCHIVED":
                    st_badge = "⚪ Archiviata"
                elif end_d and end_d < today and st_val == "ACTIVE":
                    st_badge = "🔴 In ritardo"
                    overdue_p += 1
                elif st_val == ProjectStatus.ACTIVE or st_val == "ACTIVE":
                    st_badge = "🔵 Attiva"
                else:
                    st_badge = "🟡 Pianificazione"
                    
                client_str = str(p.client or "-")
                lines.append(f"| {st_badge} | **{p.code or '-'}** | {p.name} | {client_str} | {end_str} | {avg_prog}% | {compl_t}/{tot_t} |")
                
            lines.append("\n---")
            if overdue_p > 0:
                lines.append(f"💡 **Azione consigliata:** Ci sono **{overdue_p} commesse con scadenza superata**. Si consiglia di concordare con la direzione una ripianificazione o verificare gli stati di avanzamento lavori (SAL).")
            else:
                lines.append("💡 **Azione consigliata:** Il programma complessivo delle commesse rispetta le date di consegna pattuite con i clienti.")
                
            return "\n".join(lines)

    async def _tool_get_team_workload(self) -> str:
        """Calcola e restituisce la graduatoria dei carichi di lavoro degli addetti."""
        from app.models.base import AsyncSessionLocal
        from app.models.task import Task
        from app.models.project import Project
        
        async with AsyncSessionLocal() as session:
            stmt = (
                select(Task)
                .join(Project, Task.project_id == Project.id)
                .where(Project.deleted_at.is_(None))
            )
            res = await session.execute(stmt)
            tasks = res.scalars().all()
            
            worker_stats: dict = {}
            today = date.today()
            
            for t in tasks:
                workers = parse_clean_workers(getattr(t, 'workers', None))
                prog_val = normalize_progress(getattr(t, 'progress', 0))
                is_done = bool(getattr(t, 'completed', False)) or prog_val >= 100
                raw_end = getattr(t, 'end_date', None)
                end_d: date | None = raw_end.date() if (raw_end and hasattr(raw_end, 'date')) else raw_end
                t_hours = float(getattr(t, 'planned_hours', 0) or 0)
                
                for w in workers:
                    if w not in worker_stats:
                        worker_stats[w] = {"active": 0, "completed": 0, "overdue": 0, "hours": 0.0}
                        
                    if is_done:
                        worker_stats[w]["completed"] += 1
                    else:
                        worker_stats[w]["active"] += 1
                        if end_d and end_d < today:
                            worker_stats[w]["overdue"] += 1
                    worker_stats[w]["hours"] += t_hours
                        
            if not worker_stats:
                return "Attualmente non ci sono addetti associati a fasi di commessa aperte."
                
            sorted_workers = sorted(worker_stats.items(), key=lambda x: (x[1]["active"], x[1]["overdue"]), reverse=True)
            
            lines = [
                "Ecco l'analisi dettagliata del carico operativo del team ordinata per volume di lavoro attivo:\n",
                "| Addetto | Fasi Attive | Fasi Completate | In Ritardo | Ore Totali Stimate | Stato Carico |",
                "| :--- | :---: | :---: | :---: | :---: | :---: |"
            ]
            
            for w, s in sorted_workers:
                tot_hours = round(float(s["hours"]), 1)
                if s["overdue"] > 0:
                    load_status = "🔴 Sovraccarico / Ritardi"
                elif s["active"] >= 4:
                    load_status = "🟡 Carico Elevato"
                else:
                    load_status = "🟢 Bilanciato"
                    
                lines.append(f"| **{w}** | {s['active']} | {s['completed']} | {s['overdue']} | {tot_hours}h | {load_status} |")
                
            lines.append("\n---")
            busiest = sorted_workers[0][0] if sorted_workers else None
            if busiest:
                lines.append(f"💡 **Azione consigliata:** L'addetto con il maggior volume operativo è **{busiest}** ({sorted_workers[0][1]['active']} fasi aperte). Valuta la redistribuzione delle attività meno urgenti per prevenire colli di bottiglia.")
            else:
                lines.append("💡 **Azione consigliata:** I carichi di lavoro risultano equamente distribuiti tra i membri dei reparti.")
                
            return "\n".join(lines)

    async def _tool_get_deadlines(self, days: int = 30) -> str:
        """Estrae le attività con scadenza nei prossimi giorni."""
        from app.models.base import AsyncSessionLocal
        from app.models.task import Task
        from app.models.project import Project
        from datetime import date, timedelta
        
        today = date.today()
        cutoff = today + timedelta(days=days)
        
        async with AsyncSessionLocal() as session:
            stmt = (
                select(Task, Project.name.label("proj_name"), Project.code.label("proj_code"))
                .join(Project, Task.project_id == Project.id)
                .where(
                    Project.deleted_at.is_(None),
                    Task.completed.is_(False),
                    Task.end_date.is_not(None)
                )
            )
            res = await session.execute(stmt)
            rows = res.all()
            
            upcoming = []
            for t, p_name, p_code in rows:
                end_d = t.end_date.date() if hasattr(t.end_date, 'date') else t.end_date
                if end_d and today <= end_d <= cutoff:
                    upcoming.append({
                        "task": t,
                        "project_name": p_name,
                        "project_code": p_code,
                        "days_left": (end_d - today).days
                    })
                    
            if not upcoming:
                return f"Non risultano fasi in scadenza nei prossimi {days} giorni nelle commesse attive."
                
            upcoming.sort(key=lambda x: x["days_left"])
            
            lines = [
                f"Ecco le attività con consegna o scadenza programmata nei prossimi **{days} giorni** ({len(upcoming)} fasi individuate):\n",
                "| Scadenza | Tra (gg) | Fase / Attività | Commessa | Addetti | Avanzamento |",
                "| :---: | :---: | :--- | :--- | :--- | :---: |"
            ]
            
            for item in upcoming:
                t = item["task"]
                p_label = f"**{item['project_code']}** - {item['project_name']}" if item['project_code'] else item['project_name']
                end_d = t.end_date.date() if hasattr(t.end_date, 'date') else t.end_date
                d_str = end_d.strftime("%d/%m/%Y")
                w_str = format_clean_workers(getattr(t, 'workers', None))
                prog_val = normalize_progress(getattr(t, 'progress', 0))
                prog = f"{prog_val}%"
                
                days_left = item["days_left"]
                days_badge = "🔴 Oggi" if days_left == 0 else f"🟡 {days_left} gg" if days_left <= 3 else f"{days_left} gg"
                
                lines.append(f"| {d_str} | {days_badge} | **{t.text}** | {p_label} | {w_str} | {prog} |")
                
            lines.append("\n---")
            lines.append("💡 **Azione consigliata:** Dai la priorità alle fasi con consegna a meno di 3 giorni e verifica la disponibilità delle risorse per evitare slittamenti a cascata sul diagramma di Gantt.")
            return "\n".join(lines)

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

        # 2. Tool dedicato: mie attività / compiti personali
        my_tasks_keys = [
            "mie attività", "miei compiti", "miei task", "mie fasi",
            "cosa devo fare", "cosa ho da fare", "miei incarichi",
            "assegnate a me", "miei lavori", "a cosa devo lavorare",
            "a cosa sto lavorando", "quali sono le mie"
        ]
        if any(k in m for k in my_tasks_keys):
            return "my_tasks"

        # 3. Tool dedicato: panoramica commesse
        proj_overview_keys = [
            "stato commesse", "panoramica commesse", "elenco commesse",
            "commesse attive", "avanzamento commesse", "stato dei progetti",
            "panoramica progetti", "elenco delle commesse", "tutte le commesse"
        ]
        if any(k in m for k in proj_overview_keys) and not any(k in m for k in ["mail", "email", "scrivi"]):
            return "projects_overview"

        # 4. Tool dedicato: carico addetti
        workload_keys = [
            "carico addetti", "carico di lavoro", "chi ha più carico",
            "chi lavora di più", "distribuzione carichi", "carichi di lavoro",
            "sovraccarichi addetti", "chi è più carico"
        ]
        if any(k in m for k in workload_keys) and not any(k in m for k in ["mail", "email", "scrivi"]):
            return "team_workload"

        # 5. Tool dedicato: scadenze del mese o prossimi giorni
        deadlines_keys = [
            "scadenza questo mese", "scadenze questo mese", "scadenze del mese",
            "scadono questo mese", "scadenze a breve", "prossime scadenze",
            "fasi in scadenza", "commesse in scadenza questo mese"
        ]
        if any(k in m for k in deadlines_keys) and not any(k in m for k in ["mail", "email", "scrivi"]):
            return "deadlines"

        # 6. Conflitti, allarmi, sovraccarichi, ritardi, replanning o email di avviso anomalie
        alarm_keywords = [
            "conflitt", "allarm", "ritard", "mancat", "consuntiv",
            "riprogramm", "replan", "segnalazion", "alert", "problemi di carico",
            "criticit", "sovrapposiz"
        ]
        is_alarm = any(k in m for k in alarm_keywords)
        is_email = any(k in m for k in ["mail", "email", "bozza", "scrivi", "comunica", "avvisa", "avvisalo", "avvisare"])

        if is_alarm or (is_email and any(k in m for k in ["responsabile", "problem", "avvis", "programmazion", "commess"])):
            return "alarms"

        # 7. Default: interrogazione database via SQL guidato
        return "sql"

    async def get_response(self, user_message: str, current_user=None, history=None) -> str:
        if not self.llm:
            return "Errore: Chiave API AI non configurata nel backend."

        today_str = date.today().strftime('%d/%m/%Y (%Y-%m-%d)')
        intent = self._classify_intent(user_message)
        logger.info(f"Chatbot Router: messaggio '{user_message}' classificato come INTENT '{intent}'")

        # Contesto utente
        username = str(getattr(current_user, 'username', '') or '')
        full_name = str(getattr(current_user, 'full_name', '') or username or 'Utente')
        user_role = str(getattr(current_user.role, 'value', current_user.role)).upper() if (current_user and hasattr(current_user, 'role')) else "VIEWER"
        user_dept = str(getattr(current_user, 'department', 'generale') or 'generale')

        # Formatta cronologia recente
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
            # INTENT 1: STRUMENTI DETERMINISTICI (AGENTIC TOOLS)
            # ==========================================
            if intent == "my_tasks":
                return await self._tool_get_user_tasks(current_user)

            if intent == "projects_overview":
                return await self._tool_get_projects_overview()

            if intent == "team_workload":
                return await self._tool_get_team_workload()

            if intent == "deadlines":
                return await self._tool_get_deadlines(days=30)

            # ==========================================
            # INTENT 2: CHAT GENERICA / SALUTI
            # ==========================================
            if intent == "chat":
                chat_prompt = PromptTemplate.from_template(
                    "Sei l'assistente virtuale ufficiale di HiPlan, la piattaforma aziendale di gestione commesse, pianificazione Gantt e controllo carichi di lavoro.\n"
                    "Data di oggi: {today_str}\n"
                    "Stai parlando con: **{full_name}** (@{username}), Ruolo: {user_role}, Reparto: {user_dept}.\n\n"
                    "Rispondi in modo cordiale, professionale ed accogliente in italiano.\n"
                    "Se l'utente saluta o chiede chi sei/cosa puoi fare, presenta brevemente i tuoi compiti:\n"
                    "- Consultare e riepilogare commesse, fasi e stati di avanzamento Gantt\n"
                    "- Mostrare le attività personali assegnate al profilo utente\n"
                    "- Rilevare conflitti di calendario, ferie concomitanti, ritardi e carichi addetti\n"
                    "- Proporre strategie operative e redigere bozze di email formali\n\n"
                    "Messaggio dell'utente: {message}\n\n"
                    "Risposta:"
                )
                chat_chain = chat_prompt | self.chat_llm | StrOutputParser()
                res = await chat_chain.ainvoke({
                    "today_str": today_str,
                    "full_name": full_name,
                    "username": username,
                    "user_role": user_role,
                    "user_dept": user_dept,
                    "message": user_message
                })
                return res.strip()

            # ==========================================
            # INTENT 3: ALLARMI, CONFLITTI, REPLANNING & BOZZE EMAIL
            # ==========================================
            if intent == "alarms":
                suggestions_text = "Nessuna anomalia o conflitto rilevato al momento."
                users_list_str = ""
                try:
                    from app.models.base import AsyncSessionLocal
                    from app.models.user import User
                    from app.services.replanning_service import get_replanning_suggestions
                    async with AsyncSessionLocal() as session:
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
                                w = format_clean_workers(s.get("worker", ""))
                                d = s.get("date", "")
                                lines.append(f"- [{h_type}] {reason} (Commessa: {p_name}, Fase: {t_name}, Data: {d}, Addetto: {w})")
                            suggestions_text = "\n".join(lines)
                        
                        users_res = await session.execute(select(User).where(User.is_active == True))
                        real_users = users_res.scalars().all()
                        if real_users:
                            u_entries = [f"{u.full_name or u.username} (email: {u.email or 'N/D'}, reparto: {u.department or 'generale'})" for u in real_users]
                            users_list_str = "- " + "\n- ".join(u_entries)
                except Exception as e_sugg:
                    logger.warning(f"Errore recupero segnalazioni per path alarms: {e_sugg}")

                alarms_prompt = PromptTemplate.from_template(
                    "Sei l'assistente virtuale di HiPlan, esperto di gestione commesse e pianificazione operativa.\n"
                    "Data odierna: {today_str}\n"
                    "Interlocutore: {full_name} (@{username}) | Ruolo: {user_role} | Reparto: {user_dept}\n\n"
                    "{history_context}"
                    "ADDETTI REALI DEL SISTEMA:\n{users_list_str}\n\n"
                    "SEGNALAZIONI ATTIVE DI SISTEMA (CONFLITTI, SOVRACCARICHI, RITARDI):\n{suggestions_text}\n\n"
                    "LINEE GUIDA:\n"
                    "1. LINGUAGGIO PROFESSIONALE: non usare MAI termini tecnici snake_case ('missing_data', 'vacation_conflict').\n"
                    "2. Se l'utente chiede una EMAIL/BOZZA: crea una comunicazione formale, elegante e pronta all'invio, con 'Oggetto:' e corpo ben strutturato.\n"
                    "3. Se l'utente chiede ANALISI/CONSIGLI: formatta se opportuno con tabelle Markdown e concludi sempre con un suggerimento pratico:\n"
                    "   ---\n   💡 **Azione consigliata:** [consiglio operativo]\n"
                    "4. Fai riferimento SOLO agli addetti reali del sistema.\n"
                    "5. NOMI DEGLI ADDETTI: Mostra sempre i nomi o username puliti (es. 'admin', 'anna_uff', 'franco_pro'). NON mostrare MAI parentesi quadre o virgolette tipo '[\"anna_uff\"]'.\n"
                    "6. FORMATTAZIONE TABELLE: Se organizzi le anomalie in tabella, usa intestazioni brevi e chiare (es. | Commessa | Fase / Attività | Criticità | Data / Periodo | Addetto | Note |).\n\n"
                    "Richiesta dell'utente: {message}\n\n"
                    "Risposta:"
                )
                alarms_chain = alarms_prompt | self.chat_llm | StrOutputParser()
                res = await alarms_chain.ainvoke({
                    "today_str": today_str,
                    "full_name": full_name,
                    "username": username,
                    "user_role": user_role,
                    "user_dept": user_dept,
                    "history_context": history_context,
                    "users_list_str": users_list_str,
                    "suggestions_text": suggestions_text,
                    "message": user_message
                })
                return res.strip()

            # ==========================================
            # INTENT 4: INTERROGAZIONE DATABASE (SQL + DIZIONARIO DOMINIO + FEW-SHOT)
            # ==========================================
            user_id = str(current_user.id) if current_user else ""
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
                ticket_permission_rule = "- ACCESSO COMPLETO TICKET: L'utente è Admin/Osservatore e può visualizzare tutti i ticket."
            else:
                ticket_permission_rule = (
                    f"- RESTRIZIONE TICKET UTENTE: L'utente può vedere SOLO i propri ticket. "
                    f"Aggiungi sempre: `AND (tickets.author_id = '{user_id}' OR tickets.responsible_id = '{user_id}' OR tickets.assigned_to LIKE '%{username}%')`"
                )

            sql_query_template = """Sei un ingegnere esperto di database SQLite per la piattaforma di Project Management HiPlan.
Data odierna di riferimento: {today_str}
UTENTE CONNESSO: {full_name} (username: '{username}', ID: '{user_id}', Ruolo: {user_role}, Reparto: {user_dept})

Genera SOLO ed ESCLUSIVAMENTE la query SQL SQLite corretta per rispondere alla domanda dell'utente (massimo {top_k} risultati).
Non aggiungere commenti, spiegazioni o testo oltre alla query SQL.

DIZIONARIO DEL DOMINIO E REGOLE CRITICHE SULLE TABELLE:
1. Tabella 'projects' (Commesse):
   * REGOLA FONDAMENTALE: Le commesse eliminate sono soft-deleted. DEVI SEMPRE INCLUDERE `WHERE projects.deleted_at IS NULL` (o `AND projects.deleted_at IS NULL`).
   * 'status' ha valori: 'PLANNING' (in pianificazione), 'ACTIVE' (attiva/in corso), 'COMPLETED' (completata), 'ARCHIVED' (archiviata).
2. Tabella 'tasks' (Fasi / Attività delle commesse):
   * 'project_id' collega la fase a 'projects.id'.
   * 'workers' è un campo testo contenente i nomi o username degli addetti (es. 'mario, luigi'). Per cercare per addetto usa `t.workers LIKE '%{username}%'`.
   * 'completed' è 1 per completata, 0 per in corso. 'progress' è memorizzato come decimale da 0.0 a 1.0 (es. 0.70 è 70%, 0.97 è 97%, 1.0 è 100%). Per la percentuale calcola `ROUND(t.progress * 100)`.
   * 'type' identifica le milestone ('milestone') che non hanno avanzamento.
   * 'start_date' e 'end_date' sono date ISO. Per confrontare con la data odierna usa `date('now')` o `'{today_str}'`.
3. Tabella 'tickets' (Ticket di supporto e commessa):
   * {ticket_permission_rule}
   * 'status' contiene: 'DA_GESTIRE', 'IN_ATTESA', 'COMPLETATO'. I ticket aperti sono: `status IN ('DA_GESTIRE', 'IN_ATTESA')`.
4. Per ricerche testuali usa sempre `LIKE '%...%' COLLATE NOCASE`.

ESEMPI DI QUERY SQL CORRETTE (FEW-SHOT EXAMPLES):
- Domanda: "Quali sono le commesse attive del cliente Alfa?"
  SQL: SELECT p.code, p.name, p.client, p.start_date, p.end_date, p.status FROM projects p WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE' AND p.client LIKE '%Alfa%' COLLATE NOCASE;
- Domanda: "Quali fasi scadono questo mese?"
  SQL: SELECT t.text, p.name AS project_name, t.end_date, t.progress, t.workers FROM tasks t JOIN projects p ON t.project_id = p.id WHERE p.deleted_at IS NULL AND t.completed = 0 AND strftime('%Y-%m', t.end_date) = strftime('%Y-%m', 'now');
- Domanda: "Quali attività sono assegnate all'utente connesso?"
  SQL: SELECT t.text, p.name AS project_name, t.start_date, t.end_date, t.progress, t.completed FROM tasks t JOIN projects p ON t.project_id = p.id WHERE p.deleted_at IS NULL AND (t.workers LIKE '%{username}%' OR t.assigned_to = '{user_id}') AND t.completed = 0;
- Domanda: "Mostrami i ticket aperti ad alta priorità"
  SQL: SELECT t.id, t.title, t.priority, t.status, p.name AS project_name FROM tickets t LEFT JOIN projects p ON t.project_id = p.id WHERE t.status IN ('DA_GESTIRE', 'IN_ATTESA') AND t.priority = 'HIGH';

{history_context}Schema database:
{table_info}

Domanda dell'utente: {input}
SQLQuery:"""

            sql_query_prompt = PromptTemplate(
                input_variables=["input", "table_info", "top_k"],
                partial_variables={
                    "today_str": today_str,
                    "full_name": full_name,
                    "username": username,
                    "user_id": user_id,
                    "user_role": user_role,
                    "user_dept": user_dept,
                    "ticket_permission_rule": ticket_permission_rule,
                    "history_context": history_context
                },
                template=sql_query_template
            )

            # Esecuzione query con sql_llm deterministico (temperature=0.0)
            generate_query = create_sql_query_chain(self.sql_llm, self.db, prompt=sql_query_prompt, k=100)
            
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
                "Sei l'assistente virtuale ufficiale di HiPlan per la gestione di commesse, carichi e diagrammi di Gantt.\n"
                "Data odierna: {today_str}\n"
                "Utente interlocutore: {full_name} (@{username}) | Ruolo: {user_role}\n\n"
                "Rispondi alla richiesta dell'utente in italiano in modo chiaro, discorsivo, rigoroso ed elegante.\n\n"
                "REGOLE OBBLIGATORIE DI FORMATTAZIONE:\n"
                "1. TABELLE MARKDOWN:\n"
                "   * Se la risposta contiene 2 o più elementi (commesse, fasi, addetti o ticket), DEVI SEMPRE impaginare i dati in una TABELLA MARKDOWN pulita.\n"
                "   * Esempio: `| Stato | Nome | Commessa | Scadenza | Avanzamento |`.\n"
                "2. BADGE ED EMOJI DI STATO:\n"
                "   * 🟢 Completata / In tempo\n"
                "   * 🟡 In scadenza ravvicinata / In pianificazione\n"
                "   * 🔴 In ritardo / Criticità\n"
                "   * 🔵 In lavorazione / Attiva\n"
                "3. CONCLUSIONE OPERATIVA:\n"
                "   * Al termine della risposta aggiungi SEMPRE un separatore e un consiglio pratico breve:\n"
                "     ---\n"
                "     💡 **Azione consigliata:** [1-2 righe di raccomandazione operativa o passo successivo suggerito]\n"
                "4. TRADUZIONE CODICI:\n"
                "   * Non mostrare ID numerici o valori grezzi ('ACTIVE' -> 'Attiva', 'HIGH' -> 'Alta', 'DA_GESTIRE' -> 'Da gestire').\n\n"
                "{history_context}"
                "Domanda dell'utente: {question}\n"
                "Dati estratti dal sistema: {result}\n\n"
                "Risposta completa, formattata e professionale:"
            )
            
            answer_prompt_bound = answer_prompt.partial(
                today_str=today_str,
                full_name=full_name,
                username=username,
                user_role=user_role,
                history_context=history_context
            )
            
            chain = (
                RunnablePassthrough.assign(query=generate_query | clean_sql_runnable).assign(
                    result=itemgetter("query") | execute_query_runnable
                )
                | answer_prompt_bound
                | self.chat_llm
                | StrOutputParser()
            )

            response = await chain.ainvoke({"question": user_message})
            return response.strip()
            
        except Exception as e:
            logger.error(f"Errore nel chatbot durante l'elaborazione del messaggio '{user_message}': {e}", exc_info=True)
            return f"Si è verificato un errore durante l'elaborazione della tua richiesta: {e}"

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

        return {
            "report": report_markdown.strip(),
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
