---
type: milestone
status: doing
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
started: 2026-10-13
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

- [x] `Operation`, `OpHandler`, `OpHandlerRegistry`.
- [x] Handlery: `feature.add`, `feature.remove`, `feature.setParams`, `feature.rename`, `feature.suppress`, `feature.move`, `studio.setRollback`, `batch`.
- [x] Test pro každý handler: `apply(op)` + `apply(invert)` = původní stav.
- [x] `OperationLog` a `createOperationLog(entries?)` (`append`, `entries`, `lastSeq`, událost `appended`).
- [x] `OperationDispatcher.dispatch` – pořadí invert → apply → append → emit; výjimka v apply nic nezapíše.
- [x] `Transaction` – `apply`, `commit` (sloučení přes `merge`, jinak `batch`), `abort`.
- [x] `merge` pro `feature.setParams` téže featury.
- [x] `UndoManager` – `undo`, `redo`, zákaz během transakce, `rebuildUndoStacks` z logu.
- [x] `upcast` mechanismus v registru (zatím bez reálné migrace – test s fiktivní v1 → v2).
- [x] Property-based test (fast-check): náhodné operace + undo/redo → replay logu = živý dokument; `rebuildUndoStacks` = živé zásobníky.

## Akceptační kritéria

- Replay test projde na 1000 náhodných sekvencích.
- Transakce s 50 změnami parametru = 1 záznam v logu; abort = dokument i log beze změny.
- Undo po „rebuild“ (simulace znovuotevření) funguje stejně jako v živé session.
- `ops` importuje jen `core` a `document`.

## Implementační plán

Každý úkol dělá zvlášť subagent `implementer` (TDD, `npm run check`). Kontrakt je v [[04-operace-a-historie|spec 04]], na kterou úkoly odkazují sekcemi. Veřejné API jen přes `src/ops/index.ts`, ostatní soubory jsou interní. Úkoly jdou v tomto pořadí, každý staví na předchozích.

