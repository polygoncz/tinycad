---
type: milestone
status: todo
order: 47
aliases:
  - M47
  - M47 Úklid a dokončení série
modules:
  - app
  - ui
  - kernel
  - kernel-occt
  - regen
  - ops
  - persistence
  - plugin-api
  - features
  - document
specs:
  - "[[01-architektura]]"
  - "[[03-dokument]]"
  - "[[04-operace-a-historie]]"
  - "[[05-persistence]]"
  - "[[06-geometricke-jadro]]"
  - "[[07-regenerace]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
  - "[[12-skicar]]"
  - "[[13-testovani]]"
depends_on:
  - "[[M46-klient-nad-read-modelem]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M47 – Úklid a dokončení série

**Cíl:** Z prohlížeče zmizí OCCT (WASM a worker), regenerace, persistence s IndexedDB a buildery featur. V klientovi zůstane jen to, co potřebuje optimistické zrcadlo a skicář: model dokumentu, handlery operací, model skici s řešičem a text. Specifikace popisují serverovou verzi a série nativního jádra je uzavřená.

> Upřesněno 2026-10-17 při plánování samostatného běhu ([[Rozhodnutí nativního jádra]], N120–N129). Předpokládá [[M46-klient-nad-read-modelem|M46]] sloučený podle jeho plánu: aplikace jde jen přes server (N68), lokální cesta leží v `src/` nezapojená. Nedělí se na stopy, uvnitř milníku běží až tři souběžné úkoly.

**Specifikace:** [[01-architektura]], [[03-dokument]], [[04-operace-a-historie]], [[05-persistence]], [[06-geometricke-jadro]], [[07-regenerace]], [[09-vykreslovani]], [[10-interakce]], [[11-ui]], [[12-skicar]], [[13-testovani]], [[0030-nativni-jadro-pres-grpc|ADR 0030]] (bod 9 zúžený podle N63 a N121)

**Navazuje na:** [[M46-klient-nad-read-modelem]]

## Úkoly

- [ ] 1. Převést integrační scénáře bez obdoby v C++ na sdílené případy `regen` (souběžně s 2)
- [x] 2. Měření „před“: velikost bundlu a čas startu před sérií (souběžně s 1)
- [x] 3. Smazat lokální cestu: `kernel-occt`, `regen`, `persistence`, buildery a schémata featur, lokální `app`, přenos z IndexedDB, závislosti a konfigurace
- [ ] 4. Zúžit `ops`, `kernel` a `document`, upravit běžce sdílených případů (souběžně s 5 a 6)
- [x] 5. E2E, konfigurace nástrojů, README a `CLAUDE.md` (souběžně s 4 a 6)
- [x] 6. Přepsat specifikace na serverovou verzi (hlavní sezení, souběžně s 4 a 5)
- [ ] 7. Uzavření: měření „po“, `test:e2e:full`, revize, Roadmapa, retrospektiva a poznatek

Pořadí: 1 ∥ 2 → 3 → 4 ∥ 5 ∥ 6 → 7. Úkol 1 musí skončit před 3, protože zapisuje případy ještě TS regenerací (N127). Úkol 3 je jeden, protože mazané moduly se navzájem importují a každý mezikrok musí projít `typecheck`.

## Co zůstane a co zmizí (inventura 2026-10-17)

Stav `src/` k plánu (před M46 úkoly 5 a 6). Soubory, které M46 přidá (`remote-session.ts`, `remote-documents-catalog.ts`, `browser-migration.ts`), jsou uvedené podle jeho plánu.

