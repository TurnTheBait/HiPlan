# 📊 GanttFlow — Piattaforma Enterprise per Gestione Commesse e Diagrammi di Gantt

**GanttFlow ** è una piattaforma web moderna, interattiva e multi-utente progettata per la pianificazione operativa delle commesse aziendali, il monitoraggio avanzato tramite **diagrammi di Gantt custom ad alta flessibilità**, la gestione dei turni del personale su **Calendario** e la collaborazione tramite **Blocchi Note interattivi in stile Notion**.

---

## 📚 Documentazione Ufficiale

Il progetto dispone di una documentazione completa e approfondita, suddivisa in due manuali dedicati all'interno della cartella [`docs/`]:

1. **[🛠️ Documentazione Tecnica per Sviluppatori (TECHNICAL_DOCUMENTATION.md)]**
   - Panoramica architetturale asincrona (FastAPI + SQLAlchemy 2.0 + React 18).
   - Diagrammi entità-relazione (ER) dettagliati delle tabelle (`users`, `clients`, `projects`, `phases`, `phase_workers`, `notes`).
   - Meccanismo di sicurezza, hashing industriali `bcrypt`, token JWT e politiche di controllo accessi **RBAC**.
   - Specifiche tecniche dell'editor visuale WYSIWYG `contentEditable` per le note e del motore Gantt Custom.
   - Riferimento rapido degli endpoint REST API e guida al setup locale e in produzione via Docker.

2. **[📖 Guida Utente Completa (USER_GUIDE.md)]**
   - Manuale d'uso pratico per **Amministratori**, **Project Manager** e **Operatori/Visualizzatori**.
   - Spiegazione passo-passo per la creazione di clienti, commesse e suddivisione in fasi temporali.
   - Istruzioni per l'assegnazione degli addetti operativi e la gestione dei turni sul Calendario mensile.
   - Guida all'utilizzo dei Blocchi Note in stile Notion (formattazione istantanea, check-list collaborative interattive e controllo della visibilità `🔒 Privato` / `👥 Condiviso` in tempo reale).
   - Gestione degli account e dell'anagrafica addetti dal pannello `Admin`.

---

## ✨ Funzionalità Core del Sistema

- **📅 Diagramma di Gantt & Timeline Interattiva Custom**:
  - Nessun vincolo o costo di licenze esterne di terze parti: griglia temporale nativa ad altissime prestazioni.
  - Selettore di risoluzione temporale multi-scala: **Giorni**, **Settimane** o **Mesi**.
  - Visualizzazione di priorità (`Bassa`, `Media`, `Alta`, `Critica`) con colorazione dinamica, date di inizio/fine e addetti sul campo.
  - Calcolo automatico in tempo reale della percentuale di completamento della commessa alla chiusura delle singole fasi.

- **👥 Calendario Operativo e Filtro Addetti**:
  - Vista mensile intuitiva delle fasi di lavorazione attive su ogni singola giornata.
  - Filtro dinamico per **Addetto Operativo**: ogni tecnico o operatore può isolare con un clic i giorni in cui è stato assegnato per conoscere il proprio planning personale.

- **📝 Blocchi Note Collaborativi (Stile Notion)**:
  - Editor visuale WYSIWYG nativo (`contentEditable`) con conversione automatica e trasparente del Markdown.
  - Pulsanti di formattazione istantanea: `H1`, `H2`, `Grassetto`, `Citazioni`, `Codice` e **Check-list interattive** con spunta a clic istantaneo e salvataggio automatico debounced.
  - Controllo di visibilità flessibile: possibilità di alternare in qualsiasi momento tra `🔒 File Privato` e `👥 In Condivisione con il Team` tramite il menu interattivo superiore.

- **🔐 Sicurezza e Multi-Utente (RBAC & JWT)**:
  - Tre ruoli chiari e strutturati: **👑 Admin**, **🚀 Project Manager (PM)** e **👥 Operatore (Viewer/Worker)**.
  - Intercettore Axios con rinnovo automatico del token di sessione (Access + Refresh Token).

---

## 🚀 Avvio Rapido Locale

### 1. Avvio del Backend (FastAPI — Porta 8000)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

_La documentazione API interattiva (Swagger UI) sarà disponibile all'indirizzo `http://localhost:8000/docs`._

### 2. Avvio del Frontend (React/Vite — Porta 5173)

```bash
cd frontend
npm install
npm run dev
```

_Apri il browser su `http://localhost:5173/`, registrati per diventare automaticamente il primo **Amministratore** e inizia a pianificare i tuoi progetti!_

---

## 🐳 Deploy in Produzione via Docker

Per il rilascio su server aziendali o VPS con database **PostgreSQL** centralizzato:

```bash
docker-compose up -d --build
```

Questo avvierà i 3 container Docker per la produzione (`PostgreSQL 16`, `FastAPI Server` e `Nginx + React SPA`).

---

## 📂 Struttura della Repository

```
Gantt/
├── docs/
│   ├── TECHNICAL_DOCUMENTATION.md  # Documentazione tecnica completa e schema DB
│   └── USER_GUIDE.md               # Manuale utente pratico per tutti i ruoli
├── backend/
│   ├── app/
│   │   ├── api/          # Endpoint REST (auth, users, clients, projects, phases, notes)
│   │   ├── core/         # Configurazione, sicurezza e connessione al DB
│   │   ├── models/       # Modelli SQLAlchemy 2.0 (User, Client, Project, Phase, PhaseWorker, Note)
│   │   └── schemas/      # Schemi Pydantic V2 per input e output
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/          # Client Axios con interceptor JWT
│   │   ├── components/   # Componenti UI (MainLayout, Gantt/Timeline Custom)
│   │   ├── context/      # AuthContext e ToastContext
│   │   ├── pages/        # Dashboard, Projects, ProjectDetail, Calendar, Notes, Admin
│   │   └── index.css     # Design System moderno Dark Theme & Glassmorphism
│   └── package.json
├── docker-compose.yml
└── README.md
```
