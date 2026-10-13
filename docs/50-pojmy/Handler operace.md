---
type: concept
aliases:
  - OpHandler
code: "OpHandler"
module: "ops"
summary: "Umí operaci aplikovat a spočítat k ní inverzi."
related:
  - "[[Operace]]"
  - "[[Determinismus operací]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Handler operace

Chování k typu [[Operace|operace]]: `invert` (spočítá inverzi z aktuálního stavu, volá se před aplikací), `apply` (deterministická změna), volitelně `merge` a `upcast`. Jen handlery dostávají `DocumentWriter`.

**V návrhu:** [[04-operace-a-historie]]
**Souvisí:** [[Operace]], [[Determinismus operací]]
