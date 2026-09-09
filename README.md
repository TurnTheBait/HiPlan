# HiPlan — pianificazione commesse e risorse

HiPlan è una piattaforma web multiutente per pianificare commesse, fasi operative e carichi di lavoro. Riunisce diagrammi di Gantt, calendario, consuntivazione ore, ferie, ticket, TODO e strumenti di collaborazione in un'unica applicazione.

Il progetto usa un backend asincrono **FastAPI + SQLAlchemy** e una SPA **React + Vite**. In sviluppo può utilizzare SQLite; il deployment Docker include PostgreSQL e Nginx.

## Funzionalità disponibili

### Commesse e pianificazione

- Anagrafica commesse con codice, cliente, tipologia contrattuale (**Standard**, **ATEX**, **Alimentare** o combinata), responsabile, addetti, stato, colore e intervallo temporale.
- Modal spazioso a due colonne per creazione e modifica rapida dei dati e delle risorse.
- Fasi e milestone organizzabili in gerarchia, con reparto, priorità, date e colore.
- Diagramma di Gantt interattivo basato su DHTMLX Gantt.
- Dipendenze tra fasi `FS`, `SS`, `FF` e `SF`, con eventuale ritardo (`lag`).
- Modalità di calcolo basate su date, giorni lavorativi e budget ore.
- Template di fase predefiniti per Ufficio Tecnico, Produzione, Acquisti e Commerciale.
- Checklist, commenti, menzioni e notifiche contestuali alla singola fase.
- Allegati e note di commessa.
- Registro attività delle modifiche rilevanti.

### Risorse e avanzamento

- Assegnazione di uno o più addetti a commesse e fasi.
- Ripartizione delle ore pianificate per addetto.
- Consuntivazione delle ore effettive per persona e giornata.
- Heatmap del carico di lavoro.
- Calendario operativo globale e timeline personale.
- Segnalazione delle sovrapposizioni tra attività.
- Gestione ferie e rilevazione dei conflitti tra ferie e fasi assegnate.

### Collaborazione e operatività

- TODO personali o assegnati, con scadenza, promemoria, allegati e notifiche email opzionali.
- Ticket collegabili a una commessa, con responsabile, assegnatari, priorità, stati, conversazione e allegati.
- Blocchi note privati o condivisi con editor visuale, layout a due colonne e drag-and-drop per gli allegati.
- **HiPlan AI**: suite avanzata di Intelligenza Artificiale basata su LLM:
  - **Analisi Operativa Commessa**: audit in tempo reale, calcolo avanzamento effettivo coerente, verifiche di conformità normativa (ATEX 2014/34/UE e MOCA/HACCP) e tabelle di riprogrammazione oraria nominative (senza consigli generalisti o futili).
  - **Reportistica Esecutiva Admin**: resoconto strategico per la direzione aziendale con indicatori KPI e analisi carichi.
  - **Assistente Virtuale (Chatbot)**: motore Text-to-SQL con self-correction loop e tool per scadenze, bilanciamento del team e morning briefing.
- **Rilevatore Conflitti**: sistema proattivo in background che individua ritardi, mancate consuntivazioni e anomalie.
- Notifiche in-app e aggiornamenti in tempo reale tramite WebSocket.
- Tema chiaro, scuro o sincronizzato con il sistema.

### Controllo e amministrazione

- Autenticazione JWT con access token e refresh token.
- Ruoli `admin`, `editor` e `viewer`, con reparto di appartenenza.
- Gestione utenti, ruoli, stato degli account e reset password.
- Annunci globali con scadenza.
- Configurazione dei template di fase e degli stati dei ticket.
- Export PDF ed Excel delle commesse, del Gantt, delle ore e dei ticket.
- Backup JSON amministrativo dei dati supportati, ripristino e backup locale schedulato per SQLite e upload.
- Registro delle notifiche email inviate e programmate.

## Documentazione

- [Guida utente](docs/USER_GUIDE.md): utilizzo quotidiano delle principali sezioni.
- [Documentazione tecnica](docs/TECHNICAL_DOCUMENTATION.md): architettura, modello dati, API e sviluppo locale.
- [Guida al deployment](docs/DEPLOYMENT_GUIDE.md): installazione e accesso in rete.
- [Roadmap](docs/ROADMAP.md): funzionalità candidate e ordine di priorità.

## Avvio rapido

### Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Su Windows, attivare l'ambiente con `venv\Scripts\activate`.

Il backend risponde su `http://localhost:8000`; Swagger UI è disponibile su `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

L'interfaccia è disponibile su `http://localhost:5173`.

Il frontend richiede Node.js `20.19` o successivo.

> La configurazione Vite corrente non definisce un proxy `/api`: il client frontend contatta il backend usando la configurazione presente in `frontend/src/api/client.js`.

## Gestione tramite script unificati

HiPlan include due soli script principali per la gestione completa (avvio, arresto, aggiornamento, setup):

- **Windows**: `hiplan.bat`
- **macOS**: `./hiplan.sh`

Avviando lo script senza parametri viene mostrato un menu interattivo con le opzioni:
1. **start**: avvio coordinato di backend FastAPI e frontend Vite con apertura browser
2. **stop**: arresto sicuro di tutti i servizi e processi attivi
3. **update**: arresto, backup database SQLite, aggiornamento dipendenze e ricompilazione
4. **setup**: verifica prerequisiti, creazione virtualenv e installazione dipendenze

È possibile anche passare direttamente il comando via terminale:
```bash
./hiplan.sh start    # oppure stop / update / setup su macOS
hiplan.bat start     # oppure stop / update / setup su Windows
```

Gli script verificano automaticamente i requisiti ed eseguono la configurazione iniziale se necessario.

## Docker

Per avviare PostgreSQL, backend e frontend:

```bash
docker compose up -d --build
```

Servizi predefiniti:

| Servizio | Porta |
| --- | ---: |
| Frontend Nginx | `80` |
| API FastAPI | `8000` |
| PostgreSQL | `5432` |

Per un ambiente reale è necessario sostituire password, `SECRET_KEY` e origini CORS definite in `docker-compose.yml`.

## Verifiche

```bash
cd backend
pytest

cd ../frontend
npm run lint
npm run build
```

## Struttura del repository

```text
Gantt/
├── backend/
│   ├── app/
│   │   ├── api/          # Router REST e WebSocket
│   │   ├── core/         # Configurazione, database, sicurezza
│   │   ├── models/       # Modelli SQLAlchemy
│   │   ├── schemas/      # Schemi Pydantic
│   │   └── services/     # Logica applicativa, email, export e backup
│   └── tests/
├── frontend/
│   └── src/
│       ├── api/          # Client HTTP
│       ├── components/   # Gantt, calendario, workload e layout
│       ├── context/      # Autenticazione, tema e toast
│       └── pages/        # Pagine della SPA
├── docs/
├── docker-compose.yml
└── README.md
```

## Stato e prossimi sviluppi

La distinzione tra funzionalità disponibili e proposte future è mantenuta nella [roadmap](docs/ROADMAP.md). Le prime aree candidate sono baseline e scostamenti, template completi di commessa, ripianificazione delle dipendenze, timesheet approvabili e ricerca globale.
