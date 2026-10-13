---
type: question
status: answered
area: "[[11-ui]]"
decide_by: "[[M10-ui]]"
proposal: "Jednoduchý seznam, bez routeru"
decision: "Jednoduchý seznam dokumentů bez routeru; id dokumentu v location.hash, prázdný hash = seznam."
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-13
---
# Q019 Úvodní obrazovka se seznamem dokumentů

**Oblast:** [[11-ui]] · **Rozhodnout do:** [[M10-ui]]

## Otázka

Úvodní obrazovka se seznamem dokumentů (jako Onshape „Documents“), nebo rovnou poslední dokument?

## Možnosti a návrh

Jednoduchý seznam v M10, router až bude potřeba.

## Rozhodnutí

2026-10-13 (Pavel): **jednoduchý seznam bez routeru.** Id otevřeného dokumentu je v `location.hash` (`#/d/<id>`), prázdný hash ukáže seznam (`DocumentList`, plovoucí list přes viewport). Propsáno do [[11-ui]].
