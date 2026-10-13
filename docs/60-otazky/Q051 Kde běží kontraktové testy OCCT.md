---
type: question
status: answered
area: "[[06-geometricke-jadro]]"
decide_by: "[[M07-kernel-occt]]"
proposal: "src/kernel-occt/*.test.ts v projektu unit, tedy v npm run check"
decision: "src/kernel-occt/*.test.ts v projektu unit"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q051 Kde běží kontraktové testy OCCT

**Oblast:** [[06-geometricke-jadro]] · **Rozhodnout do:** [[M07-kernel-occt]]

## Otázka

[[06-geometricke-jadro#Testy|Spec 06]] umisťuje kontraktovou sadu pro OCCT do `tests/kernel-occt/`, tedy do projektu Vitestu `integration`. `npm run check` ale spouští jen projekt `unit`, takže by se kontrakt OCCT mohl rozbít, aniž by to `check` poznal. Předpoklad „OCCT je pomalé“ spike nepotvrdil: inicializace WASM v Node trvá ~100 ms ([[0013-replicad-opencascadejs|ADR 0013]]).

## Možnosti a návrh

| Varianta | Pro | Proti |
|---|---|---|
| **A: `src/kernel-occt/*.test.ts`** (projekt `unit`) | v `check`, testy vedle kódu jako všude jinde, test smí importovat interní `OcctKernelImpl` vlastního modulu bez `testing.ts` | unit testy načítají 23 MB WASM (~100 ms na soubor) |
| B: `tests/kernel-occt/` a `test:integration` přidat do `check` | odpovídá spec, jasné oddělení pomalých testů | `OcctKernelImpl` musí ven přes `kernel-occt/testing.ts`; `tests/` dependency-cruiser nehlídá |
| C: `tests/kernel-occt/` mimo `check` | nejrychlejší `check` | kontrakt OCCT se může tiše rozbít |

Návrh: **A**. Projekt `integration` zůstane pro skutečné end-to-end testy (worker v prohlížeči apod.). Modul OCCT se v testech načte jednou na soubor (`beforeAll`), `factory` kontraktové sady vytvoří jen novou instanci `OcctKernelImpl`.

## Rozhodnutí

2026-10-13: **Varianta A.** Kontraktová sada a testy adaptéru OCCT jsou v `src/kernel-occt/*.test.ts` a běží v `npm run check`. Modul OCCT se načte jednou na soubor (`beforeAll`), `factory` vytvoří novou instanci `OcctKernelImpl`. Projekt `integration` zůstává pro end-to-end testy. Propsáno do [[06-geometricke-jadro#Testy|spec 06]] a [[01-architektura]].
