---
type: spec
status: implemented
order: 5
aliases:
  - 05-persistence v prohlížeči
  - Persistence v IndexedDB
modules:
  - persistence
milestones:
  - "[[M04-persistence]]"
  - "[[M15-export-a-dokonceni]]"
tags:
  - spec
  - archiv
created: 2026-10-17
updated: 2026-10-17
---
# 05 – Persistence v prohlížeči (archiv)

Archivováno v [[M47-uklid-a-dokonceni|M47]] ([[Rozhodnutí nativního jádra|N128]]). Aktuální specifikace je [[05-persistence]]: dokumenty od [[M41-persistence-sqlite|M41]] ukládá server do SQLite. Tato poznámka drží části, které popisovaly verzi v prohlížeči do [[M46-klient-nad-read-modelem|M46]]: modul `persistence` s adaptérem `persistence/idb` (IndexedDB ve Web Workeru), službu s frontou zápisů a zámek záložky. Kód smazal M47 úkol 3, je v historii gitu před M47. Text je přenesený beze změny.

## Úvod a části modulu

Ukládá operační log a občasné snapshoty do IndexedDB ([[Q008 OPFS nebo IndexedDB|Q008]]). Zápis běží ve Web Workeru, hlavní vlákno jen předává záznamy. Závisí na `core`, `document`, `ops`.

