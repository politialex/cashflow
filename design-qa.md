# Design QA

## Target

Canvas finanziario desktop ispirato ai riferimenti allegati: superficie scura puntinata, gerarchia tra card principali e nodi compatti, collegamenti curvi, pannelli laterali e toolbar flottante.

## Verifica

- Viewport desktop verificato a 1440 × 900.
- Viewport mobile verificato a 390 × 844.
- I conti, depositi, investimenti e risparmi sono card grandi con nome, disponibilità e rendimento.
- Entrate e spese sono nodi compatti con importo firmato.
- I collegamenti mostrano uscita e ingresso a colpo d’occhio.
- I nodi si collegano trascinando una porta, si spostano con snap alla griglia e sono modificabili con doppio click.
- Le frecce sono selezionabili e modificabili con doppio click.
- Pan, zoom, adattamento alla vista, simulazione e pannelli mobile sono funzionanti.
- Build, lint, test del motore e smoke test Chromium sono superati.

## Rifinitura Product Design

- Gerarchia tipografica e numerica rafforzata sulle card finanziarie.
- Pannelli laterali resi più discreti per lasciare centralità al canvas.
- Stati hover, focus e selezione armonizzati sul verde acido.
- Toolbar, zoom, dialog ed editor contestuale riallineati allo stesso sistema di superfici.
- Densità e contrasto verificati nei viewport desktop e mobile.

## Esito

final result: passed

## Direzione Framer / Figma — v3.2.0

- Palette riallineata al riferimento con canvas nero neutro, pannelli grafite e accento blu.
- Chrome compattato a 48 px, pannelli più densi e controlli con raggi ridotti.
- Rimossi gli effetti decorativi verdi e ridotte le ombre per ottenere un editor più tecnico.
- Nodi e collegamenti mantengono la codifica semantica dei tipi finanziari.
- Stato focus, selezione, modali e controlli flottanti condividono lo stesso linguaggio visivo.
