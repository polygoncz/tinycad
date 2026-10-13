---
type: question
status: answered
area: "[[01-architektura]]"
decide_by: "[[M08-vykreslovani]]"
proposal: "interaction re-exportuje typ BodyId jako součást portu"
decision: "interaction re-exportuje typ BodyId, render ho bere odtud"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q056 Odkud render bere BodyId

**Oblast:** [[01-architektura]] · **Rozhodnout do:** [[M08-vykreslovani]]

## Otázka

`BodyId` ([[Těleso]]) je definovaný v `document` (`refs.ts`). `render` ho potřebuje v `BodyLayer.sync` a v `PickResult`, ale podle tabulky v [[01-architektura]] smí importovat jen `core`, typy z `kernel` a typy portu z `interaction`. Odkud ho má vzít?

## Možnosti a návrh

1. **`interaction` re-exportuje typ `BodyId`** jako součást portu ([[0009-platformove-nezavisla-domena|ADR 0009]]).
   - \+ Žádná nová hrana v grafu závislostí. `PickResult` v portu `BodyId` stejně obsahuje, takže patří ke slovníku portu.
   - − Typ má dva vstupní body (`document` a `interaction`).
2. **Přesunout `BodyId` do `core`.**
   - \+ Jedno místo.
   - − `core` by znal doménový pojem z dokumentu, který do základních stavebních kamenů nepatří.
3. **`render` pracuje s obecným `string`.**
   - − Ztratí se značkovaný typ a s ním kontrola překladačem.

Návrh: **1**.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1.** `interaction/index.ts` exportuje `export type { BodyId } from '@/document'`, `render` ho importuje jen jako typ z `@/interaction`. Propsáno do [[01-architektura]] (řádek `render`) a [[10-interakce]].
