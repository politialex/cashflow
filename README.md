# Cashflow Studio

Cashflow Studio è un registro personale di entrate e uscite in euro. La dashboard mostra il saldo complessivo, i totali del mese selezionato e un grafico di entrate e uscite per i sei mesi che terminano con quello selezionato.

## Avvio locale

Dalla radice del repository, con Node.js 24 o successivo e npm:

```sh
npm ci
npm start
```

Apri http://127.0.0.1:3000. Registra un movimento con data, descrizione, categoria e importo. Puoi modificarlo o eliminarlo dalla tabella del mese. L’importo accetta la virgola o il punto come separatore decimale.

L’app salva i dati nel browser per l’indirizzo da cui viene aperta. I dati sono disponibili dopo il ricaricamento della pagina e vengono rimossi se cancelli i dati del sito. L’app non richiede un account o un database.

## Verifica e build

```sh
npm run lint
npm test
npm run build
```

La build copia gli asset statici in `dist/`. Per verificare quella versione, arresta il server di sviluppo e avvia `npm start -- dist`. Il server accetta le variabili facoltative `HOST` e `PORT`.
