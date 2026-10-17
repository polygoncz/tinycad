---
type: milestone
status: done
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
started: 2026-10-13
finished: 2026-10-13
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-17
---
# M4 – Persistence

**Cíl:** operační log a snapshoty se ukládají do IndexedDB ve workeru; dokument jde načíst a pokračovat v práci včetně undo.

**Specifikace:** [[05-persistence|05 – persistence]]

**Navazuje na:** [[M03-operace]]

## Úkoly

- [x] `ops`: `validate` u handlerů a `parseLogEntry` ([[Q032 Kontrola payloadu operací při načítání|Q032]]).
- [x] `DocumentSnapshot`, port `DocumentStore`.
- [x] `MemoryDocumentStore`.
- [x] Kontraktové testy `DocumentStore` (sdílená sada spouštěná pro každou implementaci).
- [x] `IdbDocumentStore` – worker `persistence.worker.ts` s IndexedDB (stores `documents`, `entries`, `snapshots`), klient přes `core/rpc`. V testech `fake-indexeddb` a `MessageChannel` místo workeru.
- [x] `PersistenceService` – dávkování (`flushMs`), snapshot každých N záznamů, stav `saved/pending/error`, retry.
- [x] `loadDocument` – snapshot + upcast + přehrání zbytku + `createOperationLog(entries)` + kontrola konzistence (`verify`).
- [x] Export/import `.tinycad.json` (čisté funkce, UI až v M10/M15).

## Akceptační kritéria

- Kontraktové testy projdou pro obě implementace.
- Scénář: 250 operací → uložení → `loadDocument` → stav shodný, undo vrátí poslední operaci.
- Snapshot + zbytek logu = přehrání od nuly (test).
- Chyba zápisu nezahodí frontu.

## Implementační plán

Každý úkol dělá zvlášť subagent `implementer` (TDD, `npm run check`). Kontrakt je v [[05-persistence|spec 05]] a pro Ú1 v [[04-operace-a-historie|spec 04]], úkoly odkazují sekcemi. Veřejné API jen přes `src/persistence/index.ts`, resp. `src/persistence/idb/index.ts` a `src/ops/index.ts`. Testovací pomůcky v `src/persistence/testing.ts`. Úkoly jdou v tomto pořadí.

