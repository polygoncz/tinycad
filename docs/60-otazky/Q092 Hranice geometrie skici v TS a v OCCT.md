---
type: question
status: open
area: "[[12-skicar]]"
decide_by: "[[M30-geometrie-skici-v-occt]]"
proposal: ""
decision: ""
tags:
  - otazka
created: 2026-10-16
updated: 2026-10-16
---
# Q092 Hranice geometrie skici v TS a v OCCT

**Oblast:** [[12-skicar#Oblasti (profily)]], [[06-geometricke-jadro]], [[0028-geometrie-skici-v-jadre|ADR 0028]] · **Rozhodnout do:** [[M30-geometrie-skici-v-occt]]

## Otázka

[[0028-geometrie-skici-v-jadre|ADR 0028]] přesouvá topologii skici do OCCT, ale synchronní odpovědi pod kurzorem nechává v TS. Kde přesně vede hranice?

1. **Oblasti během editace:** `interaction` je bere z artefaktu poslední regenerace. Během tažení bodu se vyplnění opozdí – vadí to, nebo se při tažení vyplnění skryje?
2. **Trim pod kurzorem ([[M33-trim-extend-split|M33]]):** náhled úseku, který se odstraní, potřebuje průsečíky okamžitě. Načíst průsečíky z jádra jednou při aktivaci nástroje (a po každé změně), nebo je počítat v TS jen pro náhled?
3. **Snapper:** průsečíky křivek pro přichycení – TS (dnes), nebo předpočítané z jádra?
4. **Nové volání jádra mimo regeneraci:** nástroj skicáře volá jádro přímo (přes port v `interaction`), nebo jen přes regeneraci a artefakt? Dnes `interaction` jádro nezná.
5. `sketch/regions.ts`: zachovat jako orákulum v testech, nebo archivovat?

## Možnosti a návrh

_(Doplnit při startu M30.)_

## Rozhodnutí