### Ú1 Operace, handlery, registr
- **Soubory:** `src/ops/operation.ts` (typy `Operation`, `FeatureAddOp`… `BatchOp`), `src/ops/handler.ts` (`OpHandler`, `OpHandlerRegistry`, `createOpHandlerRegistry`), `src/ops/handlers/feature.ts`, `src/ops/handlers/studio.ts`, testy vedle.
- **Kontrakt:** [[04-operace-a-historie#Operace]], [[04-operace-a-historie#Handler]]. Registr nad `createRegistry` z `core`, předvyplněný sedmi vestavěnými handlery; `register` s `type: 'batch'` vyhodí. `merge` jen u `feature.setParams`.
- **Testy:** pro každý handler `invert` → `apply` → `apply(inverze)` = původní `toData`; `invert` nezmění dokument; `invert` na neexistující featuru vyhodí; `merge` stejná/jiná featura; registr obsahuje 7 handlerů, `batch` nejde zaregistrovat.
- **Hotovo když:** testy a `npm run check` projdou; z `index.ts` se exportují typy operací, `OpHandler`, `OpHandlerRegistry`, `createOpHandlerRegistry`.

### Ú2 Operační log
- **Soubory:** `src/ops/log.ts`, `src/ops/log.test.ts`.
- **Kontrakt:** [[04-operace-a-historie#Log]].
- **Testy:** `seq` od 1 a `lastSeq`; `entries(fromSeq)` vrací kopii; zmrazený záznam; `appended`; obnova ze záznamů pokračuje v `seq`; mezera nebo nezačínající 1 vyhodí.
- **Hotovo když:** testy a `npm run check` projdou; export `LogEntry`, `OperationLog`, `createOperationLog`.

### Ú3 `applyOperation` a `replayLog`
- **Soubory:** `src/ops/apply.ts` (interní `applyOperation`), `src/ops/replay.ts` (`replayLog`), testy vedle.
- **Kontrakt:** [[04-operace-a-historie#Dávka a rollback bar]], [[04-operace-a-historie#Přehrání a upcast]]. `applyOperation` vrací `{ inverse, deferred: unknown[] }` (odložené výjimky odběratelů); vyhazovat je je věc volajícího.
- **Testy:** obalení inverze `studio.setRollback` u add/remove/move před barem, na baru a za barem (a že inverze bar přesně obnoví); bez obalení u `studio.setRollback` a když se bar nepohne; dávka – pořadí inverzí, vnořená, prázdná; atomičnost při selhání 2. podoperace; výjimka odběratele beze změny (letí hned) vs. se změnou (odložená, dávka pokračuje); `replayLog` přehraje `op` i u `undo` záznamů.
- **Hotovo když:** testy a `npm run check` projdou; z `index.ts` se exportuje jen `replayLog`.

### Ú4 Dispečer
- **Soubory:** `src/ops/dispatcher.ts`, `src/ops/dispatcher.test.ts`.
- **Kontrakt:** [[04-operace-a-historie#Dispečer]] (bez `begin` – ten v Ú5; `inTransaction` zatím vždy `false`).
- **Testy:** pořadí invert → apply → append → emit (spy); selhání handleru nezapíše; výjimka odběratele po změně zapíše záznam, vyšle `applied` a pak letí; výjimka odběratele `appended` nezabrání `applied` a letí až na konci; nekonzistentní `meta` vyhodí (target bez kind, undo bez target, target na neexistující nebo ne-`do` záznam); výchozí `label` = `op.type`; `time` z `now`.
- **Hotovo když:** testy a `npm run check` projdou; export `OperationDispatcher`, `DispatchMeta`, `createOperationDispatcher`.

### Ú5 Transakce
- **Soubory:** `src/ops/transaction.ts`, `src/ops/transaction.test.ts`, úprava `dispatcher.ts` (`begin`, `inTransaction`, událost `transaction`, `dispatch` během transakce vyhodí).
- **Kontrakt:** [[04-operace-a-historie#Transakce]].
- **Testy:** 50× `setParams` téže featury → 1 záznam s jednou `setParams` a inverzí na původní parametry; add + 5× setParams → `batch` se 2 operacemi; setParams A, B, A se nesloučí (nejsou sousední); prázdná transakce → `null` a žádný záznam; abort → `toData` i `lastSeq` beze změny; selhání `apply` nechá transakci otevřenou; druhý `begin` vyhodí; volání po ukončení vyhodí; `dispatch` během transakce vyhodí; události `transaction` a `applied` (`entry: null`).
- **Hotovo když:** testy a `npm run check` projdou; export `Transaction`.

### Ú6 Undo a redo
- **Soubory:** `src/ops/undo.ts`, `src/ops/undo.test.ts`.
- **Kontrakt:** [[04-operace-a-historie#Undo / redo]]. `step` je interní čistá funkce sdílená `rebuildUndoStacks` i `UndoManager`.
- **Testy:** do/undo/redo sekvence; undo, nová změna → redo nejde; undo/redo při prázdném zásobníku vyhodí; během transakce `canUndo` false a `undo` vyhodí; `changed` jen při změně dvojice (i začátek/konec transakce); undo `feature.remove` vrátí featuru i rollback bar; `rebuildUndoStacks` = `stacks()`; poškozený log (`target` nesedí) vyhodí; „znovuotevření“: nový log z `entries()`, nový dokument přes `replayLog`, nový manager → undo/redo dá stejný `toData` jako v živé session; `dispose` odhlásí odběry.
- **Hotovo když:** testy a `npm run check` projdou; export `UndoManager`, `createUndoManager`, `rebuildUndoStacks`.

### Ú7 Upcast
- **Soubory:** `src/ops/upcast.ts`, `src/ops/upcast.test.ts`.
- **Kontrakt:** [[04-operace-a-historie#Přehrání a upcast]].
- **Testy:** aktuální verze → `ok` beze změny; fiktivní handler v2 s `upcast` z v1; v1 bez `upcast` → `err`; novější verze → `err`; neznámý typ → `err`; rozbitá obálka (ne objekt, `type` není řetězec, `v` není celé ≥ 1) s cestou; chyba uvnitř dávky s cestou `ops[i]…`; `upcast` vrátí špatné `v` → výjimka.
- **Hotovo když:** testy a `npm run check` projdou; export `upcastOperation`, `OperationLoadError`.

### Ú8 Testovací pomůcky a replay test
- **Soubory:** `src/ops/testing.ts` (fixture `anOpsSession()` → `{ doc, handlers, log, dispatcher, undo }` s pevným `now`), `src/ops/replay.property.test.ts`; `npm i -D fast-check`.
- **Kontrakt:** [[04-operace-a-historie#Testy]], [[13-testovani|spec 13]]. Generátor tvoří abstraktní kroky (druh + celá čísla), které se překládají na platné operace podle **aktuálního** stavu (index featury = číslo modulo počet featur); ID z `createSequentialIdGenerator`, featury z `aFeature` (`document/testing`). Kroky: všechny typy operací, dávka, transakce s commitem i abortem, undo a redo (jen když jdou).
- **Testy:** 1000 sekvencí (`numRuns: 1000`): `replayLog` na prázdný dokument → `toData` = živý; `rebuildUndoStacks(log.entries())` = `undo.stacks()`.
- **Hotovo když:** test projde, `npm run check` projde, `fast-check` je v `devDependencies`.

## Co se naučíš

Event sourcing v malém, inverzní operace, determinismus, property-based testování.

## Retrospektiva

_(vyplnit po dokončení)_
