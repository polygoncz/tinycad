---
type: milestone
status: todo
order: 46
aliases:
  - M46
  - M46 Klient nad read modelem
modules:
  - remote
  - app
  - interaction
  - ui
specs:
  - "[[14-protokol]]"
  - "[[01-architektura]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M45-sezeni-pres-grpc]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M46 – Klient nad read modelem

**Cíl:** Prohlížeč pracuje proti serveru: sezení, operace a transakce přes `remote`, dokument jako optimistické zrcadlo read modelu, sítě z mezipaměti podle `content_version`, dialog ze `FeatureTypeDescriptor`, seznam dokumentů přes `DocumentService`. `interaction`, `sketcher`, `render` a `ui` zůstanou skoro beze změny: nové jsou adaptéry jejich dnešních portů.

> Upřesněno 2026-10-17 při plánování samostatného běhu ([[Rozhodnutí nativního jádra]], N63–N75). Začíná po sloučení [[M45-sezeni-pres-grpc|M45]] do `main`; nedělí se na stopy (Pavel 2026-10-17), uvnitř milníku ale běží až tři implementátoři souběžně.

**Specifikace:** [[14-protokol]], [[01-architektura]] (moduly `remote`, `app`), [[09-vykreslovani]] (`SceneSync`, výměna sítí), [[10-interakce]] (porty `RegenStatusPort`, `OperationDispatcher`, dialog featury, skicář), [[11-ui]] (kompoziční kořen, stav jádra a ukládání), [[0030-nativni-jadro-pres-grpc|ADR 0030]], [[Q097 Transakce a undo přes RPC|Q097]], [[Q098 Schéma featur v klientovi|Q098]], [[Q100 Verze sítí v mezipaměti klienta|Q100]], [[Q102 Sezení pro více karet|Q102]], [[Q103 Skica, kterou server nevyřeší|Q103]], [[Q106 Moduly klienta pro gRPC|Q106]]

**Navazuje na:** [[M45-sezeni-pres-grpc]] (celý `SessionService` a `DocumentService`, doplňky kontraktu N56), [[M39-kostra-serveru]] (`remote`, `protocol`, `GeometryService`, Compose, Envoy)

## Úkoly

- [ ] 1. Základy `remote`: chyby, převody operací, read modelu a popisů typů, falešné jádro pro testy, pravidla závislostí
- [ ] 2. `RemoteSession` (fronta změn, opakování, nové sezení, stream) a `RemoteDocuments` (souběžně s 3 a 4)
- [ ] 3. Zrcadlo dokumentu a fasáda dispečeru, transakcí a undo; port historie (souběžně s 2 a 4)
- [ ] 4. Read model → porty: stav regenerace, sítě podle verze, kresby skic, roviny pro skicář, registr typů, export, stav spojení (souběžně s 2 a 3)
- [ ] 5. Kompoziční kořen nad serverem, seznam dokumentů, přenos z IndexedDB, texty stavu spojení (souběžně s 6)
- [ ] 6. E2E proti Docker Compose: infrastruktura, úprava sady, nové testy latence, výpadku a reloadu (souběžně s 5)

Úkol 1 jde první a sám a zafixuje TS kontrakty níže (rozhraní v `remote/index.ts` a v app s pahýly). Úkoly 2, 3 a 4 pak souběžně (každý ve svých souborech, proti kontraktům a falešným implementacím), po jejich sloučení souběžně 5 a 6 (6 dokončí zelenou sadu po natažení sloučeného 5).

## Architektura klienta po M46

```
ui ──► app: createRemoteAppSession ─┬─ MirrorDocument (DocumentReader + events)  ◄── read model.document
                                    ├─ RemoteDispatcher (OperationDispatcher, Transaction, UndoManager)
                                    │      optimisticky: TS handlery nad zrcadlem, pak RPC
                                    ├─ ReadModelView ──► RegenStatusPort, viewport.syncLayers, kresby skic,
                                    │                    resolvePlane / planeOfSketch skicáře, RegenUiState
                                    ├─ VersionMeshes (MeshOps pro render: handle = verze sítě)
                                    ├─ RemoteHistory (port HistoryLog) a RemoteFileExporter
                                    └─ stav spojení ──► KernelUiState, PersistenceStatus
                      remote: RemoteSession ── gRPC-Web ──► Envoy ──► tinycad-core
                              RemoteDocuments, createRemoteSketchGeometry (M39)
```

