---
type: question
status: open
area: "[[04-operace-a-historie]]"
decide_by: "[[M03-operace]]"
proposal: "Začít s batch"
decision: ""
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-12
---
# Q005 Komprese transakce add a setParams

**Oblast:** [[04-operace-a-historie]] · **Rozhodnout do:** [[M03-operace]]

## Otázka

Slučovat při commitu [[Transakce|transakce]] `feature.add` + `feature.setParams` téže featury do jediného `feature.add`?

## Možnosti a návrh

- Obecný kompresor, který zná vztah dvou typů operací.
- Jen `batch` a hotovo.

Návrh: začít s `batch`, kompresi přidat, až bude log v ladění nepřehledný.

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do [[04-operace-a-historie]]. Zásadní rozhodnutí → nové ADR.)_
