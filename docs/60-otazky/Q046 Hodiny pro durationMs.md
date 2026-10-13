---
type: question
status: answered
area: "[[07-regenerace]]"
decide_by: "[[M06-regenerace]]"
proposal: "createRegenerator dostane volitelné now: () => number, výchozí performance.now"
decision: "povinná závislost now z app (upřesněno revizí M6)"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q046 Hodiny pro durationMs

**Oblast:** [[07-regenerace]] · **Rozhodnout do:** [[M06-regenerace]]

## Otázka

`RegenResult.durationMs` potřebuje hodiny. Doménový prstenec nemá DOM ([[0009-platformove-nezavisla-domena|ADR 0009]]) a testy chtějí deterministický čas.

## Možnosti a návrh

1. **Volitelná závislost `now: () => number`** v `createRegenerator(deps)`, výchozí `performance.now` (je v Node i v prohlížeči, typově přes `globalThis`).
   - \+ Testy dosadí falešné hodiny.
2. **Přímo `performance.now()`.**
   - − Netestovatelné.

Návrh: **1**.

## Rozhodnutí

2026-10-13: Pavel souhlasí s návrhem (varianta 1). Propsáno do [[07-regenerace]].

> **Upřesnění (2026-10-13, revize architektury M6):** `now` je **povinná** závislost bez výchozí hodnoty. Prstenec 1 tak nesahá na globální objekt (`globalThis.performance`) a odpadá přetypování; hodiny dodá `app` jako ostatní platformní služby ([[0009-platformove-nezavisla-domena|ADR 0009]]).
