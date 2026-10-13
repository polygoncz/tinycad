---
type: question
status: open
area: "[[06-geometricke-jadro]]"
decide_by: "[[M07-kernel-occt]]"
proposal: "Spike; začít předpřipraveným buildem"
decision: ""
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-12
---
# Q012 Volba WASM buildu OCCT

**Oblast:** [[06-geometricke-jadro]] · **Rozhodnout do:** [[M07-kernel-occt]]

## Otázka

Který WASM build OpenCascade použít?

## Možnosti a návrh

| Varianta | Pro | Proti |
|---|---|---|
| `opencascade.js` | rychlý start, celé API | velký soubor, pomalý vývoj, upovídané volání z TS |
| `replicad-opencascadejs` | menší, udržovaný | jen podmnožina API |
| vlastní C++ modul (Emscripten + embind) | úzké API přesně podle portu, logika v C++ | složitý build OCCT |

Návrh: spike na začátku [[M07-kernel-occt]], výsledek zapsat jako ADR 0009. Viz také [[Geometrická jádra – přehled]].

## Rozhodnutí

_(Až se rozhodne: vyplnit sem, nastavit `status: answered` a `decision`, rozhodnutí propsat do [[06-geometricke-jadro]]. Zásadní rozhodnutí → nové ADR.)_
