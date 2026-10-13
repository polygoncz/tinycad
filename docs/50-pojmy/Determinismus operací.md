---
type: concept
aliases:
  - Determinismus
code: ""
module: "ops"
summary: "Přehrání logu musí dát přesně stejný dokument; ID a čas se generují předem."
related:
  - "[[Operace]]"
  - "[[Operační log]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Determinismus operací

Přehrání [[Operační log|logu]] na prázdném dokumentu musí dát **přesně** stejný dokument. Proto `apply` nesmí číst čas, náhodu ani vytvářet ID – vše se generuje před vytvořením [[Operace|operace]] a je v payloadu. Ve skicáři to znamená ukládat už vyřešené souřadnice, aby replay nezávisel na řešiči. Hlídá to property-based replay test.

**V návrhu:** [[04-operace-a-historie]], [[13-testovani]], [[12-skicar]]
**Souvisí:** [[Operace]], [[Operační log]]
