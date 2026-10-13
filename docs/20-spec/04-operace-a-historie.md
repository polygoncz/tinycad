---
type: spec
status: draft
order: 4
aliases:
  - ops – operace, log, undo/redo
  - Spec 04
modules:
  - ops
milestones:
  - "[[M03-operace]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-13
---
# 04 – `ops`: operace, log a undo/redo

> **Pojmy:** [[Operace]], [[Handler operace]], [[Operační log]], [[Transakce]], [[Undo a redo]], [[Determinismus operací]]  
> **Rozhodnutí:** [[0005-operacni-log]]  
> **Milník:** [[M03-operace]]

Jediná cesta, jak změnit dokument. Každá změna je **operace** – serializovatelný popis (data). Operace se aplikují přes dispečera a zapisují do **neměnného logu**. Undo/redo, ukládání i případná budoucí synchronizace stojí na tomto logu ([[0005-operacni-log|ADR 0005]]). Závisí na `core` a `document`.

## Operace

```ts
export interface Operation {
  readonly type: string;   // 'feature.add'
  readonly v: number;      // verze schématu této operace
}
```

### Sada operací

Typů je záměrně málo a jsou malé: log žije navždy, každá změna tvaru operace znamená migraci.

| `type` | Payload | Inverze |
|---|---|---|
| `feature.add` | `{ feature: FeatureInstance, index }` | `feature.remove` |
| `feature.remove` | `{ featureId }` | `feature.add` s původní instancí a indexem |
| `feature.setParams` | `{ featureId, params }` (celé nové parametry) | `feature.setParams` se starými parametry |
| `feature.rename` | `{ featureId, name }` | `feature.rename` se starým jménem |
| `feature.suppress` | `{ featureId, suppressed }` | opačná hodnota |
| `feature.move` | `{ featureId, toIndex }` | `feature.move` na původní index |
| `studio.setRollback` | `{ index }` | `studio.setRollback` na původní index |
| `batch` | `{ ops: Operation[] }` | `batch` s inverzemi v opačném pořadí |

Rollback bar: mutátory dokumentu ho při vložení, smazání a přesunu posouvají podle pravidel ze [[03-dokument|spec 03]], která nejsou přesně invertovatelná. Proto **dispečer** po `apply` porovná `rollbackIndex` a pokud se změnil, uloží jako inverzi `batch[inverze handleru, studio.setRollback(původní)]`. Handlery se o bar starat nemusí ([[Q029 Posun rollback baru při změnách featur|Q029]]).

`setParams` nese **celé** parametry, ne patch. Inverze je pak triviální a operace nezávisí na předchozím stavu.

Skicář přidá vlastní operace (`sketch.*`), viz [[12-skicar|12]]. Nové typy operací se registrují stejně jako featury.

## Handler

```ts
export interface OpHandler<O extends Operation = Operation> {
  readonly type: string;
  readonly version: number;
  /** Spočítá inverzi z AKTUÁLNÍHO stavu – volá se PŘED apply. */
  invert(doc: DocumentReader, op: O): Operation;
  /** Aplikuje změnu. Musí být deterministická: žádný Date.now, Math.random, nová ID. */
  apply(doc: DocumentWriter, op: O): void;
  /** Volitelné: sloučí dvě po sobě jdoucí operace (např. dvě setParams téže featury). */
  merge?(prev: O, next: O): O | null;
  /** Převod starší verze operace na aktuální při načítání logu. */
  upcast?(fromVersion: number, raw: unknown): O;
}

export type OpHandlerRegistry = Registry<OpHandler>;   // klíč = type, viz core
export function createOpHandlerRegistry(): OpHandlerRegistry;
```

### Determinismus

Přehrání logu na prázdném dokumentu musí vést k **přesně** stejnému dokumentu. Proto:
- všechna ID (nová featura, nové jméno) se generují **před** vytvořením operace a jsou v payloadu,
- `apply` nesmí číst čas, náhodu ani nic mimo dokument a operaci,
- čas je jen metadata záznamu logu, do dokumentu se nepropisuje.

Ověřuje to property-based test (viz [[13-testovani|13]]).

## Dispečer

```ts
export interface OperationDispatcher {

  /** Aplikuje operaci a zapíše ji do logu jako samostatný záznam. */
  dispatch(op: Operation, meta?: { label?: string }): LogEntry;

  /** Zahájí transakci – viz níže. Současně může běžet jen jedna. */
  begin(label: string): Transaction;

  readonly events: Subscribable<{ applied: { entry: LogEntry | null; op: Operation } }>;
}

export function createOperationDispatcher(deps: {
  doc: DocumentWriter; handlers: OpHandlerRegistry; log: OperationLog;
}): OperationDispatcher;
```