**Proč optimistické zrcadlo (N63 ⚠):** `interaction` a `sketcher` jsou synchronní: dialog featury po `tx.apply` hned čte parametry z dokumentu, skicář každý příkaz staví nad aktuálními daty skici, strom po `dispatch` hned překreslí řádek. Asynchronní porty by znamenaly přepsat dialog, skicář i nástroje. Zrcadlo dovolí nechat je beze změny: změna se použije hned lokálně stejnými TS handlery operací (validace i chování jako dnes, chyba se vyhodí synchronně), odejde na server a každá odpověď zrcadlo **přepíše** serverovým dokumentem a znovu na něj použije ještě nepotvrzené změny. Server zůstává autorita (skica má po odpovědi serverové souřadnice, Q103), klient jen nečeká.

## TS kontrakty (zafixuje úkol 1)

**`remote/index.ts`** (prstenec 3; nově smí importovat `document` a `ops` – typy operací a `OP_VERSION`, N74):

- `RemoteError` (třída, `Error`): `code` (jméno kódu gRPC), `reason` (jméno `ErrorReason` bez předpony: `'READ_ONLY'`…), `path`, `issues: readonly ParamIssue[]`; `toRemoteError(e: unknown): RemoteError` (z `ConnectError` a detailu `ErrorDetail`; bez detailu `reason` `'UNSPECIFIED'`), `isRetryable(e)` = `UNAVAILABLE` nebo `DEADLINE_EXCEEDED`.
- `ReadModelData` – dekódovaný read model jako obyčejná zmrazená data: `document { id, name, lastSeq, studio: PartStudioData }` (featury jako `FeatureInstance`, `rollbackIndex`, `bodies` metadata), `regen { generation, statuses: ReadonlyMap<FeatureId, FeatureStatusData>, final: StateData, input: { featureId, state } | null, anchors: ReadonlyMap<FeatureId, FeatureAnchors>, durationMs }`, `session { writable, canUndo, canRedo, transactionLabel: string | null }`. `StateData { bodies: BodyData[], sketches: SketchViewData[], planes, axes }`; `BodyData { id, origin, lastModifiedBy, contentVersion, faceNames, edgeNames, facePlanes: ReadonlyMap<number, Plane>, mesh: MeshData | null }`; `SketchViewData { sketchId, featureId, plane, entities: readonly unknown[], regions: readonly ProfileRegion[] }`. `FeatureStatusData` má tvar `FeatureStatus` z `regen` (`ok`, `warning`, `error` s `FeatureError`, `suppressed`, `rolledBack`), aby se nemusel měnit adaptér stavu. `decodeReadModel(msg)`; `bytes` sítí s posunem, který není násobkem 4, se před `Float32Array` zkopírují.
- `operationToProto(op: Operation)` a `operationFromProto(msg): Operation`; `featureSchemaOf(descriptor): FeatureSchema` (N67) a `visibleWhenOf(data)`.
- `RemoteSession` (`openRemoteSession(options): Promise<RemoteSession>`):
  - `options`: `transport`, `docId`, `meshQuality?`, `newOperationId: () => string` (UUID v4), `readOptions: () => { knownMeshes: readonly string[]; inputOf: FeatureId | null }` (čte se při **odeslání** každého požadavku), `resume: { load(): string | null; save(id: string | null): void }` (`sessionStorage`), `timers` (pro čekání mezi pokusy a heartbeat; testy falešné), `retry` (výchozí 5 pokusů, 200 ms × 2ⁿ).
  - vlastnosti: `featureTypes: readonly FeatureSchema[]` (z `featureSchemaOf`), `readModel: Observable<ReadModelData>` (poslední read model z odpovědi, z `GetReadModel` po události nebo po novém sezení), `connection: Observable<'connecting' | 'online' | 'retrying' | 'offline'>`, `pending: Observable<number>` (změny ve frontě a v letu), `events: Subscribable<{ lost: { what: 'transaction' } }>`.
  - `change(request: ChangeRequest): Promise<ChangeOutcome>`, kde `ChangeRequest` = `dispatch { op, label? }` | `begin { label }` | `apply { op }` | `applyTransient { op }` | `commit` | `abort` | `undo` | `redo` a `ChangeOutcome` = `{ ok: true; entry: LogEntryData | null; readModel }` | `{ ok: false; error: RemoteError }` (nikdy neodmítne kvůli chybě serveru, jen `dispose`).
  - `refresh(): Promise<void>` (`GetReadModel`), `history(fromSeq): Promise<HistoryData>` (`LogEntryData[]` a zásobníky), `exportStep(): Promise<{ content: Uint8Array; fileName: string }>`, `close(): Promise<void>` (`CloseSession` s `keepalive`), `dispose()`.
