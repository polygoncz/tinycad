---
type: concept
aliases:
  - Uvolňování handle
code: "Regenerator (sweep)"
module: "regen"
summary: "Po regeneraci se uvolní všechny handle, které už žádný stav nepoužívá."
related:
  - "[[Handle tvaru]]"
  - "[[Regenerace]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Mark and sweep

Způsob správy životnosti [[Handle tvaru|handle]]: po každé dokončené regeneraci se posbírají handle ze všech stavů v cache (mark) a všechny ostatní vlastněné handle se uvolní v jádře (sweep). Jednodušší a robustnější než počítání referencí, protože [[Stav regenerace|stavy]] handle sdílejí.

**V návrhu:** [[07-regenerace]]
**Souvisí:** [[Handle tvaru]], [[Regenerace]]
