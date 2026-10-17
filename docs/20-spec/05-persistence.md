---
type: spec
status: implemented
order: 5
aliases:
  - persistence – ukládání
  - Úložiště SQLite
  - Spec 05
modules:
  - server
milestones:
  - "[[M04-persistence]]"
  - "[[M15-export-a-dokonceni]]"
  - "[[M41-persistence-sqlite]]"
  - "[[M47-uklid-a-dokonceni]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-17
---
# 05 – Persistence: ukládání dokumentů

> **Pojmy:** [[Snapshot]], [[Operační log]], [[Port a adaptér]], [[Idempotentní požadavek]]  
> **Rozhodnutí:** [[0005-operacni-log]], [[0009-platformove-nezavisla-domena]], [[0011-programovani-proti-rozhranim]], [[0030-nativni-jadro-pres-grpc|ADR 0030]] (bod 7)  
> **Milník:** [[M04-persistence]] (prohlížeč), [[M41-persistence-sqlite]] (SQLite na serveru)  
> **Verze v prohlížeči (IndexedDB, worker, služba s frontou):** [[05-persistence v prohlížeči]]

Ukládá operační log a občasné snapshoty dokumentu. Od [[M41-persistence-sqlite|M41]] běží **na serveru** a od [[M47-uklid-a-dokonceni|M47]] je to jediné úložiště (IndexedDB z prohlížeče zmizela): knihovna `tinycad_storage` v `server/src/storage`, jeden soubor SQLite na dokument v adresáři dat (Docker volume `tinycad-data`, `TINYCAD_DATA_DIR`, [[Rozhodnutí nativního jádra|N32, N61]]). Hlavičky jsou v `server/src/storage/include/tinycad/storage/` (`store.hpp`, `persistent_document.hpp`, `document_service.hpp`). Knihovna závisí jen na `tinycad_document`, `tinycad_ops` a SQLite, ne na OCCT ani gRPC.

