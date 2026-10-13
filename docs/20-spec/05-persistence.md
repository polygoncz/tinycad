---
type: spec
status: draft
order: 5
aliases:
  - persistence – ukládání
  - Spec 05
modules:
  - persistence
milestones:
  - "[[M04-persistence]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-13
---
# 05 – `persistence`: ukládání dokumentů

> **Pojmy:** [[Snapshot]], [[Operační log]], [[Port a adaptér]]  
> **Rozhodnutí:** [[0005-operacni-log]]  
> **Milník:** [[M04-persistence]]

Ukládá operační log a občasné snapshoty do IndexedDB. Zápis běží ve Web Workeru, hlavní vlákno jen předává záznamy. Závisí na `core`, `document`, `ops`.

## Co se ukládá

1. **Záznamy logu** (`LogEntry`) – každá změna, append-only.
2. **Snapshoty** (`DocumentSnapshot`) – plný stav dokumentu k danému `seq`, aby se při otevření nemusel přehrávat celý log.
3. **Seznam dokumentů** (metadata pro úvodní obrazovku).

Geometrie se **neukládá** (případná cache BREP/sítí je samostatné téma, viz otevřené otázky).

```ts
export interface DocumentSnapshot {
  readonly format: 'tinycad.snapshot';
  readonly formatVersion: number;
  readonly atSeq: number;          // snapshot odpovídá stavu po záznamu atSeq
  readonly document: DocumentData;
}
```

Undo/redo zásobníky se do snapshotu neukládají – `rebuildUndoStacks` je spočítá z logu. (Log se tedy načítá celý kvůli undo historii, ale **nepřehrává** se celý – aplikují se jen záznamy po `atSeq`.)

## Port

```ts
export interface DocumentStore {
  listDocuments(): Promise<readonly DocumentMeta[]>;
  createDocument(meta: DocumentMeta, initial: DocumentSnapshot): Promise<void>;
  deleteDocument(id: DocumentId): Promise<void>;
  appendEntries(id: DocumentId, entries: readonly LogEntry[]): Promise<void>;
  saveSnapshot(id: DocumentId, snapshot: DocumentSnapshot): Promise<void>;
  load(id: DocumentId): Promise<{ snapshot: DocumentSnapshot; entries: readonly LogEntry[] }>; // poslední snapshot + celý log
}
```

Implementace:
- `IdbDocumentStore` – klient na hlavním vlákně, přes `core/rpc` volá worker `persistence.worker.ts`, který drží IndexedDB. Vytváří ho `createIdbDocumentStore()` z `persistence/idb`.
- `MemoryDocumentStore` – pro testy, vytváří ho `createMemoryDocumentStore()` z `persistence`.

Obě třídy jsou skryté uvnitř svých modulů, ven jde jen rozhraní `DocumentStore` a tovární funkce ([[0011-programovani-proti-rozhranim|ADR 0011]]).

### Schéma IndexedDB

Databáze `tinycad`, object stores:

| Store | Klíč | Obsah |
|---|---|---|
| `documents` | `id` | `DocumentMeta` + `lastSeq`, `updatedAt` |
| `entries` | `[docId, seq]` | `LogEntry` |
| `snapshots` | `[docId, atSeq]` | `DocumentSnapshot` |

Zápis záznamů jedné dávky probíhá v jedné IDB transakci (atomicky).

## Služba na hlavním vlákně

```ts
export interface PersistenceService extends Disposable {
  flush(): Promise<void>;
  readonly status: 'saved' | 'pending' | 'error';
  readonly events: Subscribable<{ status: { status: 'saved' | 'pending' | 'error' } }>;
}

export function createPersistenceService(deps: {
  store: DocumentStore; log: OperationLog; doc: DocumentReader;
  flushMs?: number; snapshotEvery?: number;
}): PersistenceService;
```

- Poslouchá `log.appended`, záznamy sbírá do fronty a odesílá dávkově (debounce `flushMs`, výchozí 300 ms).
- Každých `snapshotEvery` záznamů (výchozí 100) uloží snapshot. Snapshot se vytváří **synchronně** v okamžiku, kdy log dosáhne příslušného `seq` (dokument je neměnný, takže `toData` je levné a konzistentní), odesílá se asynchronně.
- Na `visibilitychange` (hidden) a `pagehide` volá `flush()`.
- Chyba zápisu → `status: 'error'`, fronta se nezahodí, další pokus při dalším flush.

## Načtení dokumentu

```ts
export async function loadDocument(store, id, schemas: FeatureSchemaRegistry, handlers: OpHandlerRegistry):
  Promise<{ doc: DocumentWriter; log: OperationLog }>;
```

1. `store.load(id)` → snapshot + všechny záznamy.
2. `fromData(snapshot.document, schemas)` – včetně migrace featur. Vrací `Result`; poškozený snapshot (`DocumentLoadError`, [[Q026 Chyby při načítání dokumentu|Q026]]) načtení ukončí chybou. Přesný tvar chybového výsledku `loadDocument` se upřesní v [[M04-persistence|M4]].
3. Záznamy s `seq > atSeq`: `upcast` operace na aktuální verzi a `handler.apply`.
4. `createOperationLog(entries)` (všechny, kvůli undo).
5. Kontrola konzistence v dev režimu: přehrání celého logu od nuly dá stejný dokument jako snapshot + zbytek.

## Export a import souboru

Pro zálohu a sdílení mezi počítači (git): `.tinycad.json` = poslední snapshot + volitelně celý log. Import vytvoří nový dokument.

## Testy

- `MemoryDocumentStore` a `IdbDocumentStore` (přes `fake-indexeddb`) proti **stejné sadě kontraktových testů**.
- `PersistenceService`: dávkování, snapshot po N záznamech, retry po chybě.
- `loadDocument`: snapshot + zbytek logu = přehrání od nuly; undo funguje po načtení.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
