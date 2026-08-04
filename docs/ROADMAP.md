# Roadmap di HiPlan

Questo documento raccoglie le funzionalità candidate per le prossime versioni. Non descrive funzioni già disponibili e non costituisce una data di rilascio promessa.

## Criteri di priorità

Le proposte vengono valutate considerando:

- valore operativo per responsabili e addetti;
- riuso dei dati già presenti in HiPlan;
- riduzione di errori e attività manuali;
- complessità tecnica e impatto sul modello dati;
- possibilità di rilasciare la funzione per incrementi verificabili.

## Priorità 1 — prossimi incrementi

### Baseline e scostamenti

Salvare una fotografia approvata del piano e confrontarla con la situazione corrente.

Prima versione proposta:

- baseline di date e ore pianificate;
- scostamento in giorni e ore per fase;
- indicatori visivi nel Gantt e nel dettaglio commessa;
- riepilogo delle fasi in anticipo o in ritardo.

### Template completi di commessa

Creare o clonare un progetto con fasi, milestone, dipendenze, reparti, checklist e ore predefinite. I template di fase esistenti rimangono disponibili come componente più granulare.

### Ripianificazione delle dipendenze

Prima versione completata: l'agente propaga lo spostamento alle attività dipendenti tenendo conto di:

- tipo e ritardo della dipendenza;
- giorni lavorativi;
- ferie degli addetti;
- limiti temporali della commessa.

La funzione conserva motivazione, soluzione e snapshot delle date, invia notifiche e permette un rollback protetto. Come evoluzione rimane un'anteprima grafica interattiva prima dell'applicazione.

### Timesheet con approvazione

Evolvere la consuntivazione già disponibile introducendo:

- invio settimanale delle ore;
- stato bozza, inviato, approvato o respinto;
- approvazione da parte del responsabile;
- motivazione delle correzioni;
- report previsto/consuntivo per commessa e addetto.

### Ricerca globale

Ricercare da un unico punto commesse, fasi, ticket, TODO, note, commenti e allegati, rispettando i permessi della risorsa originale.

## Priorità 2 — controllo operativo

### Percorso critico

Calcolare e visualizzare le attività che determinano la data finale del progetto, con margine totale e impatto stimato dei ritardi.

### Simulatore di capacità

Creare scenari temporanei per verificare l'effetto di spostamenti e assegnazioni senza modificare il piano pubblicato. Il risultato dovrebbe riutilizzare la heatmap esistente.

### Regole automatiche

Esempi:

- alla chiusura di una fase, notificare il reparto successivo;
- quando una milestone si avvicina, creare un TODO;
- in caso di sovraccarico o conflitto ferie, avvisare il responsabile;
- al completamento del progetto, generare un export finale.

### Registro rischi e richieste di modifica

Gestire rischi, problemi e variazioni approvate con responsabile, probabilità, impatto, azioni, motivazione e collegamento alla commessa.

### Attività ricorrenti

Generare TODO, ticket o fasi periodiche per manutenzioni, controlli e appuntamenti ripetitivi.

## Priorità 3 — evoluzione del prodotto

### Costi e marginalità

Affiancare alle ore una tariffa per addetto o reparto, mantenendo separati budget economico, costo previsto, costo consuntivo e margine.

### Materiali e acquisti

Collegare materiali, fornitori, ordini e date di consegna alle fasi che dipendono dalla disponibilità dei componenti.

### Portale cliente

Area separata e a permessi ridotti per consultare avanzamento, milestone e documenti e per approvare consegne o richieste.

### Applicazione installabile e modalità campo

Evoluzione PWA ottimizzata per smartphone e tablet, con acquisizione di foto, note vocali e firma. L'eventuale modalità offline richiede una strategia esplicita di sincronizzazione e risoluzione dei conflitti.

### Integrazioni

Connettori con calendari, email, ERP e archivi documentali. Ogni integrazione dovrà specificare dati sincronizzati, direzione del flusso e gestione degli errori.

### Funzioni assistite dall'AI

Possibili casi d'uso:

- riepilogo automatico dello stato della commessa;
- individuazione di ritardi e rischi;
- bozza di una pianificazione partendo da una descrizione;
- trasformazione di ticket risolti in procedure operative.

Le proposte AI dovranno sempre mantenere revisione umana, tracciabilità delle modifiche e protezione dei dati aziendali.

## Sequenza di rilascio consigliata

1. Definizione del modello baseline e delle regole di calcolo degli scostamenti.
2. Template completi di commessa, utili anche per creare dati di test ripetibili.
3. Anteprima della ripianificazione automatica.
4. Workflow di approvazione delle ore.
5. Indice di ricerca globale.

Ogni funzionalità dovrebbe essere accompagnata da criteri di accettazione, migrazione dati, test backend, verifica della build frontend e aggiornamento della guida utente.