Průběh `dispatch(op)`:
1. `handler = registry.get(op.type)`
2. `inverse = handler.invert(doc, op)` – před změnou
3. `handler.apply(doc, op)` – při výjimce se nic nezapíše a výjimka letí dál
4. `entry = log.append({ op, inverse, … })`
5. `emit('applied')`

## Transakce

Dialog featury, tažení posuvníku nebo celé skicování nesmí v logu vytvořit stovky záznamů. Transakce aplikuje operace hned (dokument se mění, regenerace běží, uživatel vidí náhled), ale do logu zapíše **jeden** záznam až při potvrzení.

```ts
export interface Transaction {
  readonly label: string;
  apply(op: Operation): void;   // aplikuje okamžitě, zapamatuje si op + inverzi
  commit(): LogEntry | null;    // zapíše jeden záznam; prázdná transakce nezapíše nic
  abort(): void;                // aplikuje inverze v opačném pořadí, nezapíše nic
}
```

Při `commit` se operace zkomprimují: sousední operace se stejným handlerem se zkusí sloučit přes `merge`. Výsledek je jedna operace, nebo `batch`. Inverze je `batch` inverzí v opačném pořadí (nebo jedna inverze po sloučení).

Příklad – vytvoření kvádru přes dialog: `begin('Box')` → `feature.add` s výchozími parametry → 5× `feature.setParams` → `commit()`. Pět `setParams` se sloučí do jedné, v logu je jeden záznam `batch[feature.add, feature.setParams]`. Sloučit i `add` + `setParams` do jediného `feature.add` je možné vylepšení, viz otevřené otázky.

## Log

Log je **append-only**. Nic se z něj nemaže, ani při undo.

```ts
export interface LogEntry {
  readonly seq: number;              // 1, 2, 3, … v rámci dokumentu
  readonly kind: 'do' | 'undo' | 'redo';
  readonly target?: number;          // u undo/redo: seq původního 'do' záznamu
  readonly op: Operation;
  readonly inverse: Operation;
  readonly label: string;            // 'Box 1: výška', zobrazí se v historii
  readonly time: number;             // ms epoch, jen metadata
}

export interface OperationLog {
  append(e: Omit<LogEntry, 'seq'>): LogEntry;
  entries(fromSeq?: number): readonly LogEntry[];
  readonly lastSeq: number;
  readonly events: Subscribable<{ appended: LogEntry }>;
}

/** Prázdný log, nebo log obnovený z uložených záznamů (po načtení dokumentu). */
export function createOperationLog(entries?: readonly LogEntry[]): OperationLog;
```

V paměti je celý log (pro naše velikosti dokumentů to stačí). Na disk ho zapisuje `persistence` ([[05-persistence|05]]), která poslouchá `appended`.

## Undo / redo

Undo nemaže historii – připíše **inverzní operaci** jako nový záznam. Historie úprav tak zůstává kompletní (podobně jako mikroverze v Onshape).

```ts
export interface UndoManager {
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;   // vezme seq z undo zásobníku, aplikuje jeho inverse jako záznam kind 'undo'
  redo(): void;   // vezme seq z redo zásobníku, aplikuje znovu jeho op jako záznam kind 'redo'
  readonly events: Subscribable<{ changed: { canUndo: boolean; canRedo: boolean } }>;
}

/** Zásobníky se při vytvoření spočítají z logu přes rebuildUndoStacks. */
export function createUndoManager(deps: { dispatcher: OperationDispatcher; log: OperationLog }): UndoManager;

/** Obnoví zásobníky přehráním metadat logu (po načtení dokumentu). Čistá funkce. */
export function rebuildUndoStacks(log: OperationLog): { undo: number[]; redo: number[] };
```

Pravidla:
- nový záznam `do` vyprázdní redo zásobník,
- `undo` přesune seq z undo do redo, `redo` naopak,
- zásobníky obsahují seq **původních** `do` záznamů,
- během otevřené transakce jsou undo/redo zakázané,
- `rebuildUndoStacks` je čistá funkce nad logem → undo funguje i po zavření a znovuotevření dokumentu.

Redo aplikuje původní `op` znovu a inverzi spočítá znovu z aktuálního stavu. Díky tomu je redo správné, i kdyby se stav mezi tím nějak lišil.

## Testy

- Každý handler: `apply(invert(op))` vrátí dokument do původního stavu (porovnání `toData`).
- Dispečer: výjimka v `apply` nezapíše záznam.
- Transakce: commit = jeden záznam; abort = dokument beze změny a log beze změny; prázdná transakce nezapíše nic.
- Undo/redo sekvence včetně „undo, nová změna, redo není možné“.
- `rebuildUndoStacks` dá stejné zásobníky jako živá session.
- **Replay test**: náhodná sekvence operací + undo/redo, pak přehrání logu na prázdný dokument → `toData` se shoduje (fast-check).

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