| Modul | Po M47 | Zmizí |
|---|---|---|
| `kernel-occt` | – | celý modul (WASM `replicad-opencascadejs`, `occt.worker.ts`), `test/unit/kernel-occt/` |
| `regen` | – | celý modul, `test/unit/regen/` |
| `persistence`, `persistence/idb` | – | celý modul včetně `persistence.worker.ts` a `file.ts` (N126), `test/unit/persistence/`, `tsconfig.test-idb.json`, `fake-indexeddb` |
| `kernel` | typy pro `render` a `remote` (N122): `types.ts`, `MeshOps`, typy `ProfileRegion`/`ProfileLoop`/`ProfileCurve`, `createKernelError`, `kernelErrorCode`, `KernelErrorCode`, `validateMeshData` | `GeometryKernel` a rozhraní operací, `parse*Input`, `validateFaceInput`, `isRigidMotion`, `FakeKernel` (`fake-*.ts`), kontraktová sada (`testing.ts`); testy `fake-kernel`, `profile`, `transform` |
| `ops` | typy operací, `OP_VERSION`, registr a handlery, `applyOperation`, typy portů `OperationDispatcher`, `DispatchMeta`, `Transaction`, `UndoManager`, `LogEntry` (`ports.ts`); paměťový dispečer, log, transakce a undo jen v `ops/testing.ts` (N121) | `replay.ts`, `upcast.ts`, `parse-entry.ts`, `load-error.ts`, `rebuildUndoStacks`, `isDocumentRename` (nahradil `opType`, N73), pokud ho nic nepoužívá; testy `replay*`, `upcast`, `parse-entry` |
| `document` | model, reference, schéma a registr, `validateAgainstSchema`, `evaluateParams`, `migrateFeatureData` (handlery) | exporty bez produkčního uživatele po úkolu 3, čekáme `fromData`/`toData` (úklid exportů v úkolu 4) |
| `features/*` | `tool.ts`, `manipulators.ts`, `messages.ts`, `params.ts` (typy parametrů a pomůcky jako `flipApplies`), `anchors.ts` (typy kotev z `builder.ts`), `index.ts` (N123) | `builder.ts`, objekty schémat v `schema.ts`, části testů o builderu a schématu |
| `plugin-api` | `FeaturePlugin = { type, tools?, manipulators?, messages? }`, `PluginMessages` | `registerPlugin` (`register.ts`), závislost na `regen` a `document` |
| `app` | `browser.ts` (jen server), `remote-session.ts`, `remote-documents-catalog.ts`, `mirror-document.ts`, `remote-dispatcher.ts`, `remote-history.ts`, `remote-registries.ts`, `remote-file-exporter.ts`, `read-model-view.ts`, `version-meshes.ts`, `connection-state.ts`, `read-only.ts` (jen `refuseChanges`), `viewport-mirror.ts`, `view-settings.ts`, `page-lifecycle.ts`, `dispose-open-session.ts`, `file-names.ts`, `operation-types.ts`, `plugins.ts`, `testing.ts`, `index.ts`; nový `app-session.ts` s typy přestěhovanými beze změny tvaru | `session.ts` (lokální `createAppSession`), `doc-lock.ts`, `documents.ts`, `open-document.ts`, `load-error.ts`, `kernel-supervisor.ts`, `regen-pipeline.ts`, `regen-scheduler.ts`, `regen-status-adapter.ts`, `registries.ts`, `file-exporter.ts`, `sketch-geometry.ts`, `browser-migration.ts`; jejich testy a `plugins-parity.test.ts` (nahradí ho test podle N123) |
| `ui` | vše kromě přenosu z IndexedDB | tlačítko přenosu na úvodní obrazovce a jeho texty v `i18n` (N126) |
| `core`, `sketch`, `sketcher`, `interaction`, `render`, `remote`, `protocol`, `solver-planegcs`, `text-opentype` | beze změny (`core/rpc` a worker řešiče zůstávají, N120) | – |

**Typy, které se stěhují** (tvar beze změny, jen nové místo): `AppSession`, `AppSessionDeps`, `AppViewport` ze `session.ts`, `KernelUiState` z `kernel-supervisor.ts`, `RegenUiState`, `ShownBody`, `previewBodies` a potřebné části `RegenPipelineDeps` z `regen-pipeline.ts`, `DownloadFile` z `file-exporter.ts` → `app/app-session.ts` (nebo `read-model-view.ts`, kde je jediný uživatel); `PersistenceStatus` a `DocumentInfo` z `persistence` → `app/app-session.ts`. `SupervisedKernel` z `app/index.ts` zmizí.

