---
type: concept
aliases:
  - Operation
code: "Operation"
module: "ops"
summary: "Serializovatelný popis jedné změny dokumentu; jediná cesta ke změně."
related:
  - "[[Handler operace]]"
  - "[[Operační log]]"
  - "[[Determinismus operací]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Operace

Serializovatelný popis jedné změny [[Dokument|dokumentu]] (`feature.add`, `feature.setParams`…). Jediná cesta, jak dokument změnit. Aplikuje ji [[Handler operace|handler]] přes dispečera a zapíše se do [[Operační log|logu]]. Typů je záměrně málo, protože log žije navždy.

**V návrhu:** [[04-operace-a-historie]], [[0005-operacni-log]]
**Souvisí:** [[Handler operace]], [[Operační log]], [[Determinismus operací]]
