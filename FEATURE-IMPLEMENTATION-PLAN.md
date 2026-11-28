# Cashflow Studio — Piano delle funzionalità

Ultimo aggiornamento: 24 novembre 2026.

Questo documento trasforma le idee di prodotto in un piano eseguibile. Deve essere usato come riferimento per creare milestone e issue in Linear, discutere le scelte ancora aperte e implementare le funzionalità senza introdurre modelli dati incompatibili tra loro.

## Principi di esecuzione

1. Conservare la board come interfaccia principale.
2. Non compromettere pan, zoom, snap alla griglia, collegamenti, modifica rapida e simulazione esistenti.
3. Trattare importi, frequenze e date con un unico modello temporale.
4. Implementare prima le fondamenta condivise e poi le funzioni che ne dipendono.
5. Accompagnare ogni modifica al motore finanziario con test unitari.
6. Verificare ogni interazione della canvas su desktop e mobile.
7. Decisione 28 novembre 2026 (BIT-198): migrare a React con Mantine partendo dal catalogo UI e dai token condivisi in `ui-lab/`. Usare React Bits selettivamente nel prodotto dopo verifica di licenza, accessibilità e performance; non duplicare componenti o riscrivere il motore finanziario. Validare le fondamenta prima della migrazione delle schermate.

## Definizione degli effort

- **Low**: modifica isolata, senza migrazione dati e con rischio contenuto.
- **Medium**: coinvolge più componenti o richiede una piccola estensione del modello dati.
- **High**: cambia architettura, persistenza o modello finanziario e richiede una decisione di prodotto preliminare.

## Milestone 1 — Polish & Quick Wins

Queste attività possono essere pianificate indipendentemente.

### Verificare Noto Sans e la nitidezza — Low

**Stato**: completato in v3.3.0 con Noto Sans per i testi e Noto Sans Mono per i valori.

**Obiettivo**: capire se Noto Sans migliora la leggibilità residua della board.

**Istruzioni**:

- confrontare Noto Sans e il font corrente allo zoom 75%, 100% e 125%;
- verificare canvas, pannelli, input e valori monetari;
- evitare il caricamento remoto del font se peggiora prestazioni o privacy;
- adottare il font solo se il confronto visivo mostra un miglioramento reale.

**Criteri di accettazione**:

- nessun testo tagliato o sovrapposto;
- valori monetari leggibili a tutti gli zoom supportati;
- assenza di regressioni nei layout desktop e mobile.

### Mostrare il valore assoluto sulle frecce — Low

**Stato**: completato in v3.3.0.

**Obiettivo**: semplificare le etichette dei trasferimenti.

**Istruzioni**:

- mostrare un solo importo senza segni `+` o `−`;
- usare la punta della freccia per comunicare la direzione;
- mantenere formato valuta e frequenza, quando rilevante.

**Criterio di accettazione**: ogni collegamento presenta un solo valore assoluto e la direzione rimane inequivocabile.

### Uniformare i border radius — Low

**Stato**: completato in v3.3.0.

**Obiettivo**: usare un raggio massimo di 4 px in tutta l'interfaccia.

**Istruzioni**: aggiornare nodi, pannelli, pulsanti, input, dialog, popover, toolbar e stati vuoti.

**Criterio di accettazione**: nessun componente applicativo supera `4px`, esclusi indicatori intenzionalmente circolari.

### Colorare gli importi positivi e negativi — Low

**Stato**: completato in v3.3.0.

**Obiettivo**: rendere immediato lo stato dei conti.

**Istruzioni**:

- verde accessibile per importi positivi;
- rosso accessibile per importi negativi;
- colore neutro per zero;
- non affidarsi esclusivamente al colore: conservare sempre il segno numerico.

**Criterio di accettazione**: la regola è applicata ai nodi finanziari non duotone e ai riepiloghi pertinenti.

### Rendere visibili i confini della board — Low

**Stato**: completato in v3.3.0 per la parte visiva.

**Obiettivo**: comunicare chiaramente l'area utilizzabile.

