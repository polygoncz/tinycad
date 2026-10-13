---
type: question
status: answered
area: "[[10-interakce]]"
decide_by: "[[M08-vykreslovani]]"
proposal: "Highlight přes PickResult, overlay jako platformově nezávislé úsečky a body"
decision: "HighlightPort setHover/setSelection; OverlayPort set/remove/clear s OverlayShape (úsečky, body)"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q058 Kontrakt HighlightPort a OverlayPort

**Oblast:** [[10-interakce]] · **Rozhodnout do:** [[M08-vykreslovani]]

## Otázka

[[Viewport|Port viewportu]] obsahuje `highlight: HighlightPort` a `overlay: OverlayPort`, ale jejich rozhraní nikde popsané není. Co přesně nabízejí?

## Možnosti a návrh

**Highlight:**
1. `setHover(target: PickResult | null)` a `setSelection(targets: readonly PickResult[])`. Stav nastavuje vždy celý (žádné přidej/odeber), takže ho `interaction` drží u sebe ve [[Výběr|výběru]] a viewport je jen zrcadlo.
   - \+ Jednoduché, idempotentní, v testech se ověří posledním voláním na `FakeViewport`.
2. Přírůstkové `add/remove`.
   - − Dva zdroje pravdy o výběru.

**Overlay:**
1. Platformově nezávislý popis: `OverlayShape` = úsečky (`kind: 'lines'`, body ve světových souřadnicích) nebo body (`kind: 'points'`), se stylem (`'preview' | 'construction'`). API `set(id: string, shapes: readonly OverlayShape[])`, `remove(id)`, `clear()`.
   - \+ Žádný typ Three.js v portu ([[0009-platformove-nezavisla-domena|ADR 0009]]). + Nástroj přepisuje celý svůj náhled jedním voláním.
2. Overlay přijímá `MeshData` (náhled tělesa).
   - Bude potřeba pro náhled extrude ([[M13-extrude-revolve|M13]]), ale ne teď. Lze přidat jako další `kind`.

Návrh: **highlight 1, overlay 1.**

## Rozhodnutí

2026-10-13 (Pavel): **highlight 1, overlay 1.** Další druhy tvarů v overlay (síť pro náhled tělesa) přidáme, až budou potřeba. Propsáno do [[10-interakce]] a [[09-vykreslovani]].
