---
type: question
status: answered
area: "[[06-geometricke-jadro]]"
decide_by: "[[M07-kernel-occt]]"
proposal: "Spike; začít předpřipraveným buildem"
decision: "replicad-opencascadejs 1.1.0; mapy podtvarů explorerem + IsSame; vlastní build v M16"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-13
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

Návrh: spike na začátku [[M07-kernel-occt]], výsledek zapsat jako ADR (původně uvedeno 0009, to číslo mezitím dostalo jiné ADR; výsledek je [[0013-replicad-opencascadejs|ADR 0013]]). Viz také [[Geometrická jádra – přehled]].

## Rozhodnutí

2026-10-13: **`replicad-opencascadejs` 1.1.0** (přesně připnutá verze). Spike ve `spikes/m07-occt/` ověřil kvádr, `AddOptimal`, tessellaci, hrany, historii booleanu, STEP, výjimky, `using` a běh ve Vite workeru. Build nemá svázané `TopExp::MapShapes` ani `IndexedMap`, mapy podtvarů proto adaptér počítá explorerem s `IsSame` (stejné pořadí jako OCCT). `opencascade.js` zamítnut (od 2023 stojí, 2× větší, 20× pomalejší start). Vlastní C++ build je samostatný milník [[M16-vlastni-occt-build]]. Podrobně v [[0013-replicad-opencascadejs|ADR 0013]], propsáno do [[06-geometricke-jadro#Volba WASM buildu OCCT (spike v M7)|spec 06]].