**Integrační testy, které zmizí** (běží proti TS regeneraci a WASM): `boolean-scenario`, `extrude-scenario`, `revolve-scenario`, `sketch-scenario`, `topo-scenarios`, `sketch-pattern-regions`, `sketch-regions-regression`, `sketch-spline`, `sketch-text-regions`, `feature-dialog` (dialog nad zrcadlem testuje M46 úkol 3), `perf` (výkon regenerace je teď v C++). Zůstane `remote-feature-types` a běžce sdílených případů podle N124.

**Bundle (orientační `dist/` z 2026-10-17, ještě s lokální cestou):** `index.js` 1,55 MB, OCCT `replicad_single.wasm` 23,0 MB, `occt.worker.js` 134 kB, `persistence.worker.js` 10,5 kB; zůstanou `planegcs.wasm` 484 kB, `solver.worker.js` 73 kB, fonty Noto 77 kB (text ve skice, N120) a ikony Tabler. Platná čísla dá až úkol 2 a 7.

## Akceptační kritéria

- `rg -l "replicad|kernel-occt|@/regen|@/persistence|indexedDB|FakeKernel" src test` nic nenajde; `npm ls replicad-opencascadejs fake-indexeddb` prázdné.
- `npm run build`: v `dist/assets` není OCCT WASM, `occt.worker` ani `persistence.worker`; jediný WASM je `planegcs`.
- Klient neobsahuje OCCT, regeneraci, persistence ani buildery; z domény zůstává model dokumentu a handlery operací pro zrcadlo (N63, N121) a model skici s řešičem (ADR 0030 bod 5).
- `npm run check`, `npm run check:server` (včetně nových sdílených případů z úkolu 1) a `npm run test:e2e:full` proti Docker Compose zelené.
- Velikost bundlu a čas startu před sérií a po ní zapsané v retrospektivě (N125).
- Specifikace podle úkolu 6 popisují serverovou verzi, `npm run lint:vault` zelený; [[Roadmapa]] má sérii hotovou.

## Úkol 1 (hotovo)

9 nových případů `regen` z integračních scénářů (editace výšky, posunutý válec, poloměr nástroje booleanu, šířka kótovaného obdélníku, pole a text po změně, tažený bod splajnu, deska s 36 děrami z měření výkonu) – celkem 48, zelené v TS i v C++ beze změny `expected`, chyba v C++ se nenašla. Tabulka scénář → případ nebo C++ test je ve zprávě úkolu (deník).

## Měření „před“ (úkol 2, hotovo)

`npm run measure` (`scripts/measure-startup.mjs`) na commitu `27c8e83` (`main` před přepnutím klienta, WASM verze), Chrome headless, localhost, 5 studených běhů, medián:

| Metrika | Před |
|---|---|
| úvodní obrazovka | 98,9 ms |
| nový dokument → povolená lišta (start OCCT) | 158,7 ms |
| OK kvádru → těleso | 116,8 ms |
| přeneseno sítí (stránka i workery) | 23,98 MB (11 požadavků) |
| `dist/` celkem syrově / gzip | 28,68 MB / 10,08 MB |
| z toho WASM (`replicad_single.wasm` + `planegcs.wasm`) | 23,46 MB / 7,42 MB |

Časy na localhostu skoro nic neříkají (bez omezení sítě); srovnatelná je hlavně velikost a přenesené bajty. Resource Timing nevidí požadavky workerů, proto se srovnává `network` (odchylka od kontraktu úkolu 2).

## Implementační plán

Úkoly 1–5 = jedno spuštění subagenta `implementer` (Opus). Úkol 6 a 7 dělá hlavní sezení (implementer vault nemění). Pro všechny:

- **Jen mazat a stěhovat, žádné nové chování.** Kde smazání něco rozbije mimo seznam výše, implementátor to vrací jako otázku, ne opravu „po svém“.
- **Testy:** test smazaného kódu se maže s ním; test, který jen přes smazaný kód nastavoval scénu (např. `FakeKernel` v testu `app`), se přepíše na náhradu z M46 (falešné jádro `remote/testing.ts`, falešný `RemoteSession`), nebo se smaže, když chování pokrývá test M46. Výčet smazaných testů do hlášení.
- **Ověření:** cílené `npm test`, `npm run typecheck` a `npm run lint:deps` po každém kroku; celý `npm run check` na konci úkolu; e2e jen v úkolu 5 a 7 (N2).

