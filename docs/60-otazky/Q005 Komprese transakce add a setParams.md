---
type: question
status: answered
area: "[[04-operace-a-historie]]"
decide_by: "[[M03-operace]]"
proposal: "Začít s batch"
decision: "Jen batch, kompresi add + setParams zatím ne"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-13
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

2026-10-13: **jen `batch`.** Při commitu [[Transakce|transakce]] se slučují jen sousední operace téhož typu přes `merge` (v M3 jen `feature.setParams` téže featury). `feature.add` + `feature.setParams` zůstanou jako `batch`. Obecný kompresor přidáme, až bude log při ladění nepřehledný. Propsáno do [[04-operace-a-historie#Transakce]].
