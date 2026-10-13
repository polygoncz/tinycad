---
type: concept
aliases:
  - Regenerator
  - regen
code: "Regenerator"
module: "regen"
summary: "Přehrání featur přes jádro; přepočítá se jen od první změněné featury."
related:
  - "[[Stav regenerace]]"
  - "[[Builder featury]]"
  - "[[Rollback bar]]"
  - "[[Mark and sweep]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Regenerace

Přehrání [[Featura|featur]] Part Studia přes [[Geometrické jádro|jádro]]. Každá featura je funkce `stav → stav`. Cache podle identity objektů ([[Neměnná data]]) zajistí, že se přepočítá jen od první změněné featury. Chybná featura propouští stav dál (zčervená, ale model nerozbije). Souběh řeší čísla generací.

**V návrhu:** [[07-regenerace]], [[0006-nemenna-data]]
**Souvisí:** [[Stav regenerace]], [[Builder featury]], [[Rollback bar]], [[Mark and sweep]]
