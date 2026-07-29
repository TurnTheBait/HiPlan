# Guida al deployment di HiPlan

Questa guida copre due scenari:

- avvio rapido su un computer della rete aziendale;
- deployment Docker con PostgreSQL e Nginx.

Per un'esposizione su Internet servono inoltre HTTPS, gestione sicura dei segreti, backup esterni, monitoraggio e un reverse proxy configurato dall'amministratore di sistema.

## 1. Prerequisiti

Per l'avvio tramite script:

- Python 3.12 o successivo;
- Node.js 18 o successivo;
- accesso amministrativo al firewall del server;
- indirizzo IP stabile oppure prenotazione DHCP.

Per Docker:

- Docker Engine o Docker Desktop;
- plugin Docker Compose;
- spazio persistente per database, backup e allegati.

## 2. Configurazione iniziale

Creare `backend/.env` partendo dal file di esempio:

```bash
cp backend/.env.example backend/.env
```

Impostare almeno:

```dotenv
SECRET_KEY=una-chiave-lunga-casuale
CORS_ORIGINS=["http://IP-DEL-SERVER:5173"]
DEBUG=false
```

Se si usano le notifiche email, configurare anche le variabili `SMTP_*` descritte nella documentazione tecnica.

Il frontend usa automaticamente il nome host dal quale è stato aperto e contatta l'API sulla porta `8000`. Per il normale utilizzo in LAN non è quindi necessario modificare `frontend/src/api/client.js`.

## 3. Avvio rapido in rete locale

Questa modalità utilizza Uvicorn e il server di sviluppo Vite. È adatta a test, dimostrazioni o piccoli ambienti controllati, non a un servizio esposto su Internet.

### macOS

Preparare una volta le dipendenze:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cd ../frontend
npm install
```

Avviare poi dalla radice del repository:

```bash
./start_mac_server.sh
```

In alternativa è disponibile `./start.sh`, che mantiene i log nel terminale.

### Windows

Eseguire una volta:

```text
setup_windows.bat
```

Avviare quindi:

```text
start_windows.bat
```

I processi vengono eseguiti in background e scrivono nella cartella `logs`. Per arrestarli usare `stop_windows.bat`.

### Accesso dai client

Individuare l'IPv4 del server:

- Windows: `ipconfig`;
- macOS: Impostazioni di Sistema → Rete, oppure `ipconfig getifaddr en0`;
- Linux: `ip address`.

Da un altro computer della stessa rete aprire:

```text
http://IP-DEL-SERVER:5173
```

L'API deve essere raggiungibile su:

```text
http://IP-DEL-SERVER:8000/api/health
```

## 4. Firewall

Per la modalità LAN devono essere raggiungibili:

| Porta | Servizio |
| ---: | --- |
| `5173/TCP` | frontend Vite |
| `8000/TCP` | API FastAPI |

Su Windows è disponibile `allow_firewall_windows.bat`. Prima di utilizzarlo, verificare con l'amministratore di rete il profilo e l'ambito consentiti: lo script corrente apre entrambe le porte su tutti i profili.

È preferibile creare regole limitate:

- al solo profilo **Privato** o **Dominio**;
- alla subnet aziendale;
- alle sole porte necessarie.

Non aprire PostgreSQL `5432` ai client dell'applicazione.

## 5. Deployment Docker

Il file `docker-compose.yml` avvia:

- PostgreSQL 16;
- FastAPI sulla porta `8000`;
- frontend Nginx sulla porta `80`.

Prima dell'avvio modificare nel file Compose:

- password del database;
- `SECRET_KEY`;
- `CORS_ORIGINS`;
- nomi e policy dei volumi secondo l'ambiente.

Avviare:

```bash
docker compose up -d --build
```

Controllare lo stato:

```bash
docker compose ps
docker compose logs backend
docker compose logs frontend
docker compose logs db
```

Accesso predefinito:

```text
http://IP-DEL-SERVER
```

Il frontend compilato continua a contattare l'API su `http://IP-DEL-SERVER:8000/api` se non è definita `VITE_API_URL` durante la build. Nginx contiene anche un proxy `/api`; per usare un solo endpoint pubblico occorre compilare il frontend con `VITE_API_URL=/api` e non pubblicare direttamente la porta backend, adattando di conseguenza il Compose.

## 6. Persistenza e backup

Il volume `postgres_data` conserva il database PostgreSQL. Gli allegati vengono invece scritti nella directory `/app/uploads` del container backend: il Compose corrente non monta ancora un volume dedicato.

Prima di considerare il deployment pronto per la produzione:

1. aggiungere un volume persistente per `/app/uploads`;
2. includere database, upload e backup automatici nella politica di salvataggio;
3. verificare periodicamente un ripristino in un ambiente isolato;
4. copiare i backup fuori dal server applicativo;
5. definire conservazione e cifratura.

Il backup JSON scaricabile dal pannello Admin non include automaticamente il contenuto fisico degli allegati.

Il job automatico integrato archivia soltanto `ganttflow.db` e la directory locale degli upload. Nel deployment PostgreSQL non sostituisce un dump del database.

## 7. HTTPS e reverse proxy

Per accessi fuori da una LAN controllata:

- pubblicare un solo endpoint HTTPS;
- terminare TLS su Nginx, Traefik, Caddy o un proxy aziendale;
- inoltrare `/api` e WebSocket al backend;
- rimuovere l'esposizione pubblica delle porte `8000`, `5173` e `5432`;
- limitare CORS al dominio effettivo;
- impostare cookie/token e header di sicurezza secondo la policy aziendale.

## 8. Verifiche dopo il rilascio

Eseguire almeno:

1. `GET /api/health`;
2. login e refresh della sessione;
3. creazione e apertura di una commessa di prova;
4. caricamento e download di un allegato;
5. modifica del Gantt da due browser;
6. export PDF ed Excel;
7. creazione di un TODO con notifica;
8. controllo dello stato del backup;
9. riavvio completo dei servizi, verificando la persistenza dei dati.

## 9. Aggiornamenti

Prima di aggiornare:

1. leggere le modifiche al modello dati;
2. eseguire un backup del database e degli upload;
3. provare migrazioni e build in staging;
4. annotare la versione applicativa;
5. predisporre una procedura di rollback.

Per Docker:

```bash
docker compose build
docker compose up -d
```

Controllare sempre i log e completare le verifiche funzionali prima di dichiarare concluso l'aggiornamento.
