---
type: question
status: answered
area: "[[06-geometricke-jadro]]"
decide_by: "[[M10-ui]]"
proposal: "Zatím jen zahodit výsledek"
decision: "Zatím bez rušení operace jádra; RegenScheduler s dirty flagem a zahazování zastaralých výsledků. Ověřit v M10 tažením hodnoty."
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-13
---
# Q010 Zrušení probíhající operace jádra

**Oblast:** [[06-geometricke-jadro]] · **Rozhodnout do:** [[M10-ui]]

## Otázka

Rušit probíhající operaci v [[Geometrické jádro|jádře]], když uživatel mezitím změní parametr?

## Možnosti a návrh

Zatím ne – výsledek zastaralé regenerace se jen zahodí (generace). Později možný „cancel token“ kontrolovaný mezi operacemi. Ověřit v M10, jestli je to při tažení posuvníku problém.

## Rozhodnutí

2026-10-13 (Pavel): **zatím ne.** Stačí `RegenScheduler` (dirty flag, žádná fronta) a zahazování výsledku zastaralé regenerace. V [[M10-ui]] ověřit v prohlížeči rychlou změnou hodnoty; když to nebude problém, cancel token se nezavádí. Propsáno do [[11-ui]].

**Ověřeno 2026-10-13 ([[M10-ui]], Ú12):** 50 změn výšky kvádru za 2 ms → dialog i UI plynulé, poslední regenerace 3 ms a výsledek odpovídá poslední hodnotě. Cancel token se nezavádí; přehodnotit, až budou operace jádra trvat stovky ms (booleany, zaoblení).
