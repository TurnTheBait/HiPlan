# HiPlan — pianificazione commesse e risorse

HiPlan è una piattaforma web multiutente per pianificare commesse, fasi operative e carichi di lavoro. Riunisce diagrammi di Gantt, calendario, consuntivazione ore, ferie, ticket, TODO e strumenti di collaborazione in un'unica applicazione.

Il progetto usa un backend asincrono **FastAPI + SQLAlchemy** e una SPA **React + Vite**. In sviluppo può utilizzare SQLite; il deployment Docker include PostgreSQL e Nginx.

## Funzionalità disponibili

### Commesse e pianificazione

- Anagrafica commesse con codice, cliente, responsabile, addetti, stato, colore e intervallo temporale.
- Fasi e milestone organizzabili in gerarchia, con reparto, priorità, date e colore.
- Diagramma di Gantt interattivo basato su DHTMLX Gantt.
- Dipendenze tra fasi `FS`, `SS`, `FF` e `SF`, con eventuale ritardo (`lag`).
- Modalità di calcolo basate su date, giorni lavorativi e budget ore.
- Template di fase predefiniti per Ufficio Tecnico, Produzione e Acquisti.
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
- Blocchi note privati o condivisi con editor visuale e allegati.
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

> La configurazione Vite corrente non definisce un proxy `/api`: il client frontend contatta il backend usando la configurazione presente in `frontend/src/api/client.js`.

## Avvio tramite script

Il repository include script dedicati ai diversi sistemi:

- macOS: `./start.sh` oppure `./start_mac_server.sh`
- Windows: `start_windows.bat`
- arresto su Windows: `stop_windows.bat`

Prima del primo avvio verificare le variabili del backend partendo da `backend/.env.example`.

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