### 1. Integrační scénáře → sdílené případy `regen` (souběžně s 2)

- **Soubory:** nové `test/shared-cases/regen/*.json`; žádný kód v `src/`. Případně drobná úprava `test/integration/shared-cases/regen.test.ts`, jen když nový případ potřebuje existující druh, který běžec zatím nečte (jinak otázka).
- **Postup (N127):** pro každý integrační test ze seznamu výše najít obdobu v `test/shared-cases/regen/` nebo v `server/test/{regen,features,kernel}/`. Co obdobu nemá (čekáme hlavně scénáře topologického pojmenování z `topo-scenarios` a regrese oblastí skici, splinu a textu), zapsat jako nový případ `regen`, `expected` nahrát TS doménou (`npm run cases:record -- regen`) a ověřit v C++ (`npm run check:server`, `-j3`, N116). Případ, který v C++ selže, je nález: nezapisovat ho upravený, vrátit jako otázku s rozdílem.
- **Testy:** nové případy zelené v TS i v C++; metatest pokrytí zelený.
- **Hotovo když:** tabulka „integrační test → případ nebo C++ test“ v hlášení, nové případy v C++ zelené.

### 2. Měření „před“ (souběžně s 1)

- **Soubory:** `scripts/measure-startup.mjs` (Playwright jako knihovna, ne test; ESLint ho kontroluje jako ostatní skripty).
- **Kontrakt (N125):** skript dostane URL běžící aplikace a scénář jde jen přes UI, které je v obou verzích stejné: úvodní obrazovka → nový dokument → kvádr s výchozími parametry. Měří medián z 5 studených načtení (nový kontext, vypnutá cache): (a) čas od navigace po úvodní obrazovku, (b) od kliknutí na nový dokument po povolenou lištu nástrojů, (c) od potvrzení kvádru po zobrazené těleso, (d) přenesené bajty (Resource Timing). Výstup JSON na stdout.
- **„Před“:** commit `main` těsně před sloučením M46 (najít `git log --merges`, zapsat hash) v dočasném worktree mimo projekt, `npm ci && npm run build && npx vite preview`, bez serveru. K tomu `dist/assets` po souborech (syrově a gzip).
- **Hotovo když:** skript v repozitáři, čísla „před“ a hash commitu v hlášení (hlavní sezení je zapíše do retrospektivy).

### 3. Smazat lokální cestu

