# 🚀 Guida al Deployment su Server Aziendale

Questa guida spiega passo passo come prendere questa applicazione Gantt e renderla accessibile a tutti i computer della rete locale della tua azienda tramite un server centrale.

---

## 1. Individuare l'indirizzo IP del Server

Il primissimo passo è scoprire l'indirizzo IP locale del server su cui farai girare l'applicazione. Questo sarà l'indirizzo che i tuoi colleghi digiteranno nei loro browser (es. `192.168.1.100`).

- **Se il server è Windows:**
  1. Apri il menu Start e cerca `cmd` (Prompt dei comandi).
  2. Digita il comando `ipconfig` e premi Invio.
  3. Cerca la voce **Indirizzo IPv4** (es. `192.168.1.X`). Annotalo, sarà il tuo IP aziendale.
- **Se il server è Linux/Mac:**
  1. Apri il terminale.
  2. Digita `ifconfig` o `ip a` e cerca l'IP locale (di solito sotto `eth0` o `en0`).

---

## 2. Modificare il Codice Frontend

Di base, il frontend (l'interfaccia utente) è impostato per cercare il backend sul computer stesso in cui viene aperto il browser (`localhost`). Se un collega apre l'app dal suo PC, il suo browser cercherà il backend sul *suo* PC, generando un errore. 
Devi dire al frontend di chiamare sempre il tuo Server.

1. Apri il file `frontend/src/api/client.js`.
2. Trova la **riga 3**:
   ```javascript
   // PRIMA:
   const API_BASE = 'http://localhost:8000/api';
   ```
3. Modificala inserendo l'IP del tuo server che hai trovato nel Passo 1:
   ```javascript
   // DOPO (sostituisci 192.168.1.100 con il tuo vero IP):
   const API_BASE = 'http://192.168.1.100:8000/api';
   ```

---

## 3. Esporre i Server alla Rete Locale

Di default, per motivi di sicurezza, sia il Backend (Python/Uvicorn) che il Frontend (Vite) sono "chiusi" su se stessi e rifiutano connessioni esterne. Dobbiamo "aprirli" dicendogli di ascoltare su tutte le interfacce di rete (`0.0.0.0`).

### Opzione A: Modificare lo script `start.sh` (Consigliata)
Se usi lo script `start.sh` creato in precedenza, modificalo in questo modo:

**Per il Backend (Riga 6):**
```bash
# Prima:
uvicorn app.main:app --reload --port 8000 &
# Dopo:
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
```

**Per il Frontend (Riga 11):**
```bash
# Prima:
npm run dev &
# Dopo:
npm run dev -- --host &
```

### Opzione B: Lanciare i comandi manualmente
Se preferisci avviare due terminali separati:
- **Terminale 1 (Backend):** `python -m uvicorn app.main:app --host 0.0.0.0 --port 8000`
- **Terminale 2 (Frontend):** `npm run dev -- --host`

---

## 4. Configurare il Firewall (Windows Server)

Questo è lo scoglio principale. Anche se hai esposto i server, il Firewall di Windows bloccherà i colleghi che tentano di connettersi. Devi creare due regole per aprire le porte in entrata.

1. Sul Server, apri il menu Start e cerca **"Windows Defender Firewall con sicurezza avanzata"**.
2. Nel menu a sinistra, clicca su **Regole in entrata (Inbound Rules)**.
3. Nel menu a destra, clicca su **Nuova regola...**
4. Seleziona **Porta** e clicca su Avanti.
5. Scegli **TCP** e, in "Porte locali specifiche", scrivi: `8000, 5173` (le porte del Backend e del Frontend).
6. Clicca Avanti, seleziona **Consenti la connessione**.
7. Clicca Avanti (lascia spuntati Dominio, Privato, Pubblico).
8. Dai un nome alla regola (es. "Gantt App Ports") e clicca **Fine**.

---

## 5. Fatto! Come accedere dai PC dei colleghi

Adesso il server è configurato e in ascolto.

1. Avvia l'applicazione sul Server (tramite il tuo script `./start.sh` aggiornato).
2. Chiunque, da qualsiasi computer connesso al WiFi o alla rete LAN dell'azienda, dovrà semplicemente aprire **Chrome**, **Edge** o **Firefox**.
3. Nella barra in alto, dovranno digitare:
   ```
   http://<IP-DEL-SERVER>:5173
   ```
   *(Esempio: `http://192.168.1.100:5173`)*

L'interfaccia si caricherà e tutte le operazioni verranno sincronizzate in tempo reale sul database del server centrale!

---

### 💡 Extra: Modalità Produzione (Per utenti avanzati)
Attualmente stiamo usando `npm run dev`, che va benissimo per piccoli team, ma non è il metodo più ottimizzato (il caricamento delle pagine è gestito da un server di sviluppo).
Per un utilizzo in produzione "reale":
1. Sul server, nella cartella `frontend`, esegui `npm run build`. Verrà creata una cartella `dist/`.
2. Puoi servire i file statici di quella cartella usando un web server vero e proprio come **Nginx**, **Apache** o **IIS di Windows**, facendolo girare sulla normale porta 80. In questo modo i colleghi dovranno digitare solo `http://192.168.1.100` senza il `:5173` finale.
