---
type: concept
aliases:
  - OperationLog
  - LogEntry
  - log
code: "OperationLog / LogEntry"
module: "ops"
summary: "Append-only seznam záznamů (operace + inverze); základ undo i ukládání."
related:
  - "[[Operace]]"
  - "[[Undo a redo]]"
  - "[[Snapshot]]"
  - "[[Transakce]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-12
---
# Operační log

Append-only seznam záznamů `LogEntry` (operace, inverze, druh do/undo/redo, čas). Nic se z něj nemaže. Na logu stojí [[Undo a redo]], ukládání (připisování do IndexedDB + [[Snapshot|snapshoty]]) i případná budoucí synchronizace. Event sourcing v malém.

**V návrhu:** [[04-operace-a-historie]], [[05-persistence]], [[0005-operacni-log]]
**Souvisí:** [[Operace]], [[Undo a redo]], [[Snapshot]], [[Transakce]]