Zápis portu a pravidel v TS níže zůstává zápisem kontraktu ([[Rozhodnutí nativního jádra|N128]]); kde se C++ verze liší, je to u pravidla uvedené. Klient nic neukládá: změny posílá serveru ([[14-protokol#Změny dokumentu]]) a stav ukládání odvozuje ze stavu spojení ([[11-ui#Kompoziční kořen (app)]], [[Rozhodnutí nativního jádra|N69]]).


## Co se ukládá

1. **Záznamy logu** (`LogEntry`): každá změna, append-only, nikdy se nemažou.
2. **Snapshoty** (`DocumentSnapshot`): plný stav dokumentu k danému `seq`, aby se při otevření nemusel přehrávat celý log.
3. **Seznam dokumentů** (metadata pro úvodní obrazovku, [[Q019 Úvodní obrazovka se seznamem dokumentů|Q019]]).

Geometrie se **neukládá** (cache BREP/sítí viz [[Q007 Cache geometrie|Q007]]).

Všechno uložené je čisté JSON ([[03-dokument#Serializace]]). V SQLite jsou záznamy a snapshoty uložené jako text JSON ve stejném tvaru jako v TS, takže soubor `.tinycad.json` i soubor dokumentu nesou stejná data.

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

Na serveru je port rozdělený na dvě role ([[Rozhodnutí nativního jádra|N33]]): `DocumentCatalog` (adresář: `list`, `create`, `open`, `remove`, `findCreated`) a `DocumentFile` (jeden otevřený dokument s jedním spojením SQLite: `appendEntries`, `saveSnapshot`, `load`, `findEntry`). Záznamy jdou portem jako JSON, takže úložiště nezávisí na typech `ops`. Paměťový store není: testy běží nad skutečnými soubory v dočasném adresáři.

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

// Pro adaptéry, aby kontrakt nepsaly znovu (C++: snapshot_keep.hpp, error.cpp):
/** Error s vlastností code, jak ho port předepisuje. */
export function createStoreError(code: DocumentStoreErrorCode, message: string): Error;
/** Která atSeq po uložení snapshotu zůstanou: 0 a 3 nejvyšší (Q009). */
export function snapshotSeqsToKeep(atSeqs: readonly number[]): readonly number[];
```

**Kontrakt** (ověřují ho kontraktové testy v `server/test/storage/`):

- Odmítnutí je chyba jako hodnota: `StoreError` s kódem `StoreErrorCode` (`NotFound`, `AlreadyExists`, `SeqGap`, `SnapshotAhead`, `Invalid`, od [[M41-persistence-sqlite|M41]] i `DuplicateOperation`) a `Io` pro selhání SQLite nebo souborového systému, které sezení hlásí jako `STORAGE`. (V TS to byl `Error` s vlastností `code`.)
- `appendEntries`, `saveSnapshot` na neexistující dokument → `'not-found'`.
- **`appendEntries`:**
  - Prázdné pole → nic, ani `updatedAt` se nezmění.
  - Každé `seq` musí být celé číslo ≥ 1, jinak `'invalid'`. Kontroluje se před mezerou (pořadí `'not-found'`, `'invalid'`, `'seq-gap'`).
  - Záznamy musí jít po sobě (`seq` + 1) a první musí mít `seq == lastSeq + 1`. Jinak `'seq-gap'` a nezapíše se nic. Uložený záznam se nikdy nepřepíše ([[Rozhodnutí nativního jádra|N34]]); v prohlížeči se záznam se `seq ≤ lastSeq` přepsal kvůli opakovanému zápisu z fronty po ztracené odpovědi. Na serveru idempotenci dělá `operation_id`: záznam s už uloženým `operation_id` → `DuplicateOperation` (unikátní index), opakovaný požadavek najde uložený záznam přes `findEntry` ([[14-protokol#Idempotence]]).
  - Dávka se zapíše atomicky (jedna transakce) a nastaví `lastSeq = max(lastSeq, poslední seq)` a `updatedAt = now()`.
  - **Jméno dokumentu** (M19.2, [[M19.2-ux-backlog|D5]]): když dávka obsahuje záznam, jehož operace (na nejvyšší úrovni, ne v dávce) je `document.rename`, nastaví se uložené `meta.name` podle **posledního** takového záznamu, ve stejné transakci jako záznamy. Záznam najde `renamedTo` (`server/src/storage/src/renamed_to.cpp`, čte jen `op.type` a `op.name` z JSON). `listDocuments` tak ukáže nové jméno bez načtení logu. Signatura portu se nemění.
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
- Promazání snapshotů přes port vidět nejde (`load` vrací jen nejnovější a základní). Kontraktová sada ověří jen to, že základní zůstane. Pravidlo „3 nejvyšší“ testuje `snapshotSeqsToKeep` (`server/test/storage/snapshot_keep_test.cpp`) a test souboru přímým čtením databáze.
- **Izolace dat:** store nikdy nevrací objekt, který dostal, ani objekt, který vrátil dřív. Na serveru to plyne z toho, že se ukládá text JSON a `load` ho čte znovu. (Pravidla izolace pro IndexedDB a paměťový store z [[M19.1-opravy-z-revize|M19.1]] jsou v [[05-persistence v prohlížeči]].)
- Store čas nezná sám: dostane hodiny (`WallClock`) v továrně.

### Implementace v SQLite

`openSqliteCatalog(directory, …)` (`server/src/storage/src/sqlite_catalog.cpp`) nad adresářem dat ([[Rozhodnutí nativního jádra|N32, N39, N105]]):

- **Soubor na dokument** `<id>.tinycad.sqlite`, žádná katalogová databáze: `list` projde soubory, nečitelný soubor přeskočí. Id dokumentu jde do jména souboru, proto jen `[A-Za-z0-9_-]{1,64}` (jinak `Invalid`, resp. `NotFound`).
- **Tabulky:** `meta(key, value)` (metadata dokumentu a klíč požadavku, který dokument vytvořil), `operations(seq PK, operation_id UNIQUE, fingerprint, entry)` a `snapshots(at_seq PK, snapshot)`; `PRAGMA user_version` 1 je verze formátu. Schéma zakládá `server/src/storage/src/schema.cpp`.
- **Trvanlivost:** WAL a `synchronous=FULL`; každá metoda je jedna transakce SQLite a kontrakt kontroluje před zápisem.
- **Vytvoření je atomické:** nový dokument vzniká v dočasném souboru (rollback journal) a přejmenuje se, WAL se zapne až po přejmenování. Pád tak nenechá napůl založený dokument.
- RAII obálky SQLite (`Connection`, `Statement`, `SqliteTransaction`) jsou v `server/src/storage/src/sqlite.{hpp,cpp}`.

Proč SQLite a ne IndexedDB nebo Postgres: [[0030-nativni-jadro-pres-grpc|ADR 0030]] bod 7. Implementace v prohlížeči (`MemoryDocumentStore`, `IdbDocumentStore`, worker, schéma IndexedDB) je v [[05-persistence v prohlížeči]].

## Zápis na serveru: `PersistentDocument`

Služba s frontou zápisů a časovačem z prohlížeče na serveru není (archiv: [[05-persistence v prohlížeči#Služba na hlavním vlákně]]). Otevřený dokument drží `PersistentDocument` (`server/src/storage/include/tinycad/storage/persistent_document.hpp`, [[Rozhodnutí nativního jádra|N35, N36]]): dokument, log, dispečer a undo z `tinycad_ops` nad jedním `DocumentFile`. Běhový dokument sezení ([[14-protokol#Sezení]]) ho obaluje.

- **Uloženo = odpovězeno.** `dispatch`, `commit`, `undo` a `redo` zapíší svůj záznam do SQLite **před** návratem, nejvýš jeden záznam na volání. Kroky otevřené transakce zůstávají jen v paměti, takže fronta ani zpoždění nejsou potřeba.
- **Trvalá idempotence:** každé volání nese `OperationKey` (`operation_id` a otisk požadavku). Uložené `operation_id` vrátí uložený záznam bez nové aplikace; stejné id s jiným otiskem → `OPERATION_ID_REUSED` ([[14-protokol#Idempotence]]).
- **Snapshot** po každém 100. záznamu (`seq % 100 == 0`) ve stejném volání; jeho selhání není chyba změny (záznam je uložený), jen se vypíše.
- **Selhání zápisu** → `STORAGE` a dokument v paměti se **znovu načte ze souboru**, místo aby se aplikovala inverze ([[Rozhodnutí nativního jádra|N35]] ⚠). Log v paměti tak vždy odpovídá disku. Selže-li i načtení, dokument je rozbitý a každá další změna vrací `STORAGE`.

V klientovi stav ukládání (`PersistenceStatus` `saved`/`pending`/`error`/`failed` v titulku) vychází z fronty nepotvrzených změn a stavu spojení ([[Rozhodnutí nativního jádra|N69, N92, N134]]).

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
  deps: { schemas: RegistryReader<FeatureSchema>; handlers: OpHandlerRegistry; verify?: boolean },
): Promise<Result<LoadedDocument, LoadDocumentError>>;
```

Na serveru `loadDocument` v `server/src/storage/src/load.{hpp,cpp}` nad `StoredDocument` (JSON, bez SQLite), volá ho `PersistentDocument` při otevření. Tvar chyby rozhodla [[Q033 Tvar chyby při načtení dokumentu|Q033]]. Chyba I/O storu není chyba dat a letí jako odmítnutý `Promise`.

1. `store.load(id)`. `undefined` → `not-found`.
2. **Záznamy:** každý projde `parseLogEntry` z `ops` (obálka, `upcast` a `validate` u `op` i `inverse`, [[Q032 Kontrola payloadu operací při načítání|Q032]]). Záznam na pozici `i` musí mít `seq === i + 1`. První vadný záznam → `entry` se `seq = i + 1`.
3. **Snapshot:** obálka (`format`, `formatVersion === 1`, `atSeq` celé číslo `0 ≤ atSeq ≤ entries.length`, `document.meta.id === id`), pak `fromData(snapshot.document, schemas)` včetně migrace featur. Problém obálky se hlásí jako `DocumentLoadIssue` s cestou (`'format'`, `'atSeq'`…), vše jako `snapshot` s `which: 'latest'`.
4. Záznamy se `seq > atSeq` se aplikují po jednom přes `replayLog`. Výjimka handleru (např. featura neexistuje) → `entry` s tím `seq` a zprávou výjimky. Poškozený log je chyba dat, ne programu.
5. `createOperationLog(entries)` (všechny, kvůli undo).
6. **`verify: true`:** z `base` (zkontrolovaného jako v bodě 3, chyba → `snapshot` s `which: 'base'`) se přehraje celý log, po jednom záznamu jako v bodě 4: výjimka handleru → `entry` s tím `seq` (vadná data, ne program). Výsledné `toData` musí být hluboce rovno `toData` z bodu 4. Neshoda **vyhodí výjimku**: je to porušení [[Determinismus operací|determinismu]], tedy chyba programu, ne dat. `verify` zapínají testy (v běhovém dokumentu serveru je ve výchozím stavu vypnuté, `RuntimeDocument` deps `verify`).

**Cesty v chybách** jsou relativní k chybnému objektu, stejně jako `op.`/`inverse.` v `parseLogEntry`:
- Snapshot: `'format'`, `'formatVersion'`, `'atSeq'`, problémy z `fromData` s prefixem `document.` (`'document.studio.features'`), neshoda id jako `'document.meta.id'`. Pořadí: `format`, `formatVersion`, `atSeq`, `fromData`, `meta.id`.
- Záznam: mezera v `seq` → `path: 'seq'`, výjimka handleru při přehrání → `path: 'op'` se zprávou výjimky.
- `base` musí mít navíc `atSeq === 0`, jinak `snapshot` s `which: 'base'` a `path: 'atSeq'`. Vadný base je chyba dat, ne porušení determinismu.

`target` undo/redo záznamů, který neodpovídá zásobníku, hlásí server od úklidu po M44 ([[Rozhodnutí nativního jádra|N108]]): `rebuildUndoStacks` vrací chybu a `loadDocument` ji hlásí jako `LoadError` záznamu s cestou `target`; načítání logu nekopíruje surový JSON (kopie v nlohmann je rekurzivní) a `batch` vnořený hlouběji než 64 odmítne (N113).

Featury a parametry uvnitř záznamů se migrují až při `apply` během přehrání ([[04-operace-a-historie#Migrace dat featur]], [[Q035 Migrace featur v záznamech logu|Q035]]); `parseLogEntry` schémata nepotřebuje. Selhání migrace je chyba `entry` jako každá jiná výjimka handleru (bod 4). Registr `handlers` musí vzniknout se **stejnými** `schemas`, jaké dostane `loadDocument` (`createOpHandlerRegistry({ schemas })`): dva různé registry schémat by migrovaly snapshot a záznamy jinak; nic to nehlídá, kompoziční kořen (`CoreServer`) má jediný registr.

### Jeden zapisovatel na dokument

Dvě záložky se stejným dokumentem by zapisovaly `seq` od stejného `lastSeq` a přepsaly si log ([[Q038 Jeden dokument ve dvou záložkách|Q038]]). Na serveru je dokument v paměti nejvýš jednou (běhový dokument) a zámek pro zápis má první sezení; ostatní sezení jsou jen pro čtení a změny odmítnou `READ_ONLY` ([[14-protokol#Sezení]], [[Q102 Sezení pro více karet|Q102]]). Web Lock záložky z prohlížeče je v [[05-persistence v prohlížeči#Jeden zapisovatel na dokument]].

## Export a import souboru

Pro zálohu a sdílení mezi počítači (git). Na serveru je implementuje aplikační služba `storage::DocumentService` (`document_service.hpp`, `server/src/storage/src/tinycad_file.cpp`), kterou volají RPC `ExportDocument` a `ImportDocument` ([[14-protokol]]) a nástroj `tinycad-import` (`server/src/tools/tinycad_import.cpp`, import souborů nebo adresáře, klíč `import:<sha256>`, opakování nezdvojí, [[Rozhodnutí nativního jádra|N38, N131]]). Soubor `.tinycad.json`, od [[M15-export-a-dokonceni|M15]] verze 2 s volitelnou historií ([[Q036 Export dokumentu s historií|Q036]], [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R125]]):

```ts
export interface TinycadFile {
  readonly format: 'tinycad.file';
  readonly formatVersion: 2;                 // M4 psal 1 (bez historie); import čte obě
  readonly snapshot: DocumentSnapshot;       // stav dokumentu; atSeq = history.entries.length, bez historie 0
  readonly history?: TinycadHistory;         // M15
}

export interface TinycadHistory {
  readonly base: DocumentSnapshot;           // atSeq 0: stav, ze kterého log začíná
  readonly entries: readonly LogEntry[];     // celý log, seq 1..n bez mezer
}

/** Čistá funkce: aktuální stav dokumentu, bez historie (formatVersion 2, atSeq 0). */
export function exportDocument(doc: DocumentReader): TinycadFile;

/** Uložený dokument i s historií: stav jako loadDocument (bez verify), základní snapshot a celý log. */
export async function exportStoredDocument(
  store: DocumentStore,
  id: DocumentId,
  deps: { schemas: RegistryReader<FeatureSchema>; handlers: OpHandlerRegistry },
): Promise<Result<TinycadFile, LoadDocumentError>>;

/** Ověří soubor a vytvoří z něj nový dokument (nové id a createdAt, jméno ze souboru), i s historií. */
export async function importDocument(
  store: DocumentStore,
  raw: unknown,
  deps: { schemas: RegistryReader<FeatureSchema>; handlers: OpHandlerRegistry; newId: DocumentId; now: number },
): Promise<Result<DocumentMeta, DocumentLoadError>>;
```

- Stažení souboru a výběr souboru k importu jsou věcí UI a `app` (`app/remote-file-exporter.ts`, [[11-ui#Kompoziční kořen (app)]]). Funkce tady pracují s daty.
- **Proč export z uloženého stavu:** historie potřebuje základní snapshot, který má jen store (dokument mohl vzniknout importem, [[Q036 Export dokumentu s historií|Q036]]), a stav musí odpovídat logu – živý dokument během otevřeného dialogu obsahuje i nezapsanou transakci. Klient proto export vyžádá až po vyprázdnění fronty změn; server log drží vždy, takže export bez historie už není. Dokument otevřený jen pro čtení exportuje, co je uložené (může být novější než zobrazené, R125 ⚠).
- `exportStoredDocument`: neexistující id → `not-found`; záznamy, snapshot a přehrání jako `loadDocument` (stejné chyby); základní snapshot se zkontroluje jako při `verify` (chyba → `snapshot` s `which: 'base'`). `snapshot` = `createSnapshot(stav, n)`, `history.base` = snapshot základního dokumentu po `fromData` (featury migrované na aktuální verzi), `history.entries` = záznamy po `parseLogEntry` (operace v aktuální verzi). Výsledek je zmrazený a čisté JSON.
- **Import** ověří obálku (`format`, `formatVersion` 1 nebo 2) a snapshot (`fromData`, migrace featur). Vadná obálka souboru ukončí kontrolu. Cesty jsou relativní k souboru (`'snapshot.atSeq'`, `'snapshot.document.studio'`, `'history.base.atSeq'`, `'history.entries[3].op.featureId'`).
  - **Bez historie** (verze 1 nebo verze 2 bez `history`): `snapshot.atSeq` musí být 0. Historii zná jen verze 2: soubor verze 1 s polem `history` se čte přesně jako v M4 a `history` se **ignoruje** (ne chyba). Uloží snapshot s přepsaným `meta.id` a `createdAt` jako základní snapshot nového dokumentu (jako v M4).
  - **S historií:** `history` je objekt, `history.base` snapshot s `atSeq` 0, `history.entries` pole záznamů (`parseLogEntry`, `seq === i + 1`), `snapshot.atSeq === entries.length`. Pak se `base` přehraje záznamy po jednom (výjimka handleru → issue `history.entries[i]` se zprávou), `rebuildUndoStacks` nesmí vyhodit (jinak issue `history.entries`) a `toData` přehraného studia musí být hluboce rovno studiu snapshotu (jinak issue `history`, „Replayed history does not match the snapshot“). Na rozdíl od `verify` při načtení je neshoda **chyba dat** (soubor zvenku mohl někdo upravit), ne chyba programu. Kontrola skončí u první vadné skupiny v pořadí obálka → snapshot → base → záznamy → přehrání. Do skupin patří (podle kódu): **obálka** = `format`, `formatVersion` a `history`, které není objekt (hlásí se spolu); **snapshot** = tvar `snapshot` (`atSeq` jen jako celé číslo ≥ 0); **base**; **záznamy** = `history.entries`, které není pole, záznamy (`parseLogEntry`, `seq`) a teprve **po** jejich rozboru `snapshot.atSeq === entries.length` (přesné `n` je známé až ze záznamů); **přehrání** = handlery, `rebuildUndoStacks`, shoda se snapshotem.
  - Uložení: `meta = { ...snapshot.document.meta, id: newId, createdAt: now }` v základním snapshotu i ve stavu; `createDocument(meta, base)`, pak (je-li historie neprázdná) `appendEntries(entries)` a `saveSnapshot(stav s atSeq n)`. Undo historie se tak přenese ([[04-operace-a-historie#Undo / redo|zásobníky]] se spočítají z logu při otevření).
- Vadný soubor neuloží nic. Selhání storu (I/O, kolize `newId`) není chyba dat, ale `StoreError` (dřív odmítnutý `Promise`), stejně jako u `loadDocument`; selže-li zápis až po `createDocument`, import zkusí nový dokument smazat (`deleteDocument`, chyba úklidu se zahodí), aby v seznamu nezůstal napůl importovaný.
- Přenos dokumentů z IndexedDB prohlížeče: po M47 jen z checkoutu před M47 (tlačítko z M46 nebo export a `tinycad-import`, [[Rozhodnutí nativního jádra|N126]]).

## Testy

Od [[M41-persistence-sqlite|M41]] v C++, `server/test/storage/` (testy TS verze jsou v [[05-persistence v prohlížeči#Testy]]):

- **Kontraktové testy úložiště** (port `describeDocumentStoreContract` s úpravami [[Rozhodnutí nativního jádra|N34]]) nad skutečnými soubory SQLite v dočasném adresáři: `catalog_test.cpp`, `document_file_test.cpp` – chybové kódy, přísné `seq`, `DuplicateOperation`, atomicita, promazání snapshotů, řazení `list`, `remove`, nebezpečné id; `snapshot_keep_test.cpp`, `renamed_to_test.cpp`.
- **Načtení a soubor:** `load_test.cpp` (každá větev `LoadDocumentError`, 250 operací → uložení → načtení → stejný dokument a undo, `verify`), `snapshot_test.cpp`, `tinycad_file_test.cpp` (export → import, soubor verze 1 z M4, každá chyba historie s cestou, vadný soubor nic neuloží).
- **`PersistentDocument`:** `persistent_document_test.cpp`, `idempotence_test.cpp` (jeden záznam pro stejné `operation_id`, `OPERATION_ID_REUSED`), selhání zápisu dekorátorem `failing_file.hpp` → znovunačtení (N35), snapshot po 100 záznamech.
- **Pád procesu:** `crash_test.cpp` – proces zabitý uprostřed zápisu, znovuotevření dá týž dokument i undo.
- **Služba a import:** `document_service_test.cpp`, `tinycad_import_test.cpp`.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
