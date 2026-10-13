---
type: milestone
status: todo
order: 3
aliases:
  - M3
  - M3 Operace a historie
modules:
  - ops
specs:
  - "[[04-operace-a-historie]]"
depends_on:
  - "[[M02-dokument]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-13
---
# M3 – Operace a historie

**Cíl:** jediná cesta ke změně dokumentu. Operační log, transakce a trvalé undo/redo. Na konci milníku musí projít property-based replay test.

**Specifikace:** [[04-operace-a-historie|04 – operace a historie]], [[0005-operacni-log|ADR 0005]]

**Navazuje na:** [[M02-dokument]]

## Úkoly

- [ ] `Operation`, `OpHandler`, `OpHandlerRegistry`.
- [ ] Handlery: `feature.add`, `feature.remove`, `feature.setParams`, `feature.rename`, `feature.suppress`, `feature.move`, `studio.setRollback`, `batch`.
- [ ] Test pro každý handler: `apply(op)` + `apply(invert)` = původní stav.
- [ ] `OperationLog` a `createOperationLog(entries?)` (`append`, `entries`, `lastSeq`, událost `appended`).
- [ ] `OperationDispatcher.dispatch` – pořadí invert → apply → append → emit; výjimka v apply nic nezapíše.
- [ ] `Transaction` – `apply`, `commit` (sloučení přes `merge`, jinak `batch`), `abort`.
- [ ] `merge` pro `feature.setParams` téže featury.
- [ ] `UndoManager` – `undo`, `redo`, zákaz během transakce, `rebuildUndoStacks` z logu.
- [ ] `upcast` mechanismus v registru (zatím bez reálné migrace – test s fiktivní v1 → v2).
- [ ] Property-based test (fast-check): náhodné operace + undo/redo → replay logu = živý dokument; `rebuildUndoStacks` = živé zásobníky.

## Akceptační kritéria

- Replay test projde na 1000 náhodných sekvencích.
- Transakce s 50 změnami parametru = 1 záznam v logu; abort = dokument i log beze změny.
- Undo po „rebuild“ (simulace znovuotevření) funguje stejně jako v živé session.
- `ops` importuje jen `core` a `document`.

## Co se naučíš

Event sourcing v malém, inverzní operace, determinismus, property-based testování.

## Retrospektiva

_(vyplnit po dokončení)_
