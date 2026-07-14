# 📊 GanttFlow — Software Enterprise per Gestione Progetti e Diagrammi di Gantt

**GanttFlow** è una piattaforma web moderna, interattiva e multi-utente progettata per la creazione, gestione e pianificazione dei processi aziendali tramite **diagrammi di Gantt professionali**.

---

## ✨ Funzionalità Principali

- **📅 Diagramma di Gantt Interattivo (DHTMLX Gantt)**:
  - Creazione, modifica e spostamento di attività (Task) in tempo reale tramite **Drag & Drop**.
  - Gestione di **dipendenze (Links)** tra le attività (Fine-Inizio, Inizio-Inizio, Fine-Fine, Inizio-Fine).
  - Colori dinamici in base al livello di **Priorità** (`Bassa`, `Media`, `Alta`, `Critica`).
  - Zoom multi-scala temporale (`Giorno`, `Settimana`, `Mese`, `Trimestre`).
  - Calcolo avanzato e visualizzazione del **Percorso Critico** e tappe chiave (`Milestone`).

- **🔐 Sicurezza e Multi-Utente (RBAC & JWT)**:
  - Autenticazione sicura con token **JWT** (Access + Refresh Token) e hashing password industriale (`bcrypt`).
  - Controllo degli accessi basato sui ruoli (**RBAC**):
    - 👑 **Admin**: Accesso completo, creazione progetti, pannello gestione utenti e ruoli.
    - 🚀 **Project Manager (PM)**: Creazione progetti, gestione attività, assegnazione membri.
    - 👁️ **Viewer**: Visualizzazione progetti, diagrammi e report di avanzamento.
  - *Nota*: Il primo utente registrato sulla piattaforma ottiene automaticamente i privilegi di `Admin`.

- **📁 Dashboard e Notifiche**:
  - Riepilogo in tempo reale su progetti attivi, completati e progresso medio aziendale.
  - Centro notifiche integrato per assegnazioni, scadenze e aggiornamenti di progetto.

- **📄 Esportazione Report**:
  - Generazione istantanea di report in **PDF** (`ReportLab`) e cartelle di lavoro **Excel `.xlsx`** (`openpyxl`) con riepilogo attività, date, durate e percentuali di completamento.

---

## 🛠️ Architettura e Stack Tecnologico

- **Backend**: Python 3.12+ con **FastAPI** (asincrono, alte prestazioni, documentazione Swagger/OpenAPI inclusa).
- **ORM & Database**: **SQLAlchemy 2.0 (Async)** compatibile nativamente con **PostgreSQL** (su server aziendale) e **SQLite** (per sviluppo locale immediato).
- **Frontend**: **React 18** + **Vite** con Design System personalizzato, interfaccia **Dark Mode Premium** (Glassmorphism e animazioni fluide).
- **Libreria Gantt**: **DHTMLX Gantt** ottimizzato con tema scuro su misura.
- **Infrastruttura**: **Docker & Docker Compose** per deploy in produzione su server VPS con proxy **Nginx**.

---

## 🚀 Guida di Avvio Rapido

### Opzione 1: Sviluppo Locale (Senza Docker)

1. **Avvio del Backend (FastAPI - porta 8000)**:
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```
   *Il database SQLite `ganttflow.db` verrà creato automaticamente al primo avvio. La documentazione API interattiva sarà accessibile su `http://localhost:8000/docs`.*

2. **Avvio del Frontend (React/Vite - porta 5173)**:
   ```bash
   cd frontend
   npm install --legacy-peer-deps
   npm run dev
   ```
   *Apri il browser su `http://localhost:5173/` e registrati per iniziare.*

---

### Opzione 2: Deploy su Server VPS (Con Docker & PostgreSQL)

Per posizionare il software su un server aziendale o VPS con database **PostgreSQL** centralizzato:

1. **Clona o copia la cartella del progetto sul server**.
2. **Esegui Docker Compose**:
   ```bash
   docker-compose up -d --build
   ```
   Questo comando avvierà i 3 container idonei alla produzione:
   - `ganttflow_db`: PostgreSQL 16 con volume persistente per i dati.
   - `ganttflow_backend`: Server FastAPI collegato a PostgreSQL.
   - `ganttflow_frontend`: Server Nginx ad alte prestazioni che serve l'app React sulla porta `80` e instrada le chiamate `/api` verso il backend.

3. **Accedi all'applicativo**:
   Naviga dal browser verso l'IP pubblico del tuo server (es. `http://192.168.1.100` oppure il tuo dominio). Il primo utente che si registrerà diventerà automaticamente **Amministratore**.

---

## 📂 Struttura del Codice

```
Gantt/
├── backend/
│   ├── app/
│   │   ├── api/          # Endpoint REST (auth, projects, tasks, export, users, notifications)
│   │   ├── core/         # Configurazione, sicurezza (bcrypt + JWT), dipendenze
│   │   ├── models/       # Modelli SQLAlchemy 2.0 (User, Project, Task, Link, Notification)
│   │   ├── schemas/      # Modelli Pydantic per validazione di input/output
│   │   └── services/     # Logica di business dissociata e robusta
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/          # Client Axios con Interceptor JWT (auto-refresh su 401)
│   │   ├── components/   # Componenti UI (GanttChart wrapper DHTMLX, Layout, ecc.)
│   │   ├── context/      # AuthContext e ToastContext globali
│   │   ├── pages/        # LoginPage, DashboardPage, ProjectsPage, ProjectDetailPage, AdminPage
│   │   └── index.css     # Design System moderno Dark Theme
│   ├── Dockerfile
│   └── nginx.conf
├── docker-compose.yml    # Orchestrazione produzione (Postgres + Backend + Frontend Nginx)
└── README.md
```