- **Soubory:** smazat `src/kernel-occt/`, `src/regen/`, `src/persistence/` (celý), `src/features/*/builder.ts`, `src/plugin-api/register.ts`, soubory `app` ze sloupce „Zmizí“; upravit `src/features/*/{schema→params,index}.ts` a nové `anchors.ts`, `src/plugin-api/{plugin,index}.ts`, `src/app/{index,browser,connection-state,read-model-view,remote-registries,remote-file-exporter,read-only,testing,plugins}.ts`, nový `src/app/app-session.ts`, `src/ui/start.ts` a komponentu úvodní obrazovky, `src/ui/i18n/{cs,en}.ts`; konfigurace `package.json` (odebrat `replicad-opencascadejs`, `fake-indexeddb`), `package-lock.json` (`npm install`), `vite.config.ts` (`optimizeDeps.exclude` jen planegcs; blok `oxc` pryč – byl kvůli `using` v `kernel-occt`, ověří WebKit v úkolu 7), `vitest.config.ts` (komentář integračního projektu), `tsconfig.json`, `tsconfig.domain.json`, `tsconfig.test.json`, smazat `tsconfig.test-idb.json`, `eslint.config.js` (seznamy prstence 1 a výjimky `persistence/idb`), `.dependency-cruiser.cjs` (tabulka níže, `ownFiles`/`testFiles`/`no-deep-import` bez `persistence/idb`, komentář `VITE_ASSET_QUERY` jen planegcs), `test/unit/module-entry-points.test.ts`; testy a integrační testy podle inventury.
- **Kontrakt:**
  - `FeaturePlugin` (N123): `{ readonly type: string; tools?; manipulators?: ManipulatorDescriptor<P, A>; messages? }`; `createRemoteRegistries` čte `plugin.type` místo `plugin.schema.type`. Plugin `sketch` má jen `type` a `messages`.
  - `.dependency-cruiser.cjs` a [[01-architektura#Povolené závislosti]] (tabulku ve spec upraví úkol 6 podle stejného výčtu): pryč `persistence`, `persistence/idb`, `kernel-occt`, `regen`; `plugin-api` → `core`, `interaction`; `features/*` → `core`, `document`, `interaction`, `plugin-api` (jen to, co se po úpravě opravdu importuje); `app` bez smazaných modulů. Ostatní řádky beze změny.
  - Zbytek tak, jak ho vynutí kompilátor: když `app` potřebuje typ ze smazaného souboru, přestěhuje se podle odstavce „Typy, které se stěhují“.
  - Přenos z IndexedDB (N71) zmizí celý (N126).
- **Testy:** testy `features/*` jen pro nástroje, manipulátory a pomůcky z `params.ts`; nový `test/unit/app/plugins.test.ts` (nebo úprava stávajícího): typy `BUILT_IN_PLUGINS` = typy z `test/golden/feature-types.json` (nová featura bez klientské půlky selže, N123); `test/unit/plugin-api/plugin.test.ts` upravený, `register.test.ts` pryč; `test/unit/app/*` bez lokální cesty.
- **Hotovo když:** akceptační `rg` čistý (kromě `@/kernel` a `ops`, které řeší úkol 4), `npm run build` bez OCCT WASM a workerů jádra a persistence, `npm run check` zelený. Sdílené případy `geometry` a `regen` v TS se tu smažou s moduly (jejich běžce a `support/mesh-volume.ts`), zbytek běžců řeší úkol 4.

### 4. Zúžit `ops`, `kernel`, `document` a běžce sdílených případů (souběžně s 5 a 6)

- **Soubory:** `src/ops/{index,ports,testing,undo,dispatcher,log,transaction}.ts` (smazat `replay.ts`, `upcast.ts`, `parse-entry.ts`, `load-error.ts`), `src/kernel/{index,kernel,profile}.ts` (smazat `fake-*.ts`, `transform.ts`, `testing.ts`), `src/document/{index,serialize}.ts` podle úklidu exportů, `src/app/remote-dispatcher.ts` jen pokud po M46 ještě volá `createOperationDispatcher`/`createOperationLog` (přepnout na `applyOperation`, N96); testy `test/unit/{ops,kernel,document}/`, běžce `test/integration/shared-cases/{ops,coverage,document,schema,schema-validate}.test.ts`, `support/plugins.ts` → `support/schemas.ts`, `support/sort.ts`, `scripts/cases-record.mjs` (komentář).
- **Kontrakt:**
  - **`ops` (N121):** typy portů do `ops/ports.ts`, exportované z `index.ts`; `createOperationDispatcher`, `createOperationLog`, `createUndoManager` jen z `ops/testing.ts` (vedle `anOpsSession`). Produkční kód je nesmí importovat (`testing-only-in-tests`).
  - **`kernel` (N122):** veřejné API přesně podle tabulky výše.
  - **Úklid exportů:** v `document`, `ops` a `kernel` smazat každý export `index.ts`, který po úkolu 3 nepoužívá produkční kód ani `testing.ts` jiného modulu, s jeho implementací a testy. Výčet do hlášení. Mimo tyto tři moduly se nic neprochází.
  - **Běžce (N124):** zůstanou `ops` (jen druh `script` a případy handlerů nad dvojníkem z `ops/testing.ts`; `replay` a `upcast` přeskočí s poznámkou „jen C++“), `sketch` beze změny a metatest pokrytí (typy kódů chyb a stavů featur z `remote` místo `regen`, typy featur ze zlatého souboru). Smazat `document` (když úklid odstraní `fromData`/`toData`), `schema`, `schema-validate`. Schémata pro handlery v běžci `ops` z `featureSchemaOf` nad `test/golden/feature-types.json`.
- **Testy:** testy dvojníka `ops` (`dispatcher`, `log`, `transaction`, `undo` bez `rebuildUndoStacks`) zelené beze změny obsahu; všech ≈50 testů `interaction` a `sketcher` přes `anOpsSession` beze změny.
- **Hotovo když:** akceptační `rg` čistý, `npm run check` zelený, výčet smazaných exportů a přeskočených druhů případů v hlášení.

### 5. E2E, konfigurace, README a `CLAUDE.md` (souběžně s 4 a 6)

- **Soubory:** `package.json` (skripty `test:e2e:core`/`pretest:e2e:core` pryč, pokud je M46 nechal), `playwright.core.config.ts` (smazat, pokud zůstal), `test/e2e/m39.spec.ts` (bez `E2E_CORE`), `vite.config.ts` (komentář proxy bez `playwright.core.config.ts`), `README.md` (tabulka Stack: jádro OCCT nativně na serveru přes gRPC-Web, persistence SQLite na serveru, Docker Compose; planegcs zůstává), `CLAUDE.md` (výjimka `any` „v adaptéru OCCT“ pryč; seznam projektů `typecheck` bez `tsconfig.test-idb.json`; `test:integration` = sdílené případy a `remote`; `test:e2e` a `test:e2e:full` potřebují Docker; `npm run dev` proti `docker compose up`), `.claude/agents/*.md` jen tam, kde zmiňují smazané moduly.
- **Kontrakt:** e2e sada se nemění obsahem; jen zmizí vše, co přepínalo lokální a serverovou cestu.
- **Testy:** `npm run test:e2e` (Chrome) zelený proti Compose po natažení úkolu 3.
- **Hotovo když:** `rg -n "E2E_CORE|e2e:core|playwright.core|test-idb|replicad" . --glob '!docs/**' --glob '!node_modules/**'` nic nenajde, `test:e2e` zelený.

### 6. Specifikace na serverovou verzi (hlavní sezení, souběžně s 4 a 5)

Malé změny: popsat, co běží, a odkázat na kód (`server/src/<knihovna>`), nepřepisovat obsah, který C++ implementuje beze změny. Části jen o prohlížeči se přesunou do archivní poznámky na každou silně upravenou specifikaci (`90-archiv/05-persistence v prohlížeči.md`, `06…`, `07…`), nemažou se (N128). Může se rozdělit na dva pomocné agenty: (01, 03, 04, 05, 13) a (06, 07, 08, 09, 10, 11, 12).

| Spec | Co se mění |
|---|---|
| [[01-architektura]] | prstence (bez `regen`, `persistence`, `kernel-occt`; `remote`, `protocol` v prstenci 3), diagram vrstev s `remote` a serverem místo `regen`/`persistence`/`kernel-occt`, tabulka závislostí podle úkolu 3, zákazy (`persistence/idb`, `regen nezná ops` pryč), princip 6 (asynchronní hranice = server a worker řešiče), *Tok dat jedné změny* přes zrcadlo, RPC a read model (odkaz na [[14-protokol]]), *Adresářová struktura*, *Kompoziční kořen* jen serverový |
| [[03-dokument]] | úvod: autorita je C++ (`server/src/document`), TS model drží zrcadlo; *Serializace* jen na serveru, pokud úkol 4 smaže `fromData`/`toData` |
| [[04-operace-a-historie]] | dispečer, transakce, log, undo, přehrání a upcast implementuje C++ (`server/src/ops`); v klientovi handlery, `applyOperation`, typy portů a paměťový dvojník v `ops/testing.ts` (N121); věta „persistence poslouchá log“ pryč |
| [[05-persistence]] | celé na SQLite (`server/src/storage`, M41): port a pravidla načtení zůstávají jako kontrakt, adaptér IndexedDB, worker, schéma IDB a služba s frontou do archivu; export a import = `DocumentService` a `tinycad-import`; testy C++ |
| [[06-geometricke-jadro]] | implementace nativní OCCT (`server/src/kernel`); *architektura adaptéru* `kernel-occt` (worker, `ready`, tessellace, volba WASM buildu, Vite) a TS `FakeKernel` do archivu; nový krátký odstavec „co z jádra zná klient“ (modul `kernel` = typy, N122); testy C++ |
| [[07-regenerace]] | úvod: C++ (`server/src/regen`, buildery `server/src/features`), TS zápis = kontrakt; klient vidí výsledek jen přes read model; *Testy (s FakeKernel)* → C++ testy a sdílené případy `regen` |
| [[08-topologicke-pojmenovani]] | vlastnost `modules` bez `kernel-occt`, věta o implementaci v C++; scénáře M14 odkazují na sdílené případy z úkolu 1 |
| [[09-vykreslovani]] | *Synchronizace s regenerací*: bod 7 (výměna instance jádra) neplatí, handle = verze sítě po dobu karty; poznámka o `@/kernel/testing` v *Testy* pryč |
| [[10-interakce]] | export „uloženého stavu“ = export ze serveru; zbytek jen kontrola odkazů na [[05-persistence]] a regeneraci |
| [[11-ui]] | *Plugin featury* (N123, struktura složky bez `builder.ts` a `FakeKernel`), *Kompoziční kořen* bez `createAppSession`/workerů/IDB, význam `persistence`/`persistenceError` ze stavu spojení (N69), tabulka souborů `app` podle inventury, *Testy* |
| [[12-skicar]] | builder a oblasti skici v C++ (`server/src/features/sketch`), `regen-pipeline.ts` → `read-model-view.ts`, zmínky `FakeKernel`/`fake-regions` a `kernel-occt` → C++; řešič a text beze změny |
| [[13-testovani]] | tabulka úrovní (unit bez `regen`/`persistence`, kontraktové sady jádra a úložiště v C++, integrační = sdílené případy `ops`/`sketch` a `remote`, e2e proti Compose), *Sdílené případy* podle N124, *Měření výkonu* (výkon regenerace v C++), *Konvence* bez `FakeKernel`/`MemoryDocumentStore` |

K tomu: [[0002-occt-wasm-ve-workeru|ADR 0002]] a [[0013-replicad-opencascadejs|ADR 0013]] – věta „dokud ji M47 neodstraní“ → „odstraněno v M47“; [[0030-nativni-jadro-pres-grpc|ADR 0030]] – dodatek k bodu 9 (zúžení N63, N121).

### 7. Uzavření (hlavní sezení)

- Měření „po“ skriptem z úkolu 2 proti Compose (`npm run build && npx vite preview` s proxy na Envoy), tabulka před/po do retrospektivy.
- `npm run check`, `npm run check:server`, `npm run test:e2e:full` (Chrome i WebKit; WebKit ověří odstranění `oxc`), revize `architecture-reviewer`.
- [[Roadmapa]]: série nativního jádra hotová, pravidlo zmrazení končí.
- Retrospektiva série (M38–M47) v této poznámce, poznatek `70-poznatky/Vyjmutí jádra z prohlížeče do služby.md` (co bylo těžké: zmrazení a sdílené případy, optimistické zrcadlo místo asynchronních portů, souběžné stopy v C++, co zůstalo v klientovi a proč).
- Do deníku bod pro Pavla: dokumenty v IndexedDB jdou po M47 přenést jen z checkoutu před M47 (N126); seznam ⚠ rozhodnutí M47.

### Krajní případy a invarianty (pro kontrolu po úkolech)

- Žádný soubor z `src/` neimportuje produkčně `ops/testing.ts` ani `createOperationDispatcher`.
- Bundle se po úkolu 3 už nemění (mazání v úkolu 4 se tree-shakingem projevit nesmí; když ano, něco produkčního používalo smazaný kód).
- Každý typ featury ze serveru má plugin v klientovi a naopak.
- Případy `regen` z úkolu 1 vznikly TS doménou a v C++ prošly beze změny `expected`.

## Co se naučíš

Jak dotáhnout velký přepis do konce: inventura, záchrana testů před smazáním kódu, který je jediným zápisem chování, měření, které porovná srovnatelné, a dokumentace, která popisuje, co opravdu běží.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