**Istruzioni**: mostrare bordo e area esterna senza interferire con griglia, pan o zoom.

**Nota**: impedire realmente agli elementi di oltrepassare il confine è una issue Medium separata.

### Migliorare la fluidità percepita — Low / Medium

**Stato**: prima iterazione completata in v3.3.0 con micro-transizioni e reduced motion.

**Obiettivo**: rendere selezione, apertura pannelli, drag e toolbar più fluidi.

**Istruzioni**:

- usare transizioni brevi tra 120 e 180 ms;
- animare `transform` e `opacity` quando possibile;
- rispettare `prefers-reduced-motion`;
- applicare i token di movimento del catalogo React; evitare una migrazione motivata soltanto da effetti decorativi.

## Milestone 2 — Flow Model v2

Questa milestone è la fondazione per frequenze, spese una tantum, simulazioni temporali e scenari.

### Introdurre un modello temporale unico — Medium / High

Ogni flusso deve poter rappresentare almeno:

```text
amount
frequency
startMonth
endMonth opzionale
occurrences opzionale
```

Le frequenze iniziali consigliate sono:

- mensile;
- annuale;
- una tantum;
- ogni N mesi.

Il motore deve convertire ogni evento in movimenti mensili senza perdere l'importo originale inserito dall'utente.

**Decisione richiesta**: uno stipendio annuale deve essere distribuito in dodici quote oppure accreditato in mesi specifici? Il modello dovrebbe supportare entrambe le modalità, anche se la prima release ne espone una sola.

**Criteri di accettazione**:

- test per tutte le frequenze;
- arrotondamento monetario deterministico;
- compatibilità o migrazione dei dati salvati esistenti;
- simulazione coerente su almeno 24 mesi.

### Supportare una spesa una tantum — Medium

**Dipendenza**: modello temporale unico.

**Istruzioni**: permettere di scegliere il mese dell'addebito tramite month picker e applicare la spesa una sola volta nelle simulazioni.

### Dividere una spesa tra più persone — Low / Medium

Memorizzare:

```text
totalAmount
participantCount
personalShare
```

`personalShare` deve essere calcolata dal sistema e usata nel flusso personale. La card deve mostrare chiaramente totale, partecipanti e quota applicata.

## Milestone 3 — Canvas Interactions v2

### Selezione multipla e spostamento di gruppo — Medium

**Istruzioni**:

- supportare `Shift+click` e rettangolo di selezione;
- mostrare stato selezionato su tutti i nodi coinvolti;
- trascinare il gruppo conservando le distanze relative;
- applicare snap alla griglia al gruppo;
- permettere `Esc` per deselezionare.

**Criteri di accettazione**: undo e redo trattano lo spostamento come una singola operazione.

### Collegare trascinando un nodo sopra un altro — Medium

**Istruzioni**:

- mostrare una destinazione valida durante il drag;
- creare il collegamento al rilascio;
- impedire auto-collegamenti e duplicati;
- non collegare accidentalmente durante un normale riposizionamento.

**Decisione richiesta**: definire gesto, soglia temporale o tasto modificatore che distingua spostamento e collegamento.

### Creare un nodo da una freccia rilasciata nel vuoto — Medium

**Istruzioni**:

- conservare origine, direzione e posizione finale;
- aprire il selettore dei tipi di nodo vicino al punto di rilascio;
- collegare automaticamente il nodo appena creato;
- annullare senza lasciare collegamenti incompleti.

### Riconnettere le estremità di una freccia — High

**Istruzioni**:

- trascinando la metà iniziale si modifica l'origine;
- trascinando la metà finale si modifica la destinazione;
- mostrare preview e destinazioni valide;
- mantenere invariati importo, frequenza e metadati;
- integrare undo e redo.

### Impedire agli elementi di uscire dalla board — Medium

Applicare i limiti durante drag singolo, drag multiplo, creazione, auto-layout e ripristino dei dati salvati.

## Milestone 4 — Information Architecture

