---
type: milestone
status: todo
order: 4
aliases:
  - M4
  - M4 Persistence
modules:
  - persistence
specs:
  - "[[05-persistence]]"
depends_on:
  - "[[M03-operace]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-12
---
# M4 – Persistence

**Cíl:** operační log a snapshoty se ukládají do IndexedDB ve workeru; dokument jde načíst a pokračovat v práci včetně undo.

**Specifikace:** [[05-persistence|05 – persistence]]

**Navazuje na:** [[M03-operace]]

## Úkoly

- [ ] `DocumentSnapshot`, port `DocumentStore`.
- [ ] `MemoryDocumentStore`.
- [ ] Kontraktové testy `DocumentStore` (sdílená sada spouštěná pro každou implementaci).
- [ ] `IdbDocumentStore` – worker `persistence.worker.ts` s IndexedDB (stores `documents`, `entries`, `snapshots`), klient přes `core/rpc`. V testech `fake-indexeddb` a worker nahrazený přímým voláním implementace.
- [ ] `PersistenceService` – dávkování (`flushMs`), snapshot každých N záznamů, stav `saved/pending/error`, retry.
- [ ] `loadDocument` – snapshot + upcast + přehrání zbytku + `OperationLog.fromEntries` + kontrola konzistence v dev režimu.
- [ ] Export/import `.tinycad.json` (čisté funkce, UI až v M10/M15).

## Akceptační kritéria

- Kontraktové testy projdou pro obě implementace.
- Scénář: 250 operací → uložení → `loadDocument` → stav shodný, undo vrátí poslední operaci.
- Snapshot + zbytek logu = přehrání od nuly (test).
- Chyba zápisu nezahodí frontu.

## Co se naučíš

IndexedDB (transakce, object stores, složené klíče), web worker jako služba, kontraktové testování portů.

## Retrospektiva

_(vyplnit po dokončení)_