- `RemoteDocuments` (`createRemoteDocuments(transport, newOperationId)`): `list()`, `create(name)`, `rename(id, name)`, `remove(id)`, `importFile(bytes, operationId?)`, `exportFile(id)`; chyby jako `RemoteError`.
- `remote/testing.ts`: `createFakeCore()` nad `createRouterTransport` z `@connectrpc/connect` – skriptovatelné `SessionService` a `DocumentService` v paměti (fronta odpovědí nebo chyb na metodu, záznam všech požadavků, stream událostí ovladatelný testem), buildery `aReadModel()`, `aBodyView()`, `aSketchView()`, `aFeatureTypeDescriptor()`.

**app** (vnitřní, testy přes `@/app` jen tam, kde je to dnes zvykem):

- `MirrorDocument implements DocumentReader` s `events` (`changed`) nad vnitřním `Document` z `document`; `reset(data: ReadModelData['document'])` vymění obsah a vyšle `changed` jen při skutečné změně; `writer()` pro optimistické použití (jen fasáda).
- `createRemoteDispatcher({ mirror, session, handlers, now, onError, onLost }): OperationDispatcher & { readonly undo: UndoManager }` – pravidla v úkolu 3.
- `HistoryLog` (port v `interaction`, N73): `entries(): readonly HistoryEntry[]` (`seq`, `kind`, `target?`, `label`, `time`, `opType`), `stacks()`, `events.changed`; `createHistoryModel({ log: HistoryLog })`.
- `createReadModelView(deps)` (nahrazuje `regen-pipeline` v serverové cestě) a `createVersionMeshes(): MeshOps & { put(version, mesh), handleOf(version), retain(versions) }` – pravidla v úkolu 4.

## Akceptační kritéria

