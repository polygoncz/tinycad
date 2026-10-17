---
type: milestone
status: todo
order: 41
aliases:
  - M41
  - M41 Persistence v SQLite
modules:
  - server
specs:
  - "[[05-persistence]]"
  - "[[14-protokol]]"
depends_on:
  - "[[M40-dokument-a-operace-v-cpp]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M41 – Persistence v SQLite

**Cíl:** Dokumenty jako SQLite soubory s operačním logem a snapshoty, trvalé změny s idempotencí přes `operation_id`, načtení po pádu se stejným dokumentem i undo, katalog dokumentů jako aplikační služba a jednorázový import dokumentů z prohlížeče.

> Upřesněno 2026-10-17 při plánování samostatného běhu ([[Rozhodnutí nativního jádra]], N32–N39). Stopa A souběžných stop po [[M39-kostra-serveru|M39]], navazuje na [[M40-dokument-a-operace-v-cpp|M40]] ([[Roadmapa#Nativní jádro (M38–M47)]]).

**Specifikace:** [[05-persistence]] (*Co se ukládá*, *Snapshot*, *Port* – kontrakt, *Načtení dokumentu*, *Export a import souboru*), [[14-protokol]] (*Změny dokumentu*, *Idempotence*, *Chyby*), [[0030-nativni-jadro-pres-grpc|ADR 0030]] bod 7

**Navazuje na:** [[M40-dokument-a-operace-v-cpp]] (`tinycad_document`, `tinycad_ops`, `tinycad_features` se schématy)

**Zdroj pravdy o chování:** zmrazené `src/persistence/{store,snapshot,load,file}.ts` a testy `test/unit/persistence/{store,snapshot,load,file,memory-store}.test.ts` (kontraktová sada `describeDocumentStoreContract` v `src/persistence/testing.ts`). `PersistenceService` (fronta, zpoždění, retry) se **neportuje**: server zapisuje synchronně před odpovědí ([[14-protokol#Změny dokumentu]] „Uloženo = odpověď“), takže fronta a stavy `pending`/`error` nemají na serveru obdobu. Adaptér IndexedDB a worker také ne.

## Úkoly

- [ ] 1. Úložiště SQLite: katalog a soubor dokumentu (souběžně s 2)
- [ ] 2. Načtení, snapshot a soubor `.tinycad.json` (souběžně s 1)
- [ ] 3. `PersistentDocument`, `DocumentService`, nástroj `tinycad-import` a test pádu procesu

Úkoly 1 a 2 běží souběžně (dva subagenti `implementer`): 1 sahá jen do SQLite a na `ops` nezávisí (N33), 2 pracuje nad daty (`StoredDocument`) bez SQLite. Úkol 3 po sloučení obou. Úkol 1 smí začít i dřív než M40 úkol 4, potřebuje jen `tinycad_document`.

**Kontrakt pro [[M45-sezeni-pres-grpc|M45]]:** hlavičky `server/src/storage/include/tinycad/storage/{store,persistent_document,document_service}.hpp` (N32–N39). gRPC adaptér `DocumentService`, převod chyb na `google.rpc.Status` a směrování `RenameDocument` otevřeného dokumentu do sezení patří do M45 (N37 ⚠). Typy `ops` jsou v `persistent_document.hpp` jen dopředu deklarované; hlavní sezení při startu M41 srovná jména s hlavičkami, které navrhl implementátor M40.

## Akceptační kritéria

- Kontraktové testy úložiště (port pravidel `describeDocumentStoreContract` podle [[05-persistence#Port]] s úpravami N34) zelené nad skutečnými SQLite soubory v dočasném adresáři.
- **Pád procesu:** pomocný proces zapíše K změn přes `PersistentDocument` (s transakcí, undo a redo mezi nimi) a sám se ukončí `SIGKILL`; znovuotevření dá týž dokument (`sameStudio`), týž log a stejné `canUndo`/`canRedo`, undo vrátí poslední změnu. Pro K = 250 vznikne snapshot na 100 a 200 a načtení přehraje jen zbytek.
- **Idempotence:** opakovaný `dispatch`/`commit`/`undo`/`redo` se stejným `OperationKey` zapíše jeden záznam a vrátí uložený (`repeated`); i po zavření a znovuotevření souboru (obdoba restartu serveru); stejné id s jiným otiskem → `OperationIdReused`; `create` a `importFile` se stejným klíčem dají tentýž dokument.
- **`STORAGE`:** selhání zápisu (dekorátor `DocumentFile`, který selže na zavolání) vrátí `Storage` a dokument v paměti odpovídá souboru (znovu načtený, N35 ⚠); další změna se stejným klíčem projde.
- Testy načtení, exportu a importu ze [[05-persistence#Testy]] (250 operací → uložení → načtení → stejné `toData` a undo; `verify`; každá větev `LoadError`; export → import → `verify` se stejnými zásobníky undo; soubor verze 1 i s `history`; každá chyba historie s cestou; vadný soubor nic neuloží; selhání po `create` dokument smaže) zelené v C++.
- Knihovna `tinycad_storage` nezávisí na OCCT, regeneraci ani gRPC (jen `tinycad_document`, `tinycad_ops`, SQLite z vcpkg); schémata v testech z `tinycad_features` (`registerBuiltInSchemas`).

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer` (Opus, TDD). Pro všechny úkoly:

- **OOP a KISS** (Pavel, N9): třídy s jednou odpovědností – `SqliteDocumentCatalog`, `SqliteDocumentFile`, RAII obálky SQLite (`Connection`, `Statement`, `SqliteTransaction` – commit v `commit()`, rollback v destruktoru), `PersistentDocument`, `DocumentService`. Žádné ORM, žádné šablony nad SQL, žádný `std::variant`; SQL jako konstantní řetězce u metody, která je používá. Nejjednodušší kód, který projde kontraktem.
- **Kontrakt:** zafixované hlavičky `tinycad/storage/*.hpp` (výše). Implementátor je **nemění** (výjimka: jména parametrů, `#include`, srovnání jmen typů `ops` po M40 – jen v úkolu 3 a s hlášením); chybějící věc vrací jako otázku.
- **Build:** knihovna `tinycad_storage` v `server/src/storage/CMakeLists.txt` (`unofficial::sqlite3::sqlite3` z vcpkg, `cxx_std_23`), testy `server/test/storage/*_test.cpp` ve spustitelném `tinycad_storage_tests` (N25). Kořenový `CMakeLists.txt` jen `add_subdirectory`.
- **Testy** pracují v jedinečném dočasném adresáři (`std::filesystem::temp_directory_path()` + náhodná přípona, smazaný v destruktoru pomocné třídy `TempDir` v `server/test/storage/testing.hpp`). Hodiny jsou vždy injektované (`WallClock`, N33), čas se v testech nepočítá z reálných hodin.
- **Bezpečnost:** id dokumentu jde do jména souboru, proto ho katalog pustí jen ve tvaru `[A-Za-z0-9_-]{1,64}`; cokoli jiného je `Invalid` u `create` a `NotFound` u `open`/`remove` (test s `../x`, `a/b`, prázdným a dlouhým id).
- **Ověření:** cílené testy v Dockeru (`ctest -R storage`); celý `npm run check` při sloučení stopy (N2).

### 1. Úložiště SQLite: katalog a soubor dokumentu (souběžně s 2)

- **Soubory:** `server/src/storage/CMakeLists.txt`; `src/sqlite.{hpp,cpp}` (RAII obálky, převod chyby SQLite na `StoreError{Io}` s textem `sqlite3_errmsg`), `src/schema.cpp` (vytvoření tabulek a `PRAGMA`), `src/sqlite_catalog.{hpp,cpp}` (`openSqliteCatalog`), `src/sqlite_document_file.{hpp,cpp}`, `src/snapshot_keep.{hpp,cpp}` (`snapshotSeqsToKeep` – základní a 3 nejvyšší, Q009), `src/renamed_to.{hpp,cpp}` (jméno z posledního `document.rename` na nejvyšší úrovni dávky záznamů; čte jen JSON `entry.op.type` a `entry.op.name`), `src/error.cpp` (`storeErrorCodeName`); testy `server/test/storage/{catalog,document_file,snapshot_keep,renamed_to}_test.cpp`, `server/test/storage/testing.hpp` (`TempDir`, `aSnapshotJson(id, atSeq)`, `anEntryJson(seq, op)`).
- **Kontrakt:** `store.hpp`. Soubor `<id>.tinycad.sqlite`; při otevření `PRAGMA journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout=5000`; `user_version` 1 (jiná verze souboru → `Io` „unsupported format“). Tabulky:
  - `meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)` – `format` = `tinycad.sqlite`, `document_id`, `name`, `created_at`, `updated_at`, `last_seq`, `created_by_operation`, `created_by_fingerprint` (poslední dvě jen u dokumentu z `create` s klíčem);
  - `operations(seq INTEGER PRIMARY KEY, operation_id TEXT UNIQUE, fingerprint TEXT, entry TEXT NOT NULL)` – `operation_id` může být NULL (importovaná historie);
  - `snapshots(at_seq INTEGER PRIMARY KEY, snapshot TEXT NOT NULL)`.
  JSON se ukládá jako text (`Json::dump()`, čísla přes `core::numberJson` už v datech), načítá `Json::parse`; neplatný JSON v souboru je `Io`. `create` zapíše do `<id>.tinycad.sqlite.tmp` a přejmenuje (`std::filesystem::rename`), takže pád uprostřed nenechá napůl založený dokument; `list` soubory `.tmp` ignoruje a nečitelný soubor přeskočí. `remove` smaže soubor i `-wal` a `-shm`. `findCreated` projde metadata všech souborů (pro jednoho uživatele desítky souborů, N39).
- **Krajní případy:** `appendEntries` prázdné → nic (ani `updated_at`); `seq` 0 nebo záporné → `Invalid`; první `seq` ≠ `lastSeq + 1` nebo mezera v dávce → `SeqGap` a nic se nezapíše (žádný přepis uložených `seq`, N34); duplicitní `operation_id` (i uvnitř dávky) → `DuplicateOperation`; `document.rename` uvnitř `batch` jméno nemění (jen nejvyšší úroveň). `saveSnapshot` `atSeq` 0 → `Invalid`, cizí `meta.id` → `Invalid`, `atSeq > lastSeq` → `SnapshotAhead`, stejné `atSeq` přepíše, promazání nechá základní a 3 nejvyšší. Odmítnutá metoda nezmění nic (test čte tabulky přímo přes `sqlite3`).
- **Testy:** port pravidel kontraktové sady `describeDocumentStoreContract` (`test/unit/persistence/memory-store.test.ts` a `src/persistence/testing.ts`) bez izolace objektů (v C++ hodnoty) a s N34 místo přepisu: chybové kódy a jejich pořadí, atomicita (`SeqGap` nezapíše nic), řazení `list`, `remove` idempotentní, jméno z `document.rename`, promazání snapshotů (přímým čtením tabulky); `findEntry` a `findCreated`; dva `DocumentFile` nad různými dokumenty souběžně ve dvou vláknech; soubor zapsaný a zavřený se znovu otevře se stejným obsahem.
- **Hotovo když:** testy úkolu zelené v Dockeru, `tinycad_storage` linkuje jen `tinycad_document`, `tinycad_core` a SQLite.

### 2. Načtení, snapshot a soubor `.tinycad.json` (souběžně s 1)

- **Soubory:** `server/src/storage/src/snapshot.{hpp,cpp}` (`snapshotJson(const DocumentReader&, atSeq)` = `{ format: 'tinycad.snapshot', formatVersion: 1, atSeq, document }` přes `document::documentDataJson`), `src/load.{hpp,cpp}` (port `src/persistence/load.ts`: `parseEntries`, `loadSnapshot`, `loadBaseSnapshot`, `replayEach`, `loadDocument` nad `StoredDocument` – vrací dokument, záznamy pro `OperationLog` a `LoadError`), `src/tinycad_file.{hpp,cpp}` (port `src/persistence/file.ts`: `exportStoredJson(StoredDocument, …)` → JSON `TinycadFile` verze 2 s historií, `parseTinycadFile(json, …)` → ověřený obsah nebo `DocumentLoadError` s cestami relativními k souboru, bez zápisu); testy `server/test/storage/{snapshot,load,tinycad_file}_test.cpp`. Hlavičky v `src/` jsou vnitřní (navrhuje implementátor, uvede je v hlášení).
- **Kontrakt:** chování a cesty chyb přesně podle [[05-persistence#Načtení dokumentu]] a [[05-persistence#Export a import souboru]]: záznam `i` musí mít `seq == i + 1` (`path: 'seq'`), snapshot `format`/`formatVersion`/`atSeq`/`document.…`/`document.meta.id` v tomto pořadí, výjimka nebo chyba handleru při přehrání → `Entry` s `path: 'op'`, `verify` při neshodě `TINYCAD_ASSERT` (chyba programu), neshoda přehrané historie při importu → issue `history` (chyba dat). Rozbor záznamů přes `parseLogEntry` z `tinycad_ops`, přehrání přes `replayLog`/`applyOperation` z M40, `rebuildUndoStacks` při importu nesmí selhat (jinak issue `history.entries`). Funkce pracují s `StoredDocument` a JSON, ne se soubory: testy nepotřebují SQLite.
- **Testy:** port `test/unit/persistence/{snapshot,load,file}.test.ts` (bez `PersistenceService` a bez testů zmrazení a `Promise`): 250 operací → `StoredDocument` → načtení → stejné `toData`; snapshot + zbytek = přehrání od základu (`verify`); každá větev `LoadError`; export → `parseTinycadFile` → přehrání se stejnými zásobníky undo; soubor verze 1 (z M4) i verze 1 s `history`; každá chyba historie zvlášť s cestou (`formatVersion`, `history`, `history.base.atSeq`, mezera v `seq`, vadná operace, záznam odmítnutý handlerem, `snapshot.atSeq`, podvržený snapshot). Vstupy: soubory `.tinycad.json` vyrobené z TS testů lze uložit jako fixtures do `server/test/storage/fixtures/` (zdroj uvést v hlavičce souboru).
- **Hotovo když:** testy úkolu zelené v Dockeru.

### 3. `PersistentDocument`, `DocumentService`, `tinycad-import` a test pádu procesu

- **Soubory:** `server/src/storage/src/persistent_document.cpp`, `src/document_service.cpp`, `server/src/tools/tinycad_import.cpp` (spustitelný `tinycad-import`, v `server/src/tools/CMakeLists.txt`, do běhového obrazu v `server/Dockerfile`), testy `server/test/storage/{persistent_document,document_service,idempotence}_test.cpp`, `server/test/storage/crash_writer.cpp` (pomocný spustitelný soubor testu pádu) a `crash_test.cpp`, `server/test/storage/failing_file.hpp` (dekorátor `DocumentFile`, který na povel selže `Io`).
- **Kontrakt `PersistentDocument`** (`persistent_document.hpp`): trvalá metoda nejdřív `findEntry(key.id)` – nalezený záznam se stejným otiskem → `Change{entry, repeated: true}` bez aplikace (i když mezitím transakce neexistuje), s jiným otiskem → `OperationIdReused`; jinak aplikace přes dispečer M40, nové záznamy logu (`seq > lastSeq` před voláním, nejvýš jeden) se zapíšou `appendEntries` s klíčem, po záznamu se `seq % 100 == 0` snapshot (`snapshotJson`, selhání jen na `stderr`). Selhání `appendEntries` → znovu načíst stav ze souboru (`loadDocument` nad `file.load()`), vrátit `Storage`; selže-li i načtení, `broken()` a každá další změna `Storage`. Otevřená transakce se při selhání zahodí (načtený stav ji nemá). Chyby dispečeru M40 se převedou na `ChangeErrorCode` (neplatná operace s cestou, `TransactionOpen`, `NoTransaction`, `NothingToUndo`, `NothingToRedo`); reentrance a druhý `begin` zůstávají `TINYCAD_ASSERT` jen tam, kde je to chyba programu i přes RPC (jinak `TransactionOpen`, rozhodne se podle M40 a uvede v hlášení).
- **Kontrakt `DocumentService`** (`document_service.hpp`): `create` – jméno oříznuté, prázdné → `InvalidName`; nové id z `newId`, `createdAt = now()`, základní snapshot prázdného dokumentu (`rollbackIndex` 0), klíč do metadat; opakovaný klíč → tentýž dokument. `rename` – zavřený dokument otevře jako `PersistentDocument` a pošle `document.rename` přes `dispatch` s klíčem (`label` jako TS UI, např. `document.rename`). `importFile` – `parseTinycadFile`, pak `create` s klíčem, `appendEntries` (záznamy bez klíče), `saveSnapshot(n)`; selhání po `create` → `remove` (chyba úklidu se zahodí) a `Storage`. `exportFile` – `file.load()` → `exportStoredJson` → `Json::dump()` a jméno souboru. Seznam podle `updatedAt` sestupně.
- **`tinycad-import`** (N38 ⚠): `tinycad-import [--data-dir DIR] <soubor.tinycad.json | adresář>…` importuje každý soubor (adresář = všechny `*.tinycad.json` v něm, nerekurzivně) přes `DocumentService::importFile` s klíčem `import:<sha256 obsahu>` (opakované spuštění dokument nezdvojí), vypíše `ok <soubor> → <id> <jméno>` nebo `chyba <soubor>: <cesty issues>` a skončí kódem 1, když aspoň jeden selhal. Výchozí `--data-dir` z proměnné `TINYCAD_DATA_DIR`, jinak `/data/documents` (svazek v Compose). Použití: `docker compose run --rm -v ~/tinycad-export:/import core tinycad-import /import`.
- **Test pádu:** `crash_writer <dir> <K>` otevře katalog, založí dokument, provede K změn deterministickým skriptem (dispatch, transakce se 3 `apply`, undo, redo, `document.rename`), po každé vypíše `seq` na stdout a po K-té změně se ukončí `raise(SIGKILL)` bez úklidu. Test ho spustí (`posix_spawn`, čeká na konec), pak otevře dokument a porovná se stejným skriptem přehraným v paměti (`sameStudio`, `lastSeq`, `canUndo`, `canRedo`, undo vrátí poslední změnu). K = 1, 7 a 250 (snapshoty 100 a 200).
- **Testy:** idempotence podle [[14-protokol#Idempotence]] na úrovni `PersistentDocument` a `DocumentService` (dvakrát `commit` se stejným klíčem = jeden záznam; po zavření a znovuotevření souboru totéž; jiný otisk → `OperationIdReused`); `Storage` přes `failing_file.hpp` (dokument po chybě = soubor, další pokus se stejným klíčem projde); transakce: 50 `apply` + `commit` = jeden záznam, `abort` nic nezapíše, `applyTransient` nikdy v logu; `DocumentService` celý (seznam, vytvoření, přejmenování, smazání, import, export → import dá stejné `toData` a undo); `tinycad-import` nad adresářem se dvěma platnými a jedním vadným souborem.
- **Hotovo když:** akceptační kritéria splněná, celá sada `tinycad_storage_tests` zelená v jednom běhu, revize `architecture-reviewer` na konci milníku.

## Co se naučíš

SQLite jako formát souboru (WAL, `synchronous`, transakce, unikátní index), idempotentní zápis, event sourcing se snapshoty a proč server nepotřebuje frontu zápisů, kterou měl prohlížeč.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
