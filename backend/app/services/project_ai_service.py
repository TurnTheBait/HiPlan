import json
import logging
from datetime import date
# pyrefly: ignore [missing-import]
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from sqlalchemy import select
# pyrefly: ignore [missing-import]
from sqlalchemy.orm import selectinload
from langchain_groq import ChatGroq
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser

from app.core.config import settings
from app.models.project import Project
from app.models.task import Task, TaskType
from app.models.user import User
from app.models.vacation import Vacation
from app.services.replanning_service import get_replanning_suggestions

logger = logging.getLogger(__name__)


async def analyze_project_ai(db: AsyncSession, project_id: str, current_user: User) -> dict:
    """
    Esegue un'analisi completa con IA sulla commessa specificata:
    - Analizza la commessa, le sue fasi e gli addetti
    - Valuta ritardi, sovrapposizioni, conflitti con ferie e sovraccarichi (cross-commessa)
    - Esclude la mancata consuntivazione
    - Fornisce suggerimenti operativi e piani di riprogrammazione verificati
    """
    today = date.today()
    today_str = today.strftime('%d/%m/%Y (%Y-%m-%d)')

    # 1. Carica la commessa con relative relazioni
    res = await db.execute(
        select(Project)
        .options(selectinload(Project.tasks), selectinload(Project.responsible))
        .where(Project.id == project_id)
    )
    project = res.scalar_one_or_none()
    if not project:
        return {
            "success": False,
            "error": "Commessa non trovata."
        }

    # 2. Addetti coinvolti nella commessa
    project_workers = set()
    if project.assigned_workers:
        try:
            aw = json.loads(project.assigned_workers)
            if isinstance(aw, list):
                project_workers.update(aw)
        except Exception:
            pass

    for t in project.tasks:
        if t.workers:
            try:
                w_list = json.loads(t.workers)
                if isinstance(w_list, list):
                    project_workers.update(w_list)
            except Exception:
                pass

    # 3. Recupera tutti gli utenti reali
    users_res = await db.execute(select(User).where(User.is_active == True))
    all_users = users_res.scalars().all()
    user_map = {u.username: u for u in all_users}
    users_list_str = ", ".join([f"{u.full_name or u.username} ({u.username}, {u.department or 'generale'})" for u in all_users])

    # 4. Recupera le segnalazioni calcolate dal motore di replanning (escludendo la mancata consuntivazione)
    system_suggestions = await get_replanning_suggestions(db, current_user)
    
    # Filtra: escludi 'unreported_work_conflict' e tieni quelle pertinenti a questa commessa o agli addetti coinvolti
    filtered_suggestions = []
    for s in system_suggestions:
        s_type = s.get("type", "")
        if s_type == "unreported_work_conflict":
            continue  # Escluso esplicitamente per richiesta utente
        
        s_proj_id = s.get("project_id", "")
        s_worker = s.get("worker", "")
        
        # Pertinente se riguarda questa commessa OPPURE se riguarda un addetto di questa commessa in sovraccarico/ferie su un'altra commessa
        if s_proj_id == str(project.id) or (s_worker and s_worker in project_workers):
            filtered_suggestions.append(s)

    # 5. Rileva Dati Mancanti sulla commessa e sulle fasi
    missing_data = []
    if not project.responsible_id and not project.responsible:
        missing_data.append("Responsabile di commessa non assegnato")
    if not project.start_date:
        missing_data.append("Data di inizio commessa non impostata")
    if not project.end_date:
        missing_data.append("Data di fine commessa non impostata")
    if not project_workers:
        missing_data.append("Nessun addetto assegnato alla commessa")
        
    for t in project.tasks:
        if t.type != TaskType.PROJECT:
            if not t.start_date:
                missing_data.append(f"Fase '{t.text}': Data di inizio mancante")
            if not t.end_date:
                missing_data.append(f"Fase '{t.text}': Data di fine mancante")
            if not t.planned_hours or t.planned_hours <= 0:
                missing_data.append(f"Fase '{t.text}': Ore pianificate pari a 0 o non impostate")
            try:
                t_w = json.loads(t.workers) if t.workers else []
                if not t_w:
                    missing_data.append(f"Fase '{t.text}': Nessun addetto assegnato")
            except:
                pass

    # 6. Prepara il sommario testuale delle fasi della commessa
    tasks_summary_lines = []
    for t in project.tasks:
        if t.type == TaskType.PROJECT:
            continue
        st_date = t.start_date.strftime('%d/%m/%Y') if t.start_date else 'N/D'
        en_date = t.end_date.strftime('%d/%m/%Y') if t.end_date else 'N/D'
        workers_str = t.workers or '[]'
        status_str = "Completato" if t.completed == 1 else f"In corso ({int((t.progress or 0)*100)}%)"
        is_delayed = bool(t.end_date and t.end_date < today and t.completed == 0)
        delay_tag = " [IN RITARDO SULLA SCADENZA]" if is_delayed else ""
        tasks_summary_lines.append(
            f"- Fase: '{t.text}' | Dal: {st_date} Al: {en_date} ({t.duration} gg) | Ore: {t.planned_hours}h | Addetti: {workers_str} | Stato: {status_str}{delay_tag}"
        )
    tasks_summary = "\n".join(tasks_summary_lines) if tasks_summary_lines else "Nessuna fase presente."

    # 7. Formatta le segnalazioni di conflitto / sovraccarico rilevate
    conflicts_lines = []
    for s in filtered_suggestions:
        s_type = s.get("type", "")
        reason = s.get("reason", "")
        p_name = s.get("project_name", "")
        t_name = s.get("task_name", "")
        w = s.get("worker", "")
        d = s.get("date", "")
        conflicts_lines.append(f"- Tipo: {s_type} | Dettaglio: {reason} (Commessa: {p_name}, Fase: {t_name}, Data: {d}, Addetto: {w})")
    conflicts_summary = "\n".join(conflicts_lines) if conflicts_lines else "Nessun conflitto o sovraccarico rilevato dal motore di pianificazione."

    missing_summary = "\n".join([f"- {m}" for m in missing_data]) if missing_data else "Nessun dato essenziale mancante."

    # 8. Genera l'analisi con LLM Groq
    if not settings.GROQ_API_KEY:
        # Fallback senza API key
        return {
            "success": True,
            "has_conflicts": len(filtered_suggestions) > 0 or len(missing_data) > 0,
            "conflict_count": len(filtered_suggestions),
            "missing_count": len(missing_data),
            "analysis": f"**Riepilogo Rapido Commessa {project.name}**\n\n- Conflitti rilevati: {len(filtered_suggestions)}\n- Dati mancanti: {len(missing_data)}\n\nConfigura la chiave GROQ_API_KEY nel backend per ottenere suggerimenti di riprogrammazione approfonditi."
        }

    llm = ChatGroq(
        model="openai/gpt-oss-120b",
        groq_api_key=settings.GROQ_API_KEY,
        temperature=0.1
    )

    analysis_prompt = PromptTemplate.from_template(
        "Sei l'assistente AI avanzato di HiPlan, specializzato nell'analisi operativa delle commesse e nella riprogrammazione intelligente dei carichi di lavoro.\n\n"
        "DATI COMMESSA ANALIZZATA:\n"
        "- Codice: {project_code}\n"
        "- Nome: {project_name}\n"
        "- Cliente: {project_client}\n"
        "- Date Commessa: Inizio {project_start_date} - Fine {project_end_date}\n"
        "- Responsabile: {project_responsible}\n"
        "- Addetti assegnati alla commessa: {project_workers}\n\n"
        "FASI DELLA COMMESSA:\n{tasks_summary}\n\n"
        "CONFLITTI OPERATIVI E SOVRACCARICHI RILEVATI (INCLUSO IL CARICO SU ALTRE COMMESSE):\n{conflicts_summary}\n\n"
        "DATI MANCANTI RILEVATI:\n{missing_summary}\n\n"
        "DATA DI OGGI: {today_str}\n"
        "ADDETTI REALI DISPONIBILI NELL'ORGANICO:\n{users_list_str}\n\n"
        "ISTRUZIONI PER L'ANALISI (IMPORTANTE E VINCOLANTE):\n"
        "1. Escludi categoricamente l'analisi della mancata consuntivazione (non menzionarla mai).\n"
        "2. Valuta con precisione: ritardi su scadenze, sovrapposizioni, ferie/assenze degli addetti, sovraccarichi oltre le 8h/giorno (anche dovuti ad altre commesse) e dati mancanti.\n"
        "3. Se ci sono conflitti/sovraccarichi/ritardi:\n"
        "   - Spiega con chiarezza l'origine del problema.\n"
        "   - Fornisci proposte di RIPROGRAMMAZIONE concrete e applicabili: indica le date esatte libere in cui spostare le fasi o i colleghi reali dello stesso reparto a cui affidare parte delle ore, rispettando il limite delle 8h/giorno e le date della commessa madre.\n"
        "4. Se NON ci sono problemi o conflitti, dai un riscontro positivo sintetico confermando che la pianificazione è solida ed equilibrata.\n"
        "5. STILE E STRUTTURA DEL REPORT (FONDAMENTALE):\n"
        "   - Vai dritto al punto! Niente saluti ('Buongiorno') né formule di cortesia finali ('Resto a disposizione').\n"
        "   - Organizza la risposta esattamente in queste tre sezioni chiare con intestazioni H3 Markdown (###):\n"
        "     ### 1. Stato Generale Commessa\n"
        "     ### 2. Criticità e Conflitti Rilevati\n"
        "     ### 3. Proposte di Riprogrammazione e Suggerimenti\n"
        "   - Usa elenchi puntati con grassetti sui punti chiave (es. **Data inizio commessa**, **Fase X**, **Addetto Y**, **12/09/2026**). Se usi tabelle, assicurati che abbiano intestazioni coerenti e colonne ben bilanciate.\n\n"
        "PRODUCI ORA IL REPORT DI ANALISI E RIPROGRAMMAZIONE:"
    )

    chain = analysis_prompt | llm | StrOutputParser()

    try:
        response_text = await chain.ainvoke({
            "project_code": project.code or "N/D",
            "project_name": project.name,
            "project_client": project.client or "N/D",
            "project_start_date": project.start_date.strftime('%d/%m/%Y') if project.start_date else "Non definita",
            "project_end_date": project.end_date.strftime('%d/%m/%Y') if project.end_date else "Non definita",
            "project_responsible": project.responsible.full_name if project.responsible else (project.responsible.username if project.responsible else "Non assegnato"),
            "project_workers": ", ".join(list(project_workers)) if project_workers else "Nessuno",
            "tasks_summary": tasks_summary,
            "conflicts_summary": conflicts_summary,
            "missing_summary": missing_summary,
            "today_str": today_str,
            "users_list_str": users_list_str
        })
        
        return {
            "success": True,
            "has_conflicts": len(filtered_suggestions) > 0 or len(missing_data) > 0,
            "conflict_count": len(filtered_suggestions),
            "missing_count": len(missing_data),
            "analysis": response_text.strip()
        }
    except Exception as e:
        logger.error(f"Errore durante l'analisi AI della commessa {project_id}: {e}", exc_info=True)
        return {
            "success": False,
            "error": f"Errore durante l'elaborazione dell'analisi AI: {e}"
        }
