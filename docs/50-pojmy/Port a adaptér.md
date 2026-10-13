---
type: concept
aliases:
  - Hexagonální architektura
  - Ports and adapters
code: ""
module: ""
summary: "Doména zná jen rozhraní (port); vnější svět je za adaptéry."
related:
  - "[[Geometrické jádro]]"
  - "[[Kompoziční kořen]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Port a adaptér

Návrhový vzor: doména definuje rozhraní (**port**), konkrétní technologie ho implementuje (**adaptér**). V tinycad: [[Geometrické jádro]] (OCCT / Fake), persistence (IndexedDB / paměť), řešič vazeb (planegcs). Umožňuje testovat doménu bez prohlížeče a vyměnit technologii beze změny zbytku.

Konkrétní adaptéry vytváří jen [[Kompoziční kořen]].

**V návrhu:** [[01-architektura]], [[0001-jadro-v-cistem-ts]]
**Souvisí:** [[Geometrické jádro]], [[Kompoziční kořen]]
