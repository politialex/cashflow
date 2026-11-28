# Cashflow Studio

Cashflow Studio è una board visuale per disegnare i propri flussi finanziari e simulare la disponibilità sui conti nei mesi successivi. Importi e tassi sono ipotesi inserite dall’utente. L’app lavora in euro e salva la board nel browser.

[Apri Cashflow Studio](https://politialex.github.io/cashflow/)

## Costruisci uno scenario

La board occupa l’intera finestra. A sinistra trovi tutti gli elementi e a destra i dettagli della selezione. La barra flottante apre la simulazione e contiene i comandi principali. Su schermi piccoli, apri i pannelli dai pulsanti dedicati.

1. Aggiungi un nodo per ciascun elemento che vuoi seguire, come un conto, un deposito, un investimento, una fonte di reddito o una spesa. Inserisci il flusso mensile con il segno + per le entrate e − per le uscite. I conti includono saldo iniziale e rendimento.
2. Collega due elementi trascinando uno dei quattro punti sul bordo del primo nodo fino al secondo. I trasferimenti tra conti possono avere un importo fisso o una percentuale delle entrate. Il motore ricava l’ordine dal grafo.
3. Apri la simulazione, scegli un orizzonte da 1 a 120 mesi e usa il selettore per leggere il risultato di ogni mese. La board mostra entrate, uscite e disponibilità al termine del primo mese.

Trascina lo sfondo per spostarti e usa la rotellina o i pulsanti **+** e **−** per lo zoom. Nei controlli in basso a destra, **Adatta** inquadra tutta la board e diventa **Centra** quando selezioni nodi o collegamenti. **Schermo intero** apre la modalità del browser, da cui puoi uscire con lo stesso pulsante o con Esc. I nodi si agganciano automaticamente alla griglia. Un doppio click su un nodo o una freccia apre l’editor rapido. Il tasto Canc elimina la selezione, mentre Ctrl/Cmd+Z e Ctrl/Cmd+Y annullano e ripristinano le modifiche.

Usa **Maiusc+clic** per aggiungere o togliere un nodo dalla selezione, oppure **Maiusc+trascina** sullo sfondo per disegnare un rettangolo. Da tastiera, sposta il focus sul nodo e usa **Maiusc+Invio** o **Maiusc+Spazio**. Trascina uno dei nodi selezionati o usa i tasti freccia sul nodo focalizzato per spostare tutto il gruppo. Ogni spostamento è una singola operazione di annullamento. **Esc** deseleziona. I dettagli e il comando Canc si riferiscono al nodo attivo del gruppo.

Lo scenario di esempio separa lo stipendio tra un conto principale, un conto per le spese e un deposito con rendimento annuo del 2%.

### Regole della simulazione

- Ogni mese il motore parte dal saldo precedente, registra i flussi esterni e applica i trasferimenti seguendo la direzione dei collegamenti. Ogni collegamento viene eseguito al massimo una volta nel mese, anche se la board contiene un ciclo.
- La percentuale si applica agli accrediti ricevuti dal nodo nel mese. Il trasferimento annuale parte nei mesi 1, 13, 25 e così via. Il trasferimento una tantum avviene nel mese 1.
- Dopo i flussi, il saldo positivo riceve il rendimento mensile composto equivalente al tasso annuo. Gli importi vengono arrotondati al centesimo. I trasferimenti fissi possono generare saldi negativi, visibili nella board e nella simulazione.
- Imposte, commissioni, volatilità e conversioni di valuta richiedono ipotesi esterne. Le categorie dei nodi aiutano a organizzare lo scenario e usano le stesse regole di calcolo.

Cashflow Studio salva le modifiche alla board in IndexedDB, con ripiego su localStorage quando IndexedDB non è disponibile. Al primo avvio importa il salvataggio precedente dello stesso sito. L’inquadratura si conserva separatamente.

Usa **Download e backup** nella barra verticale per scaricare un JSON della board o per scegliere un file e ripristinarlo. Il file resta sul dispositivo e contiene gli importi e i dati della board. Il ripristino sostituisce la board dopo la convalida del file e azzera la cronologia di annullamento della sessione. Un backup invalido lascia intatta la board. Puoi scaricare il backup dell’ultima board aperta anche se il browser blocca il salvataggio automatico.

## Tabella e valuta di visualizzazione

**Vista tabella** apre saldi e movimenti. La tabella segue la data e l’ordine dei collegamenti usati dal motore. La modalità **Privacy** oscura gli importi anche qui.

Il selettore della valuta mostra stime in USD o GBP con un tasso fisso scelto per lo scenario. Gli editor, i calcoli e i backup in JSON usano EUR. Con Privacy attiva, il dialog di backup segnala che il file scaricato contiene dati in chiaro.

## Avvio locale e verifiche

Dalla radice del repository, con Node.js 24 o successivo e npm:

```sh
npm ci
npm start
```

Apri http://127.0.0.1:3000. Il server accetta le variabili facoltative `HOST` e `PORT`.

```sh
npm run lint
npm test
npm run build
```

La build produce gli asset statici in `dist/`. Per verificarla, avvia `npm start -- dist` dopo aver arrestato il server di sviluppo.

## Pubblicazione

GitHub Pages serve `main` dalla radice del repository. Il workflow di release parte dal tag corrispondente alla versione npm. La pagina [Releases](https://github.com/politialex/cashflow/releases) offre uno ZIP per un server statico e un pacchetto npm eseguibile.

Per avviare la v3.3.0 scarica il file `.tgz` della release ed esegui:

```sh
npm exec --package=./politialex-cashflow-studio-3.3.0.tgz -- cashflow-studio
```

Il pacchetto è disponibile anche in [GitHub Packages](https://github.com/politialex/cashflow/pkgs/npm/cashflow-studio) nell’ambito `@politialex`. Per installarlo dal registro serve un account autorizzato e configurato per `https://npm.pkg.github.com`.