### Ú1 `ops`: kontrola payloadu a načtení záznamu logu
- **Soubory:** `src/ops/op-handler.ts` (`validate?`), `src/ops/handlers/*.ts` (`validate` u sedmi handlerů), `src/ops/upcast.ts` (volání `validate`), nový `src/ops/parse-entry.ts` (`parseLogEntry`), testy vedle, export z `src/ops/index.ts`.
- **Kontrakt:** [[04-operace-a-historie#Přehrání a upcast]], [[04-operace-a-historie#Načtení záznamu logu]].
- **Testy:** viz [[04-operace-a-historie#Testy]] (řádky `validate` a `parseLogEntry`). Stávající testy `upcastOperation` musí projít beze změny.
- **Hotovo když:** testy a `npm run check` projdou; `parseLogEntry` exportované z `ops`.

### Ú2 Snapshot, port, `MemoryDocumentStore` a kontraktová sada
- **Soubory:** `src/persistence/snapshot.ts` (`DocumentSnapshot`, `createSnapshot`), `src/persistence/store.ts` (`DocumentStore`, `DocumentInfo`, `StoredDocument`, `DocumentStoreErrorCode`, `storeErrorCode`, vnitřní třída chyby s `code`), `src/persistence/memory-store.ts` (`createMemoryDocumentStore`), `src/persistence/testing.ts` (`describeDocumentStoreContract(name, factory)`, kde `factory: (deps: { now: () => number }) => Promise<DocumentStore>` vytvoří pro každý test čerstvý, prázdný store; čas řídí sada přes `now`), `src/persistence/memory-store.test.ts` (spustí sadu), `src/persistence/index.ts`.
- **Kontrakt:** [[05-persistence#Snapshot]], [[05-persistence#Port]].
- **Testy:** kontraktová sada podle [[05-persistence#Testy]], pokrývá každou odrážku kontraktu portu. Sada je napsaná proti rozhraní, nezná implementaci.
- **Hotovo když:** sada projde pro paměťový store, `npm run check` projde.

### Ú3 `IdbDocumentStore`
- **Soubory:** `src/persistence/idb/idb-store.ts` (`createIdbStoreImpl`), `protocol.ts`, `client.ts`, `persistence.worker.ts`, `index.ts` (`createIdbDocumentStore`), `idb-store.test.ts`. Nová dev závislost `fake-indexeddb` (jen testy).
- **Kontrakt:** [[05-persistence v prohlížeči#Adaptér IndexedDB a worker]], [[05-persistence v prohlížeči#Schéma IndexedDB]], kontrakt portu jako v Ú2.
- **Testy:** stejná kontraktová sada z `persistence/testing.ts`, kde `factory` vytvoří čerstvou `fake-indexeddb` (`new IDBFactory()`), `MessageChannel`, `serveRpc` na jednom portu a `createDocumentStoreClient` na druhém. Navíc: chybový kód přežije RPC.
- **Hotovo když:** sada projde pro oba story, `npm run check` (včetně `lint:deps`: `idb` importuje jen `core`, `document`, `ops`, `persistence`) projde.

### Ú4 `PersistenceService`
- **Soubory:** `src/persistence/service.ts`, `service.test.ts`, `createManualScheduler()` v `testing.ts`.
- **Kontrakt:** [[05-persistence v prohlížeči#Služba na hlavním vlákně]].
- **Testy:** viz [[05-persistence#Testy]] (`PersistenceService`), nad `MemoryDocumentStore`, skutečným logem a dispečerem z `ops` (`anOpsSession`). Chyba zápisu se simuluje obalem storu, který vybrané volání odmítne.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú5 `loadDocument`
- **Soubory:** `src/persistence/load.ts`, `load.test.ts`.
- **Kontrakt:** [[05-persistence#Načtení dokumentu]].
- **Testy:** viz [[05-persistence#Testy]] (`loadDocument`), včetně akceptačního scénáře 250 operací (`snapshotEvery` 100 → snapshoty na 100 a 200, zbytek 50 záznamů) a `verify`. Vadná data se do storu dostanou přímým zápisem přes `appendEntries`/`saveSnapshot` s ručně rozbitým objektem (přetypování jen v testu).
- **Hotovo když:** testy a `npm run check` projdou; akceptační kritéria 2 a 3 jsou pokrytá pojmenovanými testy.

### Ú6 Export a import
- **Rozsah:** jen stav, bez historie ([[Q036 Export dokumentu s historií|Q036]]).
- **Soubory:** `src/persistence/file.ts`, `file.test.ts`.
- **Kontrakt:** [[05-persistence#Export a import souboru]].
- **Testy:** export → `JSON.stringify` → `JSON.parse` → import → stejné `toData` až na `meta.id` a `createdAt`; vadná obálka, vadný snapshot, novější `formatVersion` → `err`.
- **Hotovo když:** testy a `npm run check` projdou.

## Co se naučíš

IndexedDB (transakce, object stores, složené klíče), web worker jako služba, kontraktové testování portů.

## Retrospektiva

> _Návrh od Clauda – Pavel doplní nebo upraví._

**Co bylo jinak, než se čekalo**
- Spec 05 vypadala jednoduše (šest metod portu), ale dotažení na kontrakt odhalilo, že většina práce je v **selháních**: idempotentní přepis při retry, snapshot „z budoucnosti“, atomicita dávky, lepivý stav `error`, pořadí kontrol. Z jedné odrážky „chyba zápisu nezahodí frontu“ se stalo deset pravidel.
- Spec napsaná před [[0009-platformove-nezavisla-domena|ADR 0009]] ho nevědomky porušovala (`visibilitychange` ve službě, [[Q034 Uložení při zavírání stránky|Q034]]). Časovače musely jít přes `Scheduler`, protože `setTimeout` v prstenci 1 neexistuje.
- Kontrola konzistence „přehrání od nuly“ potřebovala **základní snapshot** (`atSeq 0`). Bez něj nejde přehrávat importovaný dokument a promazávání podle [[Q009 Promazávání starých snapshotů|Q009]] by ho smazalo.
- Testy adaptéru IndexedDB v Node potřebovaly typy DOM: nový `tsconfig.test-idb.json`. Typové prostředí se ukázalo jako součást architektury.
- `architecture-reviewer` znovu našel díru typu [[Q030 Výjimka odběratele po změně dokumentu|Q030]]: výjimka odběratele `status` mohla zabránit naplánování flush nebo retry, takže by se data tiše přestala ukládat. K tomu dvě skutečné návrhové díry mimo rozsah M4 ([[Q037 Pád workeru a čekající RPC volání|Q037]], [[Q038 Jeden dokument ve dvou záložkách|Q038]]).
- Při čtení vyplynula díra, kterou nikdo nečekal: featury uvnitř operací v logu se nemigrují ([[Q035 Migrace featur v záznamech logu|Q035]]).

**Co se osvědčilo**
- **Kontraktová sada** psaná jen proti rozhraní a spuštěná pro paměťový store i IDB přes skutečné RPC (`MessageChannel` + `fake-indexeddb`). IDB adaptér prošel bez jediné změny sady. Chyby přes `code`, ne `instanceof`, protože třída přes `postMessage` nepřežije.
- Store vrací `unknown` a parsuje se na jednom místě (`loadDocument`, `parseLogEntry`), jak říká [[Parse, don't validate]].
- Implementer se zastavil s přesnou otázkou 4× (test s neplatným payloadem, typy DOM v testech, díry v kontraktu portu a služby). Každá skončila jako řádek ve spec, ne jako tiché rozhodnutí.
- Ověření testů záměrně vloženou chybou (store nekopíruje → 6 testů padá) se stalo běžnou součástí úkolu.

**Co příště jinak**
- U Ú5 implementer napsal testy až po kódu. Červenou fázi TDD nahradil vloženými chybami. Funguje to, ale do zadání implementera je dobré výslovně psát „test nejdřív, ověř, že padá“.
- Na pořadí „nejdřív stav, pak notifikace“ (Q030) je potřeba myslet při každé službě, která emituje. Stojí za to mít ho v checklistu spec.
