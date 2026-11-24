# Cashflow Studio

Cashflow Studio è una board per disegnare i propri flussi finanziari e simulare la disponibilità sui conti nei mesi successivi. Importi e tassi sono ipotesi inserite dall’utente. L’app lavora in euro e salva la board nel browser.

[Apri Cashflow Studio](https://politialex.github.io/cashflow/)

## Costruisci uno scenario

La board occupa l’intera finestra. A sinistra trovi i nodi in ordine di flusso e la sequenza dei trasferimenti, a destra i dettagli della selezione. La barra flottante apre la simulazione e contiene i comandi per aggiungere nodi e trasferimenti. Su schermi piccoli, apri i pannelli dai pulsanti dedicati.

1. Aggiungi un nodo per ciascun elemento che vuoi seguire, come un conto, un deposito, un investimento, una riserva di liquidità o una fonte di reddito. Imposta saldo iniziale, entrate e uscite mensili esterne e rendimento annuo. Sposta i nodi con il mouse oppure selezionali e usa le frecce.
2. Aggiungi un collegamento per ogni trasferimento interno. Scegli origine, destinazione, valore fisso o percentuale e frequenza. L’ordine nell’elenco determina quando il trasferimento viene applicato rispetto agli altri.
3. Apri la simulazione, scegli un orizzonte da 1 a 120 mesi e usa il selettore per leggere il risultato di ogni mese. La board mostra entrate, uscite e disponibilità al termine del primo mese.

Lo scenario di esempio separa lo stipendio tra un conto principale, un conto per le spese e un deposito con rendimento annuo del 2%.

### Regole della simulazione

- Ogni mese il motore parte dal saldo del mese precedente, registra i flussi esterni e applica i trasferimenti nell’ordine dell’elenco. Ogni collegamento esegue al massimo un trasferimento nel mese, anche se la board contiene un ciclo.
- La percentuale si applica agli accrediti ricevuti dal nodo nel mese fino a quel punto. Per ripartire uno stipendio, metti il relativo accredito prima dei trasferimenti che lo usano. Il trasferimento annuale parte nei mesi 1, 13, 25 e così via. Il trasferimento una tantum avviene nel mese 1.
- Dopo i flussi, il saldo positivo riceve il rendimento mensile composto equivalente al tasso annuo. Gli importi vengono arrotondati al centesimo. I trasferimenti fissi possono generare saldi negativi, visibili nella board e nella simulazione.
- Imposte, commissioni, volatilità e conversioni di valuta richiedono ipotesi esterne. Le categorie dei nodi aiutano a organizzare lo scenario e usano le stesse regole di calcolo.

La v2 salva una board separata. Le registrazioni della v1 restano nel browser e possono essere consultate eseguendo il pacchetto v1 sullo stesso indirizzo da cui erano state inserite.

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

Per avviare la v2.1.1 scarica il file `.tgz` della release ed esegui:

```sh
npm exec --package=./politialex-cashflow-studio-2.1.1.tgz -- cashflow-studio
```

Il pacchetto è disponibile anche in [GitHub Packages](https://github.com/politialex/cashflow/pkgs/npm/cashflow-studio) nell’ambito `@politialex`. Per installarlo dal registro serve un account autorizzato e configurato per `https://npm.pkg.github.com`.
