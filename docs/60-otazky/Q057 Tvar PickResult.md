---
type: question
status: answered
area: "[[10-interakce]]"
decide_by: "[[M08-vykreslovani]]"
proposal: "Zdrojem pravdy spec 10, přidat normal, vertex odložit"
decision: "Spec 10 zdrojem pravdy; face má normal, varianta vertex až s potřebou"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q057 Tvar PickResult

**Oblast:** [[10-interakce]] · **Rozhodnout do:** [[M08-vykreslovani]]

## Otázka

`PickResult` je popsaný dvakrát a liší se: [[09-vykreslovani]] má u plochy navíc `normal` a variantu `vertex`, [[10-interakce]] ne. Který tvar platí?

## Možnosti a návrh

1. **Zdrojem pravdy je spec 10** (typ definuje `interaction`, [[0009-platformove-nezavisla-domena|ADR 0009]]), spec 09 na něj jen odkazuje.
   - `normal` u plochy přidat: raycast ji dává zadarmo a bude potřeba pro skicu na ploše ([[12-skicar]]).
   - `vertex` odložit: kvádr výběr vrcholů nepotřebuje a `MeshData` vrcholy topologie zatím nenese.
2. **Převzít tvar ze spec 09 celý**, včetně `vertex`.
   - − Varianta, kterou `render` neumí naplnit, je mrtvý kód.

Návrh: **1**.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1.** `PickResult` = `face` (`body`, `faceIndex`, `point`, `normal`) | `edge` (`body`, `edgeIndex`, `point`). Definice jen v [[10-interakce]], [[09-vykreslovani]] odkazuje.