### Raggruppare il pannello sinistro per conto — Medium

**Istruzioni**:

- creare un accordion per ogni conto principale;
- mostrare sotto ogni conto entrate e uscite collegate;
- prevedere sezioni per elementi non collegati e nodi condivisi;
- non duplicare un nodo senza indicare che è un riferimento allo stesso elemento.

### Aggiungere il provider ai nodi — Medium

Prima fase:

- nome provider;
- categoria;
- sigla o avatar generato localmente;
- visualizzazione compatta nella card.

Fase successiva separata:

- ricerca del logo;
- cache e fallback;
- verifica di licenze, disponibilità e privacy della fonte dati.

## Milestone 5 — Scenario Planning

### Portare la simulazione sulla canvas — High

**Istruzioni**:

- usare esclusivamente month picker;
- mostrare un mese iniziale e uno finale;
- permettere `+ Simula periodo` per aggiungere confronti;
- non alterare i dati dello scenario corrente;
- rappresentare chiaramente valori correnti e simulati.

**Decisione richiesta**: scegliere tra sovrapposizione sui nodi, duplicazione visuale temporanea o modalità timeline della canvas.

### Supportare scenari multipli — High

Funzioni minime:

- crea;
- duplica;
- rinomina;
- elimina con conferma;
- cambia scenario;
- confronta due scenari;
- conserva separatamente board e simulazioni.

### Esplorare scenari collegati — Discovery / High

Non implementare prima di definire quale relazione rappresentano:

- scenario derivato da un altro;
- transizione temporale;
- ereditarietà delle modifiche;
- semplice confronto;
- dipendenza tra eventi.

Produrre prima una decisione scritta con esempi e comportamento atteso.

## Milestone 6 — Product Research

### Calcolo lordo-netto italiano — Discovery / High

Prima dell'implementazione definire:

- tipologie di rapporto supportate;
- contributi e imposte considerate;
- detrazioni;
- addizionali regionali e comunali;
- tredicesima e quattordicesima;
- anno fiscale e strategia di aggiornamento;
- disclaimer e limiti di accuratezza.

La prima versione dovrebbe essere dichiaratamente orientativa e basata su fonti normative verificabili.

## Ordine consigliato

1. Quick wins indipendenti.
2. Modello temporale unico.
3. Frequenze, spese una tantum e divisione spese.
4. Selezione multipla e interazioni canvas.
5. Simulazione temporale sulla canvas.
6. Scenari multipli.
7. Discovery su scenari collegati e lordo-netto.

## Discussione di prodotto — 27 novembre 2026

La sessione dovrebbe chiudere almeno queste decisioni:

1. Semantica di un importo annuale e mesi di erogazione.
2. Gesto per collegare due nodi durante il trascinamento.
3. Rappresentazione della simulazione sulla canvas.
4. Struttura e confronto degli scenari.
5. Significato di scenario collegato.
6. Perimetro accettabile del calcolo lordo-netto italiano.
7. Origine e trattamento dei loghi provider.

## Struttura delle issue Linear

Creare le milestone indicate sopra nel progetto Cashflow Studio. Ogni funzionalità di secondo livello deve diventare una issue separata con:

- titolo orientato al risultato;
- descrizione e motivazione;
- effort `Low`, `Medium`, `High` o `Discovery`;
- dipendenze esplicite;
- criteri di accettazione verificabili;
- test richiesti;
- stato iniziale `Backlog`;
- collegamento alla relativa issue o pull request GitHub quando lo sviluppo inizia.

Non creare issue aggregate che combinino motore finanziario, interazione canvas e stile nella stessa attività.

## Definition of Done

Una funzionalità è completata quando:

- i criteri di accettazione sono soddisfatti;
- lint, build e test terminano correttamente;
- i nuovi calcoli hanno test unitari;
- l'interazione è verificata nel browser;
- desktop e mobile non presentano regressioni;
- README o documentazione sono aggiornati quando necessario;
- issue Linear e attività GitHub sono collegate e aggiornate.
