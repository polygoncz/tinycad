---
type: milestone
status: todo
order: 45
aliases:
  - M45
  - M45 Sezení přes gRPC
modules:
  - server
specs:
  - "[[14-protokol]]"
  - "[[04-operace-a-historie]]"
depends_on:
  - "[[M41-persistence-sqlite]]"
  - "[[M44.1-builder-skici-na-serveru]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M45 – Sezení přes gRPC

**Cíl:** `SessionService` a `DocumentService` celé: běhový dokument se sezeními, zámkem pro zápis a timeoutem nečinnosti, změny a transakce přes RPC s idempotencí, read model se sítěmi podle verze, `WatchSession`, export STEP, `FeatureTypeDescriptor` z C++ schémat a chyby jako `google.rpc.Status`. Ověřeno integračními testy přes skutečný gRPC kanál podle [[14-protokol#Testy]].

> Upřesněno 2026-10-17 při plánování samostatného běhu ([[Rozhodnutí nativního jádra]], N53–N62). Začíná po sloučení všech tří stop (M41, M44.1 a tím M40, M42–M44) do `main` ([[Roadmapa#Nativní jádro (M38–M47)]]).

**Specifikace:** [[14-protokol]] (celá: *Sezení*, *Změny dokumentu*, *Idempotence*, *Read model a sítě*, *Události*, *Schéma featur*, *Chyby*, *Testy*), [[04-operace-a-historie]] (transakce a undo přes RPC), [[05-persistence]] (uloženo = odpověď), [[0030-nativni-jadro-pres-grpc|ADR 0030]], [[Q097 Transakce a undo přes RPC|Q097]], [[Q099 Read model po regeneraci|Q099]], [[Q100 Verze sítí v mezipaměti klienta|Q100]], [[Q102 Sezení pro více karet|Q102]], [[Q103 Skica, kterou server nevyřeší|Q103]]

**Navazuje na:** [[M41-persistence-sqlite]] (`PersistentDocument`, `storage::DocumentService`, N35–N39), [[M43-regenerace-v-cpp]] (`Regenerator`, `contentVersion`, N40–N43), [[M44.1-builder-skici-na-serveru]] (`SketchOperationSolver`, `SketchArtifact`, N47), [[M39-kostra-serveru]] (`main.cpp`, chybové statusy, Compose a Envoy)

**Zdroj pravdy o chování:** spec 14 a `.proto` v `server/proto/tinycad/v1/`; chování transakcí a undo zmrazené `src/ops/{dispatcher,transaction,undo}.ts` s testy `test/unit/ops/*`.

## Úkoly

- [ ] 1. Kostra `tinycad_session`, doplňky kontraktu, chyby, převod operací a popisy typů featur
- [ ] 2. Read model, mezipaměť sítí a kruhový buffer událostí (souběžně s 3)
- [ ] 3. Běhový dokument, sezení, zámek, idempotence a timeout nečinnosti (souběžně s 2)
- [ ] 4. gRPC `SessionService` s `WatchSession` a integrační testy přes kanál (souběžně s 5)
- [ ] 5. gRPC `DocumentService`, zapojení v `main.cpp`, svazek dat v Compose (souběžně s 4)

Úkol 1 jde první a sám (založí všechny soubory s pahýly, N30, a změní `.proto`, na kterém stojí i TS). Úkoly 2 a 3 pak běží souběžně, po jejich sloučení souběžně 4 a 5.

**Kontrakt (zafixované hlavičky, N53):** `server/src/session/include/tinycad/session/{session_error,operation_codec,feature_types,fingerprint,recent_responses,event_ring,read_model_builder,runtime_document,session_manager,session_service,document_service}.hpp`. Stojí na hlavičkách M40–M44.1; typy `ops` jsou dopředně deklarované jako v `persistent_document.hpp` a hlavní sezení sladí jména po sloučení M40.

**Kontrakt pro [[M46-klient-nad-read-modelem|M46]]:** `.proto` po úkolu 1 (tři doplňky z N56) a chování RPC podle spec 14. M46 začíná až po sloučení M45; klient se testuje proti falešnému serveru v TS, takže nečeká na Docker.

### Doplňky kontraktu (N56 ⚠, úkol 1)

Jen přidaná pole a hodnoty, `buf breaking` projde:

| Soubor | Změna | Proč |
|---|---|---|
| `session.proto` | `OpenSessionRequest.resume_session_id = 4` | reload karty pokračuje v témže sezení se zámkem; jinak by staré sezení drželo zámek až 10 min a znovu načtená karta byla jen pro čtení (N70) |
| `read_model.proto` | `BodyView.face_planes = 8` jako `map<uint32, Plane>` (index plochy jako u `face_names` → rovina rovinné plochy) | klient nemá jádro, skicu na ploše tělesa ale otevírá synchronně (`resolvePlane` ve skicáři) |
| `errors.proto` | `ERROR_REASON_DOCUMENT_OPEN = 17`, kód `FAILED_PRECONDITION`, řádek v tabulce | smazání (a přejmenování při otevřené transakci) otevřeného dokumentu ze seznamu odmítne jako dnes prohlížeč |

## Akceptační kritéria

- Integrační testy ze [[14-protokol#Testy]] (sezení, idempotence, transakce a undo, sítě, stream) zelené proti skutečnému gRPC kanálu (`grpc::Server::InProcessChannel`), včetně restartu serveru nad týmž adresářem dat.
- Testy transakcí a undo ze [[04-operace-a-historie|spec 04]] projdou přes RPC: 50 `Apply` = 1 záznam, `Abort` vrátí dokument, přechodné kroky nejdou do logu ani při `Commit`, undo a redo po znovuotevření dokumentu.
- Převod `Operation` ↔ JSON operace spec 04 tam a zpět pro každý typ operace (13) i vnořený `batch` (N27).
- `FeatureTypeDescriptor` pro všech 9 vestavěných typů; `VisibleWhen` ze sdílených případů `schema.visibleWhen` dává po převodu do popisu tytéž hodnoty.
- `docker compose up` s novým svazkem `tinycad-data`: dokument vytvořený přes `DocumentService` přežije `docker compose restart core`.
- `npm run check:full` zelený.

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer` (Opus, TDD). Pro všechny úkoly:

- **OOP a KISS** (Pavel, N9): třídy s jednou odpovědností podle hlaviček (`RuntimeDocument` s pimpl, `Session`, `SessionManager`, `ReadModelBuilder`, `MeshCache`, `EventRing`, `RecentResponses`, dva adaptéry `…ServiceImpl`). Žádné šablonové metaprogramování, žádný `std::variant` s visitorem, `switch` nad `kind` a nad `oneof` případem (`op_case()`).
- **Kontrakt:** hlavičky výše; implementátor je **nemění** (výjimka: jména parametrů, `#include`), chybějící funkci vrací jako otázku. Vnitřní hlavičky v `server/src/session/src/` navrhuje sám.
- **Read model přímo do zpráv `tinycad.v1`** (N53); doménové typy se na proto převádějí jen v `read_model_builder.cpp`, `operation_codec.cpp`, `feature_types.cpp` a v adaptérech.
- **Vlákna** (N54): synchronní gRPC server. Zámek `SessionManager` → zámek `RuntimeDocument` → zámek `EventRing`, nikdy obráceně. Změna nikdy neběží pod zámkem manageru. Testy souběhu: dvě vlákna posílají `Apply` téhož sezení se stejným `operation_id` → jedno použití.
- **Build:** `server/src/session/CMakeLists.txt` – knihovna `tinycad_session` (`tinycad_storage`, `tinycad_regen`, `tinycad_feature_builders`, `tinycad_features`, `tinycad_kernel`, `tinycad_solver_planegcs`, `tinycad_proto`, `gRPC::grpc++`, OpenSSL pro SHA-256 – je ve vcpkg jako závislost gRPC; kdyby nebyl dostupný přímo, otázka hlavnímu sezení); kořenový `CMakeLists.txt` + `add_subdirectory(src/session)` a `test/session`. Unit testy `server/test/session/*_test.cpp` (`tinycad_session_tests`), integrační přes kanál `server/test/session/grpc_*_test.cpp` ve stejném spustitelném souboru (N25).
- **Jádro v testech** (N45): skutečné `OcctKernel` a `PlanegcsSolver`; dokumenty v dočasném adresáři (`openSqliteCatalog`), hodiny pevné (`now`, `steady`), id sezení sekvenční.
- **Ověření:** cílené testy v Dockeru (`ctest -R session`); celý `npm run check:full` na konci milníku (N2, N49).

### 1. Kostra, doplňky kontraktu, chyby, převod operací, popisy typů

- **Soubory:** `server/proto/tinycad/v1/{session,read_model,errors}.proto` (doplňky N56 s komentáři), `server/src/session/CMakeLists.txt`, `server/src/session/src/{session_error,operation_codec,feature_types,fingerprint,recent_responses}.cpp` hotové, pahýly `src/{event_ring,read_model_builder,runtime_document,session_manager,session_service,document_service}.cpp` (metody vrací `SessionError{Internal, "not implemented"}` nebo `grpc::Status(UNIMPLEMENTED)`), kořenový `server/CMakeLists.txt`; testy `server/test/session/{session_error,operation_codec,feature_types,fingerprint,recent_responses}_test.cpp`; zlatý soubor `test/golden/feature-types.json` (popisy všech typů jako protobuf JSON, N75: test ho porovná a s `TINYCAD_UPDATE_GOLDEN=1` přepíše; M46 z něj v TS ověří převod popisu na schéma); `npm run gen:proto` a `npm run typecheck` (TS kód z nového `.proto` se musí přeložit).
- **Kontrakt:** `session_error.hpp`, `operation_codec.hpp`, `feature_types.hpp`, `fingerprint.hpp`, `recent_responses.hpp`. Tabulka kód gRPC ↔ důvod je jedna (`toStatus`), stejná jako v `errors.proto`. Převod operací: názvy polí 1:1 v camelCase, aktuální `v` podle tabulky verzí `ops` (M40), `BodySetColor` bez `color` → `null`, materiál jménem, chyby jen pro to, co pokazí jen drát (prázdný `oneof`, `BODY_MATERIAL_UNSPECIFIED`), cesty v proto jménech (`op.batch.ops[2]`). Otisk = hex SHA-256 deterministické serializace bez `session_id`, `operation_id` a `read` (N57).
- **Testy:** každý z 13 typů operace tam a zpět (JSON → proto → JSON rovné, proto → JSON → proto rovné), vnořený `batch`, celé číslo v `params` zůstane celým číslem v JSON (`2`, ne `2.0`), chybové cesty; `toStatus` pro každý důvod (kód, jeden detail `ErrorDetail`, `issues`); `fromChangeError`, `fromServiceError`, `fromLoadError` (cesty issues); popis každého z 9 typů (pořadí parametrů, druhy, meze, `defaults` jako `Struct`) a `VisibleWhen` všech sdílených případů `schema.visibleWhen` (vyhodnocení nad převedeným popisem = vyhodnocení nad C++ daty); otisk nezávislý na `known_meshes`, `input_of`, `session_id`, `operation_id` a závislý na `op`; `RecentResponses` (New, Repeated, Reused, vypadnutí nejstaršího po 64).
- **Hotovo když:** testy zelené, celý server se přeloží se všemi soubory knihovny, `buf lint` a `buf breaking` (`npm run check:proto`) zelené, TS `typecheck` zelený.

### 2. Read model, mezipaměť sítí a události (souběžně s 3)

- **Soubory:** `server/src/session/src/{read_model_builder,event_ring}.cpp`, testy `server/test/session/{read_model_builder,mesh_cache,event_ring}_test.cpp`, pomocník `server/test/session/testing.hpp` (sestavení studia z JSON přes `fromData` s `registerBuiltInSchemas`, `Regenerator` nad `OcctKernel` s `registerBuiltInBuilders`).
- **Kontrakt:** `read_model_builder.hpp`, `event_ring.hpp`. Obsah read modelu přesně podle komentáře `ReadModelBuilder::build`: `face_names`/`edge_names` = primární jména (`NameTable::nameOfFace`), `face_planes` jen rovinné plochy, entity skici = `entities` a za nimi `derivedEntities` (vzory, písmena textu) v jednom `ListValue`, oblasti z `outlines` v pořadí artefaktu, statusy všech featur, kotvy jen `ok`/`warning` před lištou, `input` jen s `input_of` a `RegenResult::input`. Síť jen když verze chybí v `known_meshes`; `bytes` little-endian (`float32`, `uint32`) jako `MeshData`. `MeshCache` klíčuje `"<verze>@<lin>/<ang>"`, po regeneraci `retain(liveVersions(...))`. `EventRing`: `seq` od 1, kapacita 256, `after` vrací `nullopt` pro vypadlé i budoucí `seq`, `waitAfter` se probudí na `append`, `close` nebo termín.
- **Testy:** první read model nese sítě všech těles; `known_meshes` se všemi verzemi → žádná síť; změna parametru jednoho tělesa → nová verze a síť jen u něj; dva `Regenerator`y → jiné verze; `input_of` featury za lištou → `input` chybí; plocha kvádru nahoře má `face_planes` s rovinou `z = h`, válcová plocha žádnou; skica s polem a textem nese odvozené entity a oblasti s obrysy; těleso skryté v `body_meta` je v read modelu (skrývá klient); `bytes` se dekódují zpět na `MeshData` beze ztráty; `EventRing` (pořadí, vypadnutí, `resync` pro staré i budoucí `seq`, probuzení čekajícího vlákna, `close`).
- **Hotovo když:** testy zelené.

### 3. Běhový dokument, sezení, zámek, idempotence, timeout (souběžně s 2)

- **Soubory:** `server/src/session/src/{runtime_document,session_manager}.cpp`, testy `server/test/session/{runtime_document,runtime_document_transactions,session_manager,idle_timeout}_test.cpp`. Do sloučení úkolu 2 vrací `ReadModelBuilder` pahýl prázdný read model; testy úkolu 3 ověřují záznamy, dokument (`PersistentDocument::document()` přes testovací přístup nebo `history`), stav `SessionView` a události, obsah read modelu až po sloučení.
- **Kontrakt:** `runtime_document.hpp`, `session_manager.hpp`. Pořadí kroků změny: zámek (`ReadOnly`) → idempotence (durable v `PersistentDocument`, kroky v `RecentResponses` pod zámkem dokumentu) → `SketchOperationSolver::solve` u `dispatch`, `apply` i `applyTransient` (N47; operace bez skici projde beze změny) → `PersistentDocument` → generace + 1 a událost `changed { generation, last_seq, by_session_id }` → regenerace (`RunOptions::inputOf` z požadavku) a read model volajícího. Opakovaný požadavek: krok 3–5 se přeskočí, odpověď = uložený záznam (nebo žádný) a aktuální read model. Generace = čítač změn běhového dokumentu (N55), ne počet `run`; `RegenObserver::featureDone` → událost `regen_progress` s touto generací (jen featury, které se při běhu skutečně přestavěly nebo převzaly z cache, jak je `Regenerator` hlásí). `STORAGE` (N35): dokument je znovu načtený, generace + 1 a `changed`, otevřená transakce je pryč. Zámek dostane první sezení, které ho najde volný; `releaseLease` zapisovatele s otevřenou transakcí = `Abort` (+ `changed`). `SessionManager`: `open` s `resume_session_id` (živé sezení téhož dokumentu → totéž sezení, jinak nové), `close` idempotentní, poslední sezení dokument uvolní (zavře `EventRing`), `find` sezení „dotkne“, `WatchGuard` brání timeoutu, `reapIdle` zavře sezení bez RPC a bez streamu po `idleTimeout` (N59); katalogové metody pod zámkem manageru, `renameDocument` otevřeného dokumentu přes `RuntimeDocument::rename`, `removeDocument` otevřeného → `DocumentOpen`.
- **Testy:** port `test/unit/ops/{transaction,undo}.test.ts` přes `RuntimeDocument` (50 `apply` téže featury = 1 záznam, `abort` vrátí dokument, přechodné kroky vrácené při `commit` i `abort` a nikdy v logu, prázdná transakce bez záznamu, `TRANSACTION_OPEN`, `NO_TRANSACTION`, `NOTHING_TO_UNDO`, undo a redo); undo po zavření a znovuotevření dokumentu (nový `RuntimeDocument` nad týmž souborem); druhé sezení `writable = false` a každá změna `READ_ONLY`; zapisovatel odejde → zámek volný, sezení jen pro čtení zůstane jen pro čtení, nové sezení zámek dostane; idempotence (dvakrát `commit` se stejným klíčem = 1 záznam a `repeated`, dvakrát `apply` = jedno použití, stejné id s jinou operací = `OPERATION_ID_REUSED`); skica: `apply` se `setParams` nevyřešitelné skici → `SKETCH_NOT_SOLVED`, dokument, transakce i generace beze změny; vyřešená skica se v logu uloží se serverovými souřadnicemi; selhání zápisu přes dekorátor `DocumentFile` z M41 → `STORAGE`, dokument rovný souboru, další `commit` → `NO_TRANSACTION`; `reapIdle` s falešnými hodinami (9 min nic, 10 min zavře, otevřený `WatchGuard` brání, timeout zapisovatele s transakcí ji zahodí a uvolní zámek); `resume_session_id` cizího dokumentu otevře nové sezení; `rename` otevřeného dokumentu zapíše záznam a pošle `changed` bez `by_session_id`; `removeDocument` otevřeného → `DOCUMENT_OPEN`, zavřeného projde; souběh dvou vláken se stejným `operation_id` (viz výše).
- **Hotovo když:** testy zelené.

### 4. gRPC `SessionService`, `WatchSession` a integrační testy (souběžně s 5)

- **Soubory:** `server/src/session/src/session_service.cpp`, testy `server/test/session/grpc_session_test.cpp`, `grpc_idempotence_test.cpp`, `grpc_transactions_test.cpp`, `grpc_meshes_test.cpp`, `grpc_watch_test.cpp`, pomocník `server/test/session/grpc_harness.hpp` (`TestServer`: dočasný adresář dat, `SessionManager` s pevnými hodinami, oba adaptéry, `grpc::ServerBuilder` bez portu a `InProcessChannel`; `restart()` zničí server i manager a postaví nové nad týmž adresářem – nový prefix `content_version`).
- **Kontrakt:** `session_service.hpp`. Každé RPC: `find` → převod → volání → odpověď, celé v `try/catch` (`internalStatusOfCurrentException`). `OpenSession` vrátí `event_seq` ze stejného okamžiku jako read model. `WatchSession` podle komentáře v hlavičce (resync, heartbeat bez spotřeby `seq`, konec při zrušení klientem nebo zavření `EventRing`). `GetHistory` = `RuntimeDocument::history`, `ExportStep` = `exportStep` (název `<jméno>.step`).
- **Testy (spec 14 *Testy*, přes kanál):** otevření (popisy typů, `writable`, `event_seq`); druhé sezení jen pro čtení a `READ_ONLY` s `FAILED_PRECONDITION` a `ErrorDetail`; timeout (zavolat `reapIdle` s posunutými hodinami) zahodí transakci a uvolní zámek, další volání `SESSION_NOT_FOUND` (`NOT_FOUND`); `CloseSession` neznámého id projde; `resume_session_id` vrátí totéž sezení se zámkem; idempotence (2× `Commit` = 1 záznam a stejný `LogEntryView`, 2× `Apply` = jedno použití, `OPERATION_ID_REUSED` = `INVALID_ARGUMENT`, `Commit` zopakovaný po `restart()` z nového sezení najde záznam v SQLite); transakce a undo přes RPC (akceptační kritéria); sítě (první read model všechny, `known_meshes` všechny → žádná, změna jednoho tělesa → jedna, po `restart()` nové verze a klient bez shody dostane všechny sítě znovu); stream (připojení s `after_seq` dostane chybějící `changed`, `after_seq` starší než 256 událostí → nejdřív `resync`, `changed` přijde sezení jen pro čtení s `by_session_id` zapisovatele, heartbeat po zkráceném intervalu v `SessionConfig`, zavření dokumentu ukončí stream); `ExportStep` vrátí text začínající `ISO-10303-21;`; `SKETCH_NOT_SOLVED` s issue `sketch.notSolved`; `INVALID_OPERATION` s cestou z handleru.
- **Hotovo když:** testy zelené a celá sada `ctest -R session` projde třikrát po sobě (stream a vlákna bez náhodného selhání).

### 5. gRPC `DocumentService`, `main.cpp` a data v Compose (souběžně s 4)

- **Soubory:** `server/src/session/src/document_service.cpp`, `server/src/app/main.cpp` (+ `CMakeLists.txt` aplikace linkuje `tinycad_session`), `docker-compose.yml` (svazek `tinycad-data:/data`, proměnné), `envoy/envoy.yaml` jen pokud je nutné (timeout streamu `WatchSession`: `max_stream_duration` 0 / bez timeoutu na trase služby sezení), testy `server/test/session/grpc_documents_test.cpp` (stejný `grpc_harness.hpp` – kdyby ho úkol 4 ještě neměl, vytvoří si úkol 5 vlastní a hlášení to uvede; sjednotí se při sloučení).
- **Kontrakt:** `document_service.hpp`. `main.cpp`: `TINYCAD_DATA_DIR` (výchozí `/data`), `TINYCAD_SESSION_IDLE_SECONDS` (600); jeden `FeatureSchemaRegistry` (`registerBuiltInSchemas`), `OpHandlerRegistry` (M40), `FeatureBuilderRegistry` (`registerBuiltInBuilders`), `openSqliteCatalog`, `storage::DocumentService` (id dokumentů UUID v4), `SessionManager` (továrny `OcctKernel` a `PlanegcsSolver`), `describeFeatureTypes`, služby `GeometryService`, `SessionService`, `DocumentService` a stav zdraví všech tří; vlákno `reaper` volá `reapIdle` každých 30 s a končí při vypínání (před `server->Shutdown`); vypínání: `Shutdown` s termínem (běžící `WatchSession` se ukončí), pak zničení manageru (zavře sezení). Proměnná `epoch` z M39 zaniká (verze sítí nese prefix `ContentVersions`, N43).
- **Testy:** seznam (nejnovější první), vytvoření s idempotencí (2× stejné `operation_id` = 1 dokument), přejmenování zavřeného i otevřeného dokumentu (otevřený: read model sezení má nové jméno a sezení dostane `changed`), smazání neexistujícího projde, otevřeného `DOCUMENT_OPEN`, import `.tinycad.json` (formát 1 i 2) s idempotencí a rozbitý soubor → `INVALID_DOCUMENT` s `issues`, export → obsah, který se znovu naimportuje na týž stav, a `file_name`; ruční ověření v Compose (vytvořit, `docker compose restart core`, seznam) zapsat do hlášení.
- **Hotovo když:** testy zelené, `docker compose up --build` naběhne se zdravými třemi službami, revize `architecture-reviewer` na konci milníku, `npm run check:full` zelený.

### Krajní případy a invarianty (pro kontrolu po úkolech)

- Log v SQLite vždy odpovídá dokumentu v paměti; odpověď na trvalou změnu přijde až po zápisu (uloženo = odpověď).
- Chyba změny nemění dokument, transakci, log, generaci ani události (výjimka `STORAGE`, N35).
- Otisk se počítá z požadavku klienta, ne z vyřešené skici (N57); opakování po restartu z nového sezení se tedy shoduje.
- `content_version` je jedinečná napříč dokumenty i restarty (prefix `ContentVersions`, N43); těleso převzaté z cache má tutéž verzi.
- Sezení jen pro čtení nikdy nezíská zámek (Q102); zámek se po odchodu zapisovatele neposouvá.
- Událost `changed` jen po skutečné změně (ne po opakovaném požadavku); `seq` událostí bez děr, heartbeat `seq` nespotřebuje.
- Kroky transakce mají idempotenci jen v paměti: restart serveru je zahodí i s transakcí (spec 14) a klient dostane `SESSION_NOT_FOUND`, potom `NO_TRANSACTION`.

## Co se naučíš

Návrh stavové gRPC služby: sezení nezávislé na spojení, idempotence trvalá a v paměti, read model jako kontrakt, server streaming s navázáním po výpadku a jak se zámky a vlákna synchronního gRPC serveru skládají nad jádrem, které smí volat jen jeden volající.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
