---
type: spec
status: implemented
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
> **Rozhodnutí:** [[0005-operacni-log]], [[0009-platformove-nezavisla-domena]], [[0011-programovani-proti-rozhranim]]  
> **Milník:** [[M04-persistence]]

Ukládá operační log a občasné snapshoty do IndexedDB ([[Q008 OPFS nebo IndexedDB|Q008]]). Zápis běží ve Web Workeru, hlavní vlákno jen předává záznamy. Závisí na `core`, `document`, `ops`.

Modul má dvě části s různými prstenci ([[01-architektura#Tři prstence]]):
- `persistence` (prstenec 1, bez DOM): snapshot, port `DocumentStore`, `MemoryDocumentStore`, `PersistenceService`, `loadDocument`, export a import.
- `persistence/idb` (prstenec 3): adaptér nad IndexedDB a worker. Importuje ho jen `app`.

## Co se ukládá

1. **Záznamy logu** (`LogEntry`): každá změna, append-only, nikdy se nemažou.
2. **Snapshoty** (`DocumentSnapshot`): plný stav dokumentu k danému `seq`, aby se při otevření nemusel přehrávat celý log.
3. **Seznam dokumentů** (metadata pro úvodní obrazovku, [[Q019 Úvodní obrazovka se seznamem dokumentů|Q019]]).

Geometrie se **neukládá** (cache BREP/sítí viz [[Q007 Cache geometrie|Q007]]).

Všechno uložené je čisté JSON ([[03-dokument#Serializace]]). Díky tomu se data dají uložit jak structured clone (IndexedDB), tak `JSON.stringify` (export).

### Snapshot

```ts
export interface DocumentSnapshot {
  readonly format: 'tinycad.snapshot';
  readonly formatVersion: 1;
  readonly atSeq: number;          // stav po záznamu atSeq; 0 = před prvním záznamem
  readonly document: DocumentData;
}

/** Synchronní a levné: toData nekopíruje, dokument je neměnný. */
export function createSnapshot(doc: DocumentReader, atSeq: number): DocumentSnapshot;
```

Undo/redo zásobníky se do snapshotu neukládají. `rebuildUndoStacks` je spočítá z logu. Log se tedy načítá celý kvůli undo historii, ale **nepřehrává** se celý: aplikují se jen záznamy po `atSeq`.

**Základní snapshot** (`atSeq: 0`) vzniká s dokumentem a nikdy se nemaže. Je to stav, ze kterého se přehrává celý log. Bez něj by kontrola konzistence „přehrání od nuly“ neměla od čeho začít, protože importovaný dokument nezačíná prázdný.

## Port

```ts
export interface DocumentInfo {
  readonly meta: DocumentMeta;
  readonly lastSeq: number;        // nejvyšší uložený seq, 0 = bez záznamů
  readonly updatedAt: number;      // ms od epochy, poslední zápis do dokumentu
}

/** Co store vrátí. Data zvenku, proto unknown: tvar ověří až loadDocument („parse, don't validate“). */
export interface StoredDocument {
  readonly snapshot: unknown;      // snapshot s nejvyšším atSeq
  readonly base: unknown;          // snapshot s atSeq 0
  readonly entries: readonly unknown[]; // všechny záznamy seřazené podle seq
}

export interface DocumentStore {
  /** Seřazené podle updatedAt sestupně. */
  listDocuments(): Promise<readonly DocumentInfo[]>;
  /** initial.atSeq musí být 0. Existující id → 'already-exists'. */
  createDocument(meta: DocumentMeta, initial: DocumentSnapshot): Promise<void>;
  /** Neexistující id → nic se nestane (idempotentní). */
  deleteDocument(id: DocumentId): Promise<void>;
  appendEntries(id: DocumentId, entries: readonly LogEntry[]): Promise<void>;
  saveSnapshot(id: DocumentId, snapshot: DocumentSnapshot): Promise<void>;
  /** Neexistující id → undefined (není to chyba, jen výsledek). */
  load(id: DocumentId): Promise<StoredDocument | undefined>;
}

export type DocumentStoreErrorCode = 'not-found' | 'already-exists' | 'seq-gap' | 'snapshot-ahead' | 'invalid';
/** Kód chyby storu, nebo undefined pro jinou chybu (I/O). Funguje pro chybu z paměti i přes RPC. */
export function storeErrorCode(e: unknown): DocumentStoreErrorCode | undefined;

// Pro adaptéry (persistence/idb), aby kontrakt nepsaly znovu:
/** Error s vlastností code, jak ho port předepisuje. */
export function createStoreError(code: DocumentStoreErrorCode, message: string): Error;
/** Která atSeq po uložení snapshotu zůstanou: 0 a 3 nejvyšší (Q009). */
export function snapshotSeqsToKeep(atSeqs: readonly number[]): readonly number[];
```

**Kontrakt** (ověřují ho kontraktové testy pro obě implementace):

- Odmítnutí je `Error` s vlastností `code`. Přes `core/rpc` přijde jako `RpcError` se stejným `code`, proto testy porovnávají `storeErrorCode(e)`, ne `instanceof`.
- `appendEntries`, `saveSnapshot` na neexistující dokument → `'not-found'`.
- **`appendEntries`:**
  - Prázdné pole → nic, ani `updatedAt` se nezmění.
  - Každé `seq` musí být celé číslo ≥ 1, jinak `'invalid'`. Kontroluje se před mezerou (pořadí `'not-found'`, `'invalid'`, `'seq-gap'`).
  - Záznamy musí jít po sobě (`seq` + 1) a první musí mít `seq ≤ lastSeq + 1`. Jinak `'seq-gap'` a nezapíše se nic.
  - Záznam se `seq ≤ lastSeq` se **přepíše** (`put`). Opakovaný zápis stejné dávky po chybě, kdy se zápis povedl a ztratila se jen odpověď, je tedy neškodný (idempotence).
  - Dávka se zapíše atomicky (jedna transakce) a nastaví `lastSeq = max(lastSeq, poslední seq)` a `updatedAt = now()`.
- **`saveSnapshot`:**
  - `atSeq > lastSeq` → `'snapshot-ahead'`. Snapshot z budoucnosti by po pádu dal stav, který log nepokrývá.
  - `atSeq` musí být celé číslo ≥ 1. Základní snapshot vzniká jen v `createDocument`, jinak `'invalid'`.
  - `snapshot.document.meta.id` se musí shodovat s `id`, jinak `'invalid'`.
  - `updatedAt` nemění: snapshot nemění obsah dokumentu, jen zrychluje načtení.
  - Pořadí kontrol: `'not-found'`, `'invalid'`, `'snapshot-ahead'`.
  - Stejné `atSeq` → přepíše.
  - Ve stejné transakci **promaže** staré snapshoty: zůstane základní a 3 s nejvyšším `atSeq` ([[Q009 Promazávání starých snapshotů|Q009]]).
- `createDocument`: existující id → `'already-exists'` (kontroluje se první), `initial.atSeq !== 0` → `'invalid'`, `meta.id` se musí shodovat s `initial.document.meta.id`, jinak `'invalid'`. Nový dokument má `lastSeq: 0`, `updatedAt: now()`.
- `deleteDocument` smaže dokument, jeho záznamy i snapshoty v jedné transakci.
- Kontrolu kontraktu dělá každá metoda **před** zápisem: odmítnutá metoda nezmění nic.
- Promazání snapshotů přes port vidět nejde (`load` vrací jen nejnovější a základní). Kontraktová sada ověří jen to, že základní zůstane. Pravidlo „3 nejvyšší“ testuje `snapshotSeqsToKeep` a adaptér IDB přímým čtením databáze.
- **Izolace dat:** store nikdy nevrací objekt, který dostal, ani objekt, který vrátil dřív. Pozdější změna vstupu ani výstupu se uloženého stavu nedotkne. IndexedDB to dělá structured clone. `MemoryDocumentStore` kopíruje přes `JSON.parse(JSON.stringify(x))`: je to přísnější než structured clone a odhalí data, která nejsou čisté JSON.
- Store čas nezná sám: dostane `now: () => number` v továrně.

Implementace:
- `MemoryDocumentStore`: `createMemoryDocumentStore(deps?: { now?: () => number })` z `persistence`. Pro testy a jako referenční implementace kontraktu.
- `IdbDocumentStore`: `createIdbDocumentStore(): DocumentStore & Disposable` z `persistence/idb`. Klient na hlavním vlákně volá přes `core/rpc` worker `persistence.worker.ts`, který drží IndexedDB. `dispose` ukončí worker.

Obě třídy jsou skryté uvnitř svých modulů, ven jde jen rozhraní `DocumentStore` a tovární funkce ([[0011-programovani-proti-rozhranim|ADR 0011]]).

### Adaptér IndexedDB a worker

Vnitřní stavba `persistence/idb`, aby šla testovat v Node:

```ts
// idb-store.ts – skutečná implementace, běží ve workeru. Nezná worker ani RPC.
export function createIdbStoreImpl(deps: { indexedDB: IDBFactory; now: () => number }): DocumentStore;

// protocol.ts – RPC protokol: jedna metoda protokolu = jedna metoda DocumentStore, stejné argumenty i výsledek.
export type DocumentStoreProtocol = { … };

// client.ts – DocumentStore nad RpcClient.
export function createDocumentStoreClient(ep: MessageEndpoint): DocumentStore;

// persistence.worker.ts – jen serveRpc(self, createIdbStoreImpl({ indexedDB, now: Date.now })).
// index.ts – createIdbDocumentStore(): new Worker(...) + createDocumentStoreClient.
```

Testy v Node (typuje je `tsconfig.test-idb.json`, jediný testový projekt s lib DOM): `fake-indexeddb` jako `IDBFactory` a `MessageChannel` z Node místo workeru. Kontraktová sada tak běží přes **skutečné** `serveRpc` a `createRpcClient`, včetně serializace argumentů a přenosu chybových kódů. Jen `new Worker` a `persistence.worker.ts` zůstávají netestované (dva řádky; ověří je M10 v prohlížeči).

### Schéma IndexedDB

Databáze `tinycad`, verze 1, object stores:

| Store | `keyPath` | Hodnota |
|---|---|---|
| `documents` | `id` | `{ id, meta, lastSeq, updatedAt }` |
| `entries` | `['docId', 'seq']` | `{ docId, seq, entry: LogEntry }` |
| `snapshots` | `['docId', 'atSeq']` | `{ docId, atSeq, snapshot: DocumentSnapshot }` |

- Všechny záznamy jednoho dokumentu: `IDBKeyRange.bound([id, 0], [id, Infinity])`. Složený klíč drží záznamy seřazené podle `seq` bez indexu navíc.
- Každá metoda portu je **jedna** IDB transakce přes všechny stores, které potřebuje (`readwrite` u zápisu). Kontrola `seq-gap` a `snapshot-ahead` se čte uvnitř téže transakce, takže ji nic nepředběhne.
- **Spojení:** otevírá se líně a drží se. Při selhání otevření, `onclose` (prohlížeč spojení zavřel, např. smazaná data webu) nebo `onversionchange` (upgrade v jiné záložce; spojení se zavře) se zapomene a další volání otevře databázi znovu. Odmítnuté otevření se neukládá natrvalo, jinak by retry služby nikdy neuspěl.
- Upgrade databáze (`onupgradeneeded`) zakládá stores. Budoucí změna schématu = nová verze databáze a migrace v `onupgradeneeded`.

## Služba na hlavním vlákně

```ts
export type PersistenceStatus = 'saved' | 'pending' | 'error';

export interface PersistenceService extends Disposable {
  /** Zapíše frontu. Volání během běžícího flush počká a pak zapíše, co zbylo. Při chybě odmítne. */
  flush(): Promise<void>;
  readonly status: PersistenceStatus;
  readonly events: Subscribable<{ status: { status: PersistenceStatus; error?: unknown } }>;
}

/** Plánovač časovačů. Prstenec 1 nezná setTimeout (ADR 0009), dodá ho app nebo test. */
export interface Scheduler {
  schedule(fn: () => void, ms: number): Disposable;
}

export function createPersistenceService(deps: {
  store: DocumentStore;
  log: OperationLogReader;
  doc: DocumentReader;          // id dokumentu = doc.meta.id
  scheduler: Scheduler;
  flushMs?: number;             // výchozí 300
  snapshotEvery?: number;       // výchozí 100
  retryMs?: number;             // výchozí 5000
}): PersistenceService;
```

- Poslouchá `log.events.appended`, záznamy sbírá do fronty. Záznamy, které v logu byly už při vytvoření služby, považuje za uložené.
- **Zpoždění, ne debounce.** První záznam po klidu naplánuje flush za `flushMs`, další záznamy plánování neposouvají. Čistý debounce by při plynulém tažení (desítky operací za sekundu bez transakce) neukládal vůbec.
- Každý záznam se `seq % snapshotEvery === 0` vytvoří snapshot **synchronně** v obsluze `appended`. Dispečer emituje `appended` až po aplikaci operace, takže dokument právě odpovídá `seq`. Snapshot jde do fronty snapshotů (stačí poslední).
- `flush()`: zapíše dávku záznamů (`appendEntries`) a **teprve po jejím úspěchu** snapshoty s `atSeq ≤` poslednímu zapsanému `seq`. Úspěšně zapsané položky odebere z fronty.
- Stav: `saved`, když je fronta prázdná a nic neběží. `pending`, když je co ukládat. `error` po neúspěšném zápisu. Událost `status` jen při změně (u `error` s chybou).
- **Chyba zápisu:** fronta se nezahodí, `status: 'error'`, naplánuje se nový pokus za `retryMs`. Nový záznam naplánuje flush jako obvykle. Flush spuštěný časovačem chybu nehlásí odmítnutím (nikdo na něj nečeká), hlásí ji stavem.
- **Stav `error` je lepivý:** nový záznam ho nepřepne na `pending`. Zůstává, dokud se zápis nepovede, aby uživatel dál viděl, že ukládání selhává. Opakovaná chyba novou událost nevyšle (stav se nemění). Pokud bude UI chtít ukázat poslední chybu, přibude vlastnost `lastError` (M10).
- **Snapshot a selhání:** snapshot, jehož záznamy se nepodařilo zapsat, čeká ve frontě. Novější snapshot ho nahradí. Když záznamy projdou a selže jen `saveSnapshot`, záznamy se z fronty odeberou a další flush uloží jen snapshot.
- Zápis bere dávku až ve chvíli, kdy opravdu začíná. Záznam přidaný hned po zavolání `flush()` se do ní ještě dostane.
- Na `pagehide` a `visibilitychange` (hidden) volá `flush()` **`app`**, ne služba ([[Q034 Uložení při zavírání stránky|Q034]]).
- **Výjimka odběratele `status`** ([[Q030 Výjimka odběratele po změně dokumentu|Q030]]): služba nejdřív dokončí vlastní stav (fronta, snapshot, naplánovaný flush nebo retry) a teprve pak emituje. Výjimka odběratele pak letí ven: z `flush()` (data jsou ale uložená, resp. retry naplánovaný), u `appended` do logu, který ji podle Q030 sbírá. Výjimka odběratele nikdy nesmí zabránit naplánování flush nebo retry. Při selhání storu i odběratele odmítne `flush()` chybou `AggregateError([chyba storu, chyba odběratele])`. U flush spuštěného časovačem na výsledek nikdo nečeká, takže se výjimka odběratele ztratí. Prstenec 1 nemá kam logovat (ADR 0009) a odběratelé `status` mají být jednoduchá UI vazba.
- `dispose()`: odhlásí odběr logu a zruší naplánovaný flush. Neukládá, volající má předtím zavolat `flush()`. `flush()` po `dispose()` ještě zapíše, co zůstalo ve frontě, ale po chybě už nic nenaplánuje.

## Načtení dokumentu

```ts
export interface LoadedDocument {
  readonly doc: DocumentWriter;
  readonly log: OperationLog;
}

export type LoadDocumentError =
  | { readonly kind: 'not-found' }
  | { readonly kind: 'snapshot'; readonly which: 'latest' | 'base'; readonly error: DocumentLoadError }
  | { readonly kind: 'entry'; readonly seq: number; readonly error: OperationLoadError };

export async function loadDocument(
  store: DocumentStore,
  id: DocumentId,
  deps: { schemas: FeatureSchemaRegistry; handlers: OpHandlerRegistry; verify?: boolean },
): Promise<Result<LoadedDocument, LoadDocumentError>>;
```

Tvar chyby rozhodla [[Q033 Tvar chyby při načtení dokumentu|Q033]]. Chyba I/O storu není chyba dat a letí jako odmítnutý `Promise`.

1. `store.load(id)`. `undefined` → `not-found`.
2. **Záznamy:** každý projde `parseLogEntry` z `ops` (obálka, `upcast` a `validate` u `op` i `inverse`, [[Q032 Kontrola payloadu operací při načítání|Q032]]). Záznam na pozici `i` musí mít `seq === i + 1`. První vadný záznam → `entry` se `seq = i + 1`.
3. **Snapshot:** obálka (`format`, `formatVersion === 1`, `atSeq` celé číslo `0 ≤ atSeq ≤ entries.length`, `document.meta.id === id`), pak `fromData(snapshot.document, schemas)` včetně migrace featur. Problém obálky se hlásí jako `DocumentLoadIssue` s cestou (`'format'`, `'atSeq'`…), vše jako `snapshot` s `which: 'latest'`.
4. Záznamy se `seq > atSeq` se aplikují po jednom přes `replayLog`. Výjimka handleru (např. featura neexistuje) → `entry` s tím `seq` a zprávou výjimky. Poškozený log je chyba dat, ne programu.
5. `createOperationLog(entries)` (všechny, kvůli undo).
6. **`verify: true`:** z `base` (zkontrolovaného jako v bodě 3, chyba → `snapshot` s `which: 'base'`) se přehraje celý log, po jednom záznamu jako v bodě 4: výjimka handleru → `entry` s tím `seq` (vadná data, ne program). Výsledné `toData` musí být hluboce rovno `toData` z bodu 4. Neshoda **vyhodí výjimku**: je to porušení [[Determinismus operací|determinismu]], tedy chyba programu, ne dat. `verify` zapíná `app` ve vývojovém režimu, testy vždy. Prstenec 1 nezná `import.meta.env`.

**Cesty v chybách** jsou relativní k chybnému objektu, stejně jako `op.`/`inverse.` v `parseLogEntry`:
- Snapshot: `'format'`, `'formatVersion'`, `'atSeq'`, problémy z `fromData` s prefixem `document.` (`'document.studio.features'`), neshoda id jako `'document.meta.id'`. Pořadí: `format`, `formatVersion`, `atSeq`, `fromData`, `meta.id`.
- Záznam: mezera v `seq` → `path: 'seq'`, výjimka handleru při přehrání → `path: 'op'` se zprávou výjimky.
- `base` musí mít navíc `atSeq === 0`, jinak `snapshot` s `which: 'base'` a `path: 'atSeq'`. Vadný base je chyba dat, ne porušení determinismu.

Známé omezení: `target` undo/redo záznamů, který neodpovídá zásobníku, `loadDocument` nezachytí. Vyhodí až `rebuildUndoStacks` v `createUndoManager`. `parseLogEntry` kontroluje jen tvar (spec 04).

Známé omezení: featury a parametry uvnitř operací se nemigrují na novou verzi schématu ([[Q035 Migrace featur v záznamech logu|Q035]]). Dokud mají všechna schémata `version: 1`, nemá to dopad.

## Export a import souboru

Pro zálohu a sdílení mezi počítači (git). Soubor `.tinycad.json`:

```ts
export interface TinycadFile {
  readonly format: 'tinycad.file';
  readonly formatVersion: 1;
  readonly snapshot: DocumentSnapshot;  // atSeq 0
}

/** Čistá funkce: aktuální stav dokumentu, bez historie. */
export function exportDocument(doc: DocumentReader): TinycadFile;

/** Ověří soubor a vytvoří z něj nový dokument (nové id a createdAt, jméno ze souboru). */
export async function importDocument(
  store: DocumentStore,
  raw: unknown,
  deps: { schemas: FeatureSchemaRegistry; newId: DocumentId; now: number },
): Promise<Result<DocumentMeta, DocumentLoadError>>;
```

- `JSON.stringify` a `JSON.parse` a práce se soubory jsou věcí UI (M10/M15). Funkce tady pracují s daty.
- Import ověří obálku souboru i snapshotu a `fromData` (migrace featur). Uloží snapshot s přepsaným `meta.id` a `createdAt` jako základní snapshot nového dokumentu. Historie se nepřenáší.
- Vadná obálka souboru (`format`, `formatVersion`) ukončí kontrolu, snapshot se už nekontroluje. Cesty jsou relativní k souboru (`'snapshot.atSeq'`, `'snapshot.document.studio'`). `snapshot.atSeq` musí být 0.
- Selhání `store.createDocument` (I/O, kolize `newId`) není chyba dat a letí jako odmítnutý `Promise`, stejně jako u `loadDocument`.
- Export i s logem (undo historie mezi počítači) přijde v M15 jako rozšíření formátu ([[Q036 Export dokumentu s historií|Q036]]).

## Testy

- **Kontraktová sada** `describeDocumentStoreContract(name, factory)` v `persistence/testing.ts`, spuštěná pro `MemoryDocumentStore` a pro `IdbDocumentStore` (`fake-indexeddb` + `MessageChannel` + skutečné RPC). Pokrývá každé pravidlo z [[#Port|kontraktu]]: chybové kódy, idempotentní přepis, atomicitu (`seq-gap` nezapíše nic), promazání snapshotů (základní zůstane), izolaci dat, řazení `listDocuments`, `deleteDocument`.
- `PersistenceService` s ručním plánovačem (`createManualScheduler` v `testing.ts`): zpoždění bez posouvání, dávka = jeden `appendEntries`, snapshot po N záznamech a jeho obsah, snapshot až po záznamech, stav a jeho události, chyba nezahodí frontu a další flush zapíše vše, retry po `retryMs`, souběžné `flush()`, `dispose`.
- `loadDocument`: **250 operací → uložení → načtení → stejné `toData`, undo vrátí poslední operaci**; snapshot + zbytek = přehrání od základu (`verify`); každá větev `LoadDocumentError` (chybějící dokument, vadný snapshot, vadný záznam, mezera v `seq`, záznam, který handler odmítne při přehrání).
- Export → import → stejné `toData` (až na `meta.id`, `createdAt`); vadný soubor → `err`.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
