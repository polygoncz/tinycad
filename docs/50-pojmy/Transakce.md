---
type: concept
aliases:
  - Transaction
code: "Transaction"
module: "ops"
summary: "Skupina operací aplikovaná hned, v logu jako jeden záznam."
related:
  - "[[Operace]]"
  - "[[Operační log]]"
  - "[[Undo a redo]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Transakce

Skupina [[Operace|operací]], které se aplikují okamžitě (živý náhled), ale do [[Operační log|logu]] se zapíší jako jeden záznam až při `commit`. `abort` vše vrátí. Používá ji dialog featury, tažení posuvníku a celé skicování.

**V návrhu:** [[04-operace-a-historie]], [[10-interakce]]
**Souvisí:** [[Operace]], [[Operační log]], [[Undo a redo]]
