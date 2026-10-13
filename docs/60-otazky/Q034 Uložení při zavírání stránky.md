---
type: question
status: answered
area: "[[05-persistence]]"
decide_by: "[[M04-persistence]]"
proposal: "Služba nabízí jen flush(), na události prohlížeče ji napojí app"
decision: "PersistenceService nezná DOM; pagehide a visibilitychange napojí app na flush()"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q034 Uložení při zavírání stránky

**Oblast:** [[05-persistence]] · **Rozhodnout do:** [[M04-persistence]]

## Otázka

Spec 05 říkala, že `PersistenceService` poslouchá `visibilitychange` a `pagehide` a volá `flush()`. Služba ale leží v modulu `persistence`, tedy v prstenci 1 bez DOM ([[0009-platformove-nezavisla-domena|ADR 0009]]). Kdo má tyto události poslouchat?

## Možnosti a návrh

1. **`app` (kompoziční kořen)** poslouchá události prohlížeče a volá `service.flush()`.
   - \+ Služba zůstane čistá a testovatelná v Node, prstenec 1 se nemění.
   - − Jeden řádek napojení navíc v `app`, na který se dá zapomenout.
2. **Služba dostane v `deps` abstraktní zdroj události** (`onPageHide(fn)`).
   - \+ Nedá se zapomenout.
   - − Abstrakce kvůli jednomu volání.
3. **Výjimka z pravidla** a DOM v `persistence`.
   - − Rozbije typovou kontrolu prstence 1.

Návrh: **1**, viz [[Kompoziční kořen|kompoziční kořen]].

## Rozhodnutí

2026-10-13: **Varianta 1.** `PersistenceService` nabízí jen `flush()`, na `pagehide` a `visibilitychange` (hidden) ho napojí `app` (M10). Propsáno do [[05-persistence#Služba na hlavním vlákně]] a [[01-architektura#Kompoziční kořen]].
