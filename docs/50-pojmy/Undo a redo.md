---
type: concept
aliases:
  - UndoManager
  - undo
code: "UndoManager"
module: "ops"
summary: "Undo připíše inverzní operaci; zásobníky jsou odvozené z logu."
related:
  - "[[Operační log]]"
  - "[[Transakce]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Undo a redo

Undo nemaže historii – připíše inverzní operaci jako nový záznam. Redo připíše původní operaci znovu. Zásobníky jdou odvodit z [[Operační log|logu]] (`UndoManager.rebuild`), takže undo funguje i po znovuotevření dokumentu. Během [[Transakce|transakce]] je zakázané.

**V návrhu:** [[04-operace-a-historie]], [[0005-operacni-log]]
**Souvisí:** [[Operační log]], [[Transakce]]