Modul má dvě části s různými prstenci ([[01-architektura#Tři prstence]]):
- `persistence` (prstenec 1, bez DOM): snapshot, port `DocumentStore`, `MemoryDocumentStore`, `PersistenceService`, `loadDocument`, export a import.
- `persistence/idb` (prstenec 3): adaptér nad IndexedDB a worker. Importuje ho jen `app`.

## Implementace portu, adaptér IndexedDB a schéma

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
export type PersistenceStatus = 'saved' | 'pending' | 'error' | 'failed';  // 'failed': trvalá chyba storu (M19.1)

export interface PersistenceService extends Disposable {
  /** Zapíše frontu. Volání během běžícího flush počká a pak zapíše, co zbylo. Při chybě odmítne. */
  flush(): Promise<void>;
  readonly status: PersistenceStatus;
  /** Text poslední chyby; null právě mimo 'error' a 'failed' (M19.1). */
  readonly lastError: Observable<string | null>;
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
- **Stav `error` je lepivý:** nový záznam ho nepřepne na `pending`. Zůstává, dokud se zápis nepovede, aby uživatel dál viděl, že ukládání selhává. Opakovaná chyba novou událost nevyšle (stav se nemění). Poslední chybu nese `lastError: Observable<string | null>` (od [[M19.1-opravy-z-revize|M19.1]]): text `Error.message`, není `null` právě ve stavech `'error'` a `'failed'`. Při chybě se nastaví nejdřív text, pak stav. Po úspěchu nejdřív stav, pak `null`.
- **Trvalá chyba** ([[M19.1-opravy-z-revize|M19.1]], D4): chyba zápisu s kódem storu (`storeErrorCode(e) !== undefined`: `not-found`, `invalid`, `seq-gap`, `snapshot-ahead`) se neopakuje. Stav je `'failed'` až do konce služby, fronta i snapshot se zahodí a nové záznamy se už neřadí, protože by je nic nezapsalo. `flush()` pak hned odmítne s původní chybou a store nevolá. Ostatní chyby (I/O) se opakují jako dosud (`'error'`). Dřív se trvalá chyba opakovala každých 5 s navždy a export čekal na flush, takže selhal přesně tehdy, když bylo úložiště rozbité. Export pak stáhne živý dokument bez historie ([[11-ui#Kompoziční kořen (app)]]). `close()` po `'failed'` odmítne chybou storu.
- **Snapshot a selhání:** snapshot, jehož záznamy se nepodařilo zapsat, čeká ve frontě. Novější snapshot ho nahradí. Když záznamy projdou a selže jen `saveSnapshot`, záznamy se z fronty odeberou a další flush uloží jen snapshot.
- Zápis bere dávku až ve chvíli, kdy opravdu začíná. Záznam přidaný hned po zavolání `flush()` se do ní ještě dostane.
- Na `pagehide` a `visibilitychange` (hidden) volá `flush()` **`app`**, ne služba ([[Q034 Uložení při zavírání stránky|Q034]]).
- **Výjimka odběratele `status`** ([[Q030 Výjimka odběratele po změně dokumentu|Q030]]): služba nejdřív dokončí vlastní stav (fronta, snapshot, naplánovaný flush nebo retry) a teprve pak emituje. Výjimka odběratele pak letí ven: z `flush()` (data jsou ale uložená, resp. retry naplánovaný), u `appended` do logu, který ji podle Q030 sbírá. Výjimka odběratele nikdy nesmí zabránit naplánování flush nebo retry. Při selhání storu i odběratele odmítne `flush()` chybou `AggregateError([chyba storu, chyba odběratele])`. U flush spuštěného časovačem na výsledek nikdo nečeká, takže se výjimka odběratele ztratí. Prstenec 1 nemá kam logovat (ADR 0009) a odběratelé `status` mají být jednoduchá UI vazba.
- `dispose()`: odhlásí odběr logu a zruší naplánovaný flush. Neukládá, volající má předtím zavolat `flush()`. `flush()` po `dispose()` ještě zapíše, co zůstalo ve frontě, ale po chybě už nic nenaplánuje.

## Jeden zapisovatel na dokument

Dvě záložky se stejným dokumentem by zapisovaly `seq` od stejného `lastSeq` a přepsaly si log ([[Q038 Jeden dokument ve dvou záložkách|Q038]]). Hlídá to `app`, ne port: před `loadDocument` požádá o Web Lock (`navigator.locks.request('tinycad-doc-<id>', { ifAvailable: true }, …)`) a drží ho po celou dobu sezení. Zámek se uvolní i při pádu nebo zavření záložky. Záložka, která zámek nedostane, otevře dokument **jen pro čtení**: nevytvoří `PersistenceService`, dispečer odmítá operace a UI ukáže hlášku „otevřeno v jiné záložce“. Pojistka `'conflict'` v kontraktu `DocumentStore` se zatím nedělá.

## Testy

- **Kontraktová sada** `describeDocumentStoreContract(name, factory)` v `persistence/testing.ts`, spuštěná pro `MemoryDocumentStore` a pro `IdbDocumentStore` (`fake-indexeddb` + `MessageChannel` + skutečné RPC). Pokrývá každé pravidlo z [[#Port|kontraktu]]: chybové kódy, idempotentní přepis, atomicitu (`seq-gap` nezapíše nic), promazání snapshotů (základní zůstane), izolaci dat, řazení `listDocuments`, `deleteDocument`.
- `PersistenceService` s ručním plánovačem (`createManualScheduler` v `testing.ts`): zpoždění bez posouvání, dávka = jeden `appendEntries`, snapshot po N záznamech a jeho obsah, snapshot až po záznamech, stav a jeho události, chyba nezahodí frontu a další flush zapíše vše, retry po `retryMs`, souběžné `flush()`, `dispose`.
- `loadDocument`: **250 operací → uložení → načtení → stejné `toData`, undo vrátí poslední operaci**; snapshot + zbytek = přehrání od základu (`verify`); každá větev `LoadDocumentError` (chybějící dokument, vadný snapshot, vadný záznam, mezera v `seq`, záznam, který handler odmítne při přehrání).
- Export → import → stejné `toData` (až na `meta.id`, `createdAt`); vadný soubor → `err`.
- **M15:** `exportStoredDocument` → `importDocument` → `loadDocument(…, { verify: true })` dá stejné `toData` a stejné undo zásobníky (log s undo, redo a dávkou); soubor projde `JSON.parse(JSON.stringify(…))`; soubor verze 1 z M4 se načte; soubor verze 1 s `history` se načte bez historie; každá chyba historie zvlášť s cestou (`formatVersion`, `history`, `history.base.atSeq`, mezera v `seq`, vadná operace, záznam odmítnutý handlerem, `snapshot.atSeq`, podvržený snapshot); vadný soubor nic neuloží; selhání `appendEntries` po `createDocument` dokument smaže a odmítne.