- Celá dnešní e2e sada projde proti serveru v Docker Compose (`npm run test:e2e`, Chrome; při uzavření `test:e2e:full`).
- Nové e2e: uměle zpožděná síť 150 ms (tažení manipulátoru, skica, dialog), výpadek spojení během tažení a reload karty – zapsaná práce se neztratí, karta po reloadu má znovu zámek.
- Druhá karta téhož dokumentu je jen pro čtení a po změně v první kartě se jí model obnoví (`WatchSession`).
- Unit testy `remote` a nových částí `app` zelené proti falešnému jádru, bez Dockeru; `npm run check` zelený.
- `interaction`, `sketcher` a `render` beze změny chování; jediná změna rozhraní je port historie (N73).

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer` (Opus, TDD). Pro všechny úkoly:

- **Kontrakt:** TS kontrakty výše (po úkolu 1 v kódu), spec 14 a `.proto` po M45. Implementátor kontrakty nemění; chybějící funkci vrací jako otázku.
- **Porty místo přepisu:** `interaction`, `sketcher`, `render` se nemění (výjimka port historie v úkolu 3). Kde UI potřebuje nový stav, mapuje se na dnešní typy (`KernelUiState`, `PersistenceStatus`, N69).
- **Testy bez Dockeru:** `remote` proti `createFakeCore()` (router transport), app proti falešnému `RemoteSession` (malá třída v `test/unit/app/` nebo v `app/testing.ts`). Testy nikdy nespí: čekání mezi pokusy a heartbeat přes injektované `timers`.
- **Pravidla závislostí:** `remote` smí navíc `document` a `ops` (N74) – úkol 1 upraví `.dependency-cruiser.cjs` a tabulku ve [[01-architektura]] (hlavní sezení zkontroluje). `app` dál jediný importuje `remote`.
- **Ověření:** cílené `npm test -- remote app interaction`, `npm run typecheck`; celý `npm run check` při sloučení úkolu; e2e jen v úkolu 6 a na konci milníku (N2).

### 1. Základy `remote`, falešné jádro, pravidla závislostí

- **Soubory:** `src/remote/{errors,operations,read-model,feature-types,session,documents,testing}.ts`, `src/remote/index.ts` (veřejné API kontraktu; `session.ts` a `documents.ts` jen s typy a pahýly `openRemoteSession`/`createRemoteDocuments`, které vyhodí `not implemented`), `src/app/{mirror-document,remote-dispatcher,read-model-view,version-meshes}.ts` jen s exportovanými typy a pahýly, `src/interaction/history-model.ts` jen typ `HistoryLog` (přepojení v úkolu 3), `.dependency-cruiser.cjs`, `docs/20-spec/01-architektura.md` (řádek `remote`); testy `test/unit/remote/{errors,operations,read-model,feature-types,testing}.test.ts`.
- **Kontrakt:** TS kontrakty výše. Převod operací: všech 13 typů a vnořený `batch`, pole 1:1, `BodySetColor` `null` ↔ nevyplněné, materiál ↔ enum. Popis typu → `FeatureSchema`: `params` v pořadí popisu s `ParamSpec` stejného tvaru jako dnešní schémata pluginů (`kind`, meze, `options`, `group`, `label`), `visibleWhen` jako funkce nad daty (`equals_any`, `equals_none`, `less_than`: hodnota jiného typu → skryto, chybějící u `equals_none` → viditelné, Q105), `defaults()` = kopie `defaults`, `validate` = `validateAgainstSchema` (N67), bez `migrate`.
- **Testy:** každý typ operace tam a zpět; read model s posunem `bytes` 1, 2 a 3 (síť se dekóduje stejně); `ErrorDetail` → `RemoteError` pro každý `reason`; popisy typů: zlatý soubor `test/golden/feature-types.json` z M45 (úkol 1 M45, N75) → `featureSchemaOf` → sdílené případy `schema.visibleWhen` dají v TS stejné výsledky jako v C++; `ParamSpec` z popisu krabice rovný `ParamSpec` dnešního schématu krabice (kromě `visibleWhen`, který se porovná vyhodnocením); falešné jádro vrací skriptované odpovědi a zaznamená požadavky.
- **Hotovo když:** testy zelené, `npm run check` zelený (pahýly se přeloží), `lint:deps` s novými pravidly.

### 2. `RemoteSession` a `RemoteDocuments` (souběžně s 3 a 4)

- **Soubory:** `src/remote/{session,watch,change-queue,documents}.ts`, testy `test/unit/remote/{session,change-queue,watch,documents}.test.ts`.
- **Kontrakt:** `RemoteSession`, `RemoteDocuments`. Pravidla:
  - **Otevření:** `OpenSession` s `resume_session_id` z `resume.load()`, uloží nové `session_id`; potom `WatchSession` od `event_seq`.
  - **Fronta změn:** nejvýš jedna změna v letu (spec 14). Každý požadavek dostane `operation_id` při zařazení a nese ho i při opakování. Čekající (neodeslaný) `apply` se `feature.setParams` téže featury nahradí novějším („poslední vyhrává“, nahrazený slib se vyřeší výsledkem novějšího); nic jiného se neslučuje.
  - **Opakování:** `isRetryable` → stejný požadavek se stejným `operation_id`, čekání 200 ms × 2ⁿ, nejvýš 5 pokusů; `connection` = `retrying`, po vyčerpání `offline` a výsledek `{ ok: false }` s poslední chybou; další `change` nebo `refresh` zkouší znovu od jednoho pokusu (spojení se mohlo vrátit).
  - **`SESSION_NOT_FOUND`:** nové sezení (`OpenSession` bez `resume`), nový stream. Požadavek, který chybu dostal, a všechny čekající: trvalé (`dispatch`, `undo`, `redo`) se pošlou znovu se **stejným** `operation_id` (trvalá idempotence přes sezení), kroky transakce a `commit` skončí `{ ok: false, reason 'NO_TRANSACTION' }` a vyšle se `lost { what: 'transaction' }` (transakce zanikla s restartem serveru, spec 14).
  - **Stream:** `changed` s cizím `by_session_id` nebo `resync` → `refresh()`; vlastní `changed` se ignoruje; `heartbeat` jen obnoví hlídání ticha; konec streamu nebo chyba → znovu připojit s posledním `seq` (čekání jako u opakování, bez limitu, dokud sezení žije); ticho > 2 × 30 s → spojení se považuje za mrtvé a naváže znovu.
  - `pending` = počet změn ve frontě a v letu; `readModel` se vyšle po každé úspěšné odpovědi, `refresh` a novém sezení.
- **Testy (falešné jádro):** pořadí a jedna změna v letu; slučování `apply` téže featury a ne jiné; opakování se stejným `operation_id` a vyčerpání po 5 pokusech; `SESSION_NOT_FOUND` uprostřed transakce (`lost`, trvalá změna znovu se stejným id v novém sezení); `resume`; stream: chybějící události po znovupřipojení s `after_seq`, `resync` → `GetReadModel`, cizí `changed` → `GetReadModel`, vlastní ne; `close` s `keepalive`; `RemoteDocuments` všech šest volání a převod chyb (`DOCUMENT_OPEN`, `INVALID_DOCUMENT` s `issues`).
- **Hotovo když:** testy zelené.

### 3. Zrcadlo dokumentu, fasáda dispečeru a port historie (souběžně s 2 a 4)

- **Soubory:** `src/app/{mirror-document,remote-dispatcher,remote-history}.ts`, `src/interaction/history-model.ts` (port `HistoryLog`, N73), `src/app/session.ts` (dnešní lokální cesta dostane `HistoryLog` adaptérem nad `OperationLog`, aby šla dál přeložit), testy `test/unit/app/{mirror-document,remote-dispatcher,remote-history}.test.ts`, úprava `test/unit/interaction/history-model.test.ts`.
- **Kontrakt:** `MirrorDocument`, `createRemoteDispatcher`, `HistoryLog`. Pravidla fasády (N63–N65):
  - **Zrcadlo = základ + čekající.** Základ je dokument posledního read modelu. Každá změna se hned použije na zrcadlo (`applyOperation` s TS handlery; chyba se vyhodí synchronně a nic se neodešle – stejně jako dnes) a zařadí se do `session.change`. Po každé odpovědi: základ = dokument z odpovědi, potvrzená změna z čekajících odejde, zrcadlo = základ + znovu použité čekající (změna, která už nejde použít, se zahodí a nahlásí `onError`).
  - **Transakce:** `begin` vrátí lokální `Transaction` hned (`inTransaction` true synchronně); kroky si pamatují inverze jako `ops/transaction.ts`; `commit` vrátí přechodné kroky a `abort` všechny lokálně hned, odešle se `Commit`/`Abort`. Při znovupoužití čekajících se `commit`/`abort` přehrají svými zapamatovanými inverzemi.
  - **`dispatch` a `commit` vrací** prozatímní `LogEntry` (`seq` = poslední známé + 1, `op`, `inverse`, `label`, `time`); volající ho dnes nepoužívají.
  - **Undo a redo** nejsou optimistické (N64): odešlou se, zrcadlo se změní až odpovědí. `canUndo()`/`canRedo()` = read model a `!inTransaction`; `events.changed` při změně dvojice; `stacks()` z historie.
  - **Chyba odpovědi** (`ok: false`): změna se z čekajících zahodí a zrcadlo se přestaví (`onError` s `RemoteError`). Výjimka `SKETCH_NOT_SOLVED` (N65, Q103): zamítnutý `setParams` skici zůstane jako lokální vrstva nad základem + čekajícími, dokud server nepřijme další `setParams` téže featury nebo neskončí transakce; `onError` dostane chybu (skicář ukáže `sketch.notSolved`).
  - **`lost`** (transakce zanikla na serveru): lokální transakce skončí bez RPC, další `apply`/`commit`/`abort` jejího objektu jsou no-op, zrcadlo = nový read model, zavolá se `onLost` (app zavře otevřený dialog a skicář přes `cancel()` a ukáže hlášku).
  - **Jen pro čtení:** fasádu obalí dnešní `refuseChanges` (Q102: `writable` z `OpenSession`).
  - `RemoteHistory`: `HistoryLog` nad `session.history(1)` znovu načteným po každé odpovědi se záznamem a po `refresh`; `opType === 'document.rename'` nahrazuje `isDocumentRename(entry.op)`.
- **Testy (falešný `RemoteSession`):** `apply` je v zrcadle hned a dialog featury (skutečný `createFeatureEditor` nad zrcadlem a fasádou) čte nové parametry synchronně; odpověď se serverovými souřadnicemi skici přepíše lokální; dvě rychlé změny a odpověď na první → zrcadlo = odpověď + druhá; chyba druhé změny ji zahodí; `commit` a `abort` lokálně okamžitě (lišta zpět, přechodné kroky vrácené); `commit` čekající při příchodu odpovědi na `apply`; `SKETCH_NOT_SOLVED` drží lokální skicu do dalšího přijatého `setParams` a zahodí ji `commit`; `lost` zavře transakci; `READ_ONLY` přes `refuseChanges`; undo čeká na odpověď; historie bez `document.rename` a se stavy `active`/`undone` ze zásobníků serveru; dnešní testy `history-model` přes port.
- **Hotovo když:** testy zelené, dnešní testy `interaction` beze změny zelené.

### 4. Read model → porty (souběžně s 2 a 3)

- **Soubory:** `src/app/{read-model-view,version-meshes,remote-registries,remote-file-exporter,connection-state}.ts`, testy `test/unit/app/{read-model-view,version-meshes,remote-registries,remote-file-exporter,connection-state}.test.ts`.
- **Kontrakt:**
  - **`createVersionMeshes`** (N66): `MeshOps`, jehož `tessellate(handle)` vrátí síť z mezipaměti (neznámý handle → odmítnutí, chyba programu); `handleOf(version)` přidělí každé verzi stálý syntetický `ShapeHandle` (čítač od 1, internování); `put` vloží síť dekódovanou z read modelu; `retain(versions)` zahodí ostatní; `versions()` pro `known_meshes`. `render` dostane tento objekt v `bodies.reset` jednou při startu a nemění se.
  - **`createReadModelView`** (nahrazuje `regen-pipeline` v serverové cestě, D3 z M19.1 zachované): pro každý nový read model (1) vloží sítě, (2) `viewport.syncLayers` s `{ id, shape: handleOf(contentVersion) }` (s `input`: hlavní vrstva vstup, náhled = tělesa výsledku s jinou verzí než ve vstupu, stejně jako `previewBodies`), (3) až potom `RegenStatusPort` – `RegenSnapshot` jako `regen-status-adapter` (zdraví jen vyhodnocených featur, tělesa s `TopoNames` z `faceNames`/`edgeNames`, skici s názvy oblastí, kotvy, `pick`), (4) kresby skic (`artifactDrawing(plane, entities, regions)` pro každou skicu kromě editované), (5) `RegenUiState` (`busy` = změny v letu, `bodyCount`, `lastMs` = `durationMs`, `failed` null), `afterSync`, první pohled `fitAll` jako dnes, (6) `retain` sítí na verze posledního read modelu. Starší read model (nižší `generation`, než už je zobrazená) se zahodí. `resolvePlane(ref)`: rovina z `planes` podle id, `TopoRef` → těleso finálního stavu, `faces(name)[0]` → `facePlanes`; `planeOfSketch(id)` z `sketches`.
  - **`createRemoteRegistries(featureTypes, plugins)`** (N67, [[Q098 Schéma featur v klientovi|Q098]]): schémata z popisů, z pluginů jen `tools`, `manipulators` a `messages` (podle `plugin.schema.type`); plugin typu, který server nezná, se přeskočí s varováním v konzoli; handlery `createOpHandlerRegistry({ schemas })` pro zrcadlo.
  - **`createRemoteFileExporter`**: stejné rozhraní jako dnešní exportér pro `createFileActions`; STEP = počkat na prázdnou frontu, `session.exportStep()`; `.tinycad.json` = `documents.exportFile(docId)` (vždy s historií ze serveru).
  - **Stav spojení** (N69): `connection` + `pending` → `KernelUiState` (`connecting` → `starting`, `online` → `ready`, `retrying` → `restarting`, `offline` → `unavailable`; `retryKernel()` = `session.refresh()`) a `PersistenceStatus` (`pending > 0` → `pending`, `retrying` → `error`, `offline` s nepotvrzenými změnami → `failed`, jinak `saved`; `persistenceError` = text poslední chyby).
- **Testy:** read model se dvěma tělesy → dvě sítě, `syncLayers` dřív než `publish`; tentýž read model znovu → žádná nová síť, tentýž handle; změna jednoho tělesa → nový handle jen u něj, stará verze po `retain` pryč; `input` → hlavní vrstva = vstup, náhled = změněná tělesa; `TopoNames` (jméno ↔ index, prázdné jméno = bez jména); `resolvePlane` pro rovinu počátku, plochu kvádru nahoře a nerovinnou plochu (`undefined`); starší generace zahozena; registry (typ bez klientské půlky má schéma bez nástroje, cizí plugin přeskočen, zprávy sloučené); export STEP počká na frontu; mapování stavů spojení.
- **Hotovo když:** testy zelené.

### 5. Kompoziční kořen, seznam dokumentů, přenos z IndexedDB (souběžně s 6)

- **Soubory:** `src/app/remote-session.ts` (`createRemoteAppSession(deps)`: stejné `AppSession`), `src/app/browser.ts` (`openAppSession` a `createDocumentList` jen přes server, N68), `src/app/remote-documents-catalog.ts` (port `DocumentCatalog` z `interaction` nad `RemoteDocuments`), `src/app/browser-migration.ts` (N71), `src/app/index.ts`, `src/ui/start.ts` a komponenta úvodní obrazovky (tlačítko přenosu), `src/ui/i18n/{cs,en}.ts` (texty stavu spojení a přenosu, N69), testy `test/unit/app/{remote-session,remote-documents-catalog,browser-migration}.test.ts` (proti `createFakeCore()`).
- **Kontrakt:** `createRemoteAppSession` sestaví vše jako dnešní `wireSession`, jen místo `openDocument`, `createOperationDispatcher`, `createUndoManager`, persistence, `KernelSupervisor` a `regen-pipeline` použije úkoly 2–4; `readOnly` = `!readModel.session.writable`; `known_meshes` = `versionMeshes.versions()`, `input_of` = otevřený dialog featury; otevření a zavření dialogu bez změny → `session.refresh()`; `onLost` zruší dialog (`features.current.get()?.cancel()`) a ukáže hlášku; `flush()` = počkat na prázdnou frontu (odmítne, když je `offline` s nepotvrzenými změnami); `close()` = `flush` a `session.close()`; `dispose()` = `session.close()` bez čekání. Skicář: řešič `createPlanegcsSolver()`, text `createOpentypeOutliner`, geometrie vždy `createRemoteSketchGeometry` (N3 končí, N68). `VITE_CORE_URL` jen přepisuje výchozí `/api`. Dnešní lokální `createAppSession`, `doc-lock`, `documents.ts` a jejich testy zůstanou nepoužité v `src/` do M47 (smaže je s `kernel-occt`, `regen`, `persistence`).
- **Přenos z IndexedDB (N71 ⚠):** `createBrowserMigration({ documents })`: `count()` = počet dokumentů v IndexedDB (0 při chybě nebo bez IDB); `run(onProgress)` pro každý dokument `exportStoredDocument` → `ImportDocument` s `operation_id` = `import:<sha256 obsahu>` (opakování nezdvojí, stejný klíč jako `tinycad-import`, N38), vrátí počet přenesených a selhání s texty; IndexedDB nemaže. Úvodní obrazovka ukáže nad seznamem tlačítko „Přenést dokumenty z prohlížeče (N)“, když `count() > 0`.
- **Testy:** session nad falešným jádrem: otevření, změna z dialogu je v dokumentu hned a po odpovědi má serverová data, `readOnly` pro `writable = false`, `lost` zavře dialog, `flush` čeká na frontu; katalog (seznam, vytvoření se jménem z překladu, přejmenování, smazání s `DOCUMENT_OPEN` → dnešní chybová hláška „otevřeno v jiné kartě“, import s `issues`); přenos dvou dokumentů a druhé spuštění bez duplikátů (falešné jádro kontroluje `operation_id`).
- **Hotovo když:** testy zelené, `npm run check` zelený, `npm run dev` proti `docker compose up` ručně: vytvořit dokument, krabice, skica a vysunutí, reload, druhá karta jen pro čtení (zapsat do hlášení).

### 6. E2E proti Docker Compose (souběžně s 5)

- **Soubory:** `docker-compose.e2e.yml` (přepis: projekt `tinycad-e2e-<E2E_PORT>`, data v `tmpfs`, Envoy na `E2E_CORE_PORT`, výchozí 18080), `scripts/e2e-core.mjs` (`up`: ověří Docker, `docker compose … up -d --build --wait`; `down`), `playwright.config.ts` (`globalSetup`/`globalTeardown`, proxy `vite preview` na `E2E_CORE_PORT`), `package.json` (`test:e2e` a `test:e2e:full` proti serveru; `E2E_CORE` zaniká), `test/e2e/{fixtures,helpers}.ts` (fixture `serverDocument`: dokument přes `DocumentService` z Node – `createGrpcWebTransport` s globálním `fetch` – s unikátním jménem a otevření jeho trasy), úprava všech `test/e2e/*.spec.ts` (start na vlastním dokumentu, seznam dokumentů jen o vlastních dokumentech), nové `test/e2e/m46-latency.spec.ts`, `m46-outage.spec.ts`, `m46-tabs.spec.ts`.
- **Kontrakt (N72):** každý test pracuje ve vlastním dokumentu, sada nesmí záviset na prázdném seznamu ani na pořadí testů; data Pavla (`tinycad-data`) e2e nikdy nevidí. Zpoždění 150 ms přes `page.route` na unární volání (stream `WatchSession` se nezdržuje, `route.continue()`, ne `route.fetch()`). Výpadek přes `context.setOffline(true)` na 2 s.
- **Testy:** celá dnešní sada; latence: tažení manipulátoru výšky krabice, posun bodu ve skice a dialog vysunutí při 150 ms – výsledek po puštění odpovídá poslední hodnotě a log má jeden záznam; výpadek během tažení: po obnovení a puštění je hodnota uložená (reload ji ukáže), stav spojení ukázal „obnovuji spojení“; reload uprostřed práce: uložené změny po reloadu jsou, karta má zámek (`resume_session_id`); druhá karta jen pro čtení a po změně v první se obnoví.
- **Hotovo když:** `npm run test:e2e` zelený po natažení sloučeného úkolu 5, `test:e2e:full` při uzavření milníku, revize `architecture-reviewer`.

### Krajní případy a invarianty (pro kontrolu po úkolech)

- Zrcadlo po každé odpovědi = serverový dokument + nepotvrzené změny; bez čekajících změn je rovné serveru.
- Chyba optimistického použití (neplatná operace) se vyhodí synchronně a nic neodejde, jako dnes.
- `operation_id` se při opakování nemění, ani přes nové sezení u trvalých změn; kroky transakce se po ztrátě sezení neopakují.
- Síť se pro jednu verzi stáhne jednou; handle verze je stálý po dobu karty.
- `RegenStatusPort` dostane snímek až poté, co pohled ukazuje jeho tělesa (D3 z M19.1).
- Karta jen pro čtení nic neposílá (`refuseChanges`), jen čte a sleduje.

## Co se naučíš

Klient nad read modelem (CQRS v malém) s optimistickým zrcadlem a přestavěním po odpovědi, idempotentní opakování přes výpadek a nové sezení, mezipaměť podle verze schovaná za dnešním portem a jak porty z M9–M21 dovolily vyměnit celé jádro pod UI.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
