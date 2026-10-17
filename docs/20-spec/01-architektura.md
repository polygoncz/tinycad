---
type: spec
status: draft
order: 1
aliases:
  - Architektura
  - Spec 01
modules:
  - core
  - document
  - ops
  - kernel
  - sketch
  - solver-planegcs
  - text-opentype
  - protocol
  - remote
  - render
  - interaction
  - plugin-api
  - features
  - app
  - ui
  - server
milestones:
  - "[[M00-zaklad-projektu]]"
  - "[[M47-uklid-a-dokonceni]]"
  - "[[M50-occt2d-a-vrstva-rpc]]"
  - "[[M52-tenky-klient]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-18
---
# 01 – Architektura

> **Pojmy:** [[Port a adaptér]], [[Kompoziční kořen]], [[Dokument]], [[Neměnná data]], [[Operace]], [[Prezentační model]]  
> **Rozhodnutí:** [[0001-jadro-v-cistem-ts]], [[0003-dokument-je-recept]], [[0004-data-oddelene-od-chovani]], [[0005-operacni-log]], [[0008-hranice-modulu]], [[0009-platformove-nezavisla-domena]], [[0010-prezentacni-model]], [[0011-programovani-proti-rozhranim]], [[0017-modul-sketch-a-skicar]], [[0030-nativni-jadro-pres-grpc|ADR 0030]], [[0031-tenky-klient-bez-handleru|ADR 0031]]  
> **Protokol:** [[14-protokol]]  
> **Milník:** [[M00-zaklad-projektu]], serverová verze od [[M47-uklid-a-dokonceni|M47]], tenký klient od [[M52-tenky-klient|M52]]

Od [[M47-uklid-a-dokonceni|M47]] má tinycad dvě části: **prohlížeč** (TypeScript v `src/`, tato specifikace) a **nativní jádro `tinycad-core`** (C++ v `server/`, [[0030-nativni-jadro-pres-grpc|ADR 0030]]), které vlastní dokument, operační log, regeneraci, OCCT a úložiště. Spojuje je kontrakt gRPC přes Envoy ([[14-protokol]]). Od [[M52-tenky-klient|M52]] je klient **tenký** ([[0031-tenky-klient-bez-handleru|ADR 0031]]): nemá handlery operací ani měnitelný dokument, změny jen posílá a dokument ukazuje jako snímky [[Read model|read modelu]] ze serveru. Principy níže platí pro obě části; moduly, prstence a pravidla závislostí jsou pravidla klienta.

## Principy

1. **Dokument je recept, ne geometrie.** Ukládá se seznam featur s parametry. Geometrie je vždy odvozená přehráním (regenerací) a dá se kdykoli zahodit. ([[0003-dokument-je-recept|ADR 0003]])
2. **Doména nezávisí na ničem vnějším.** V klientovi jsou typy dokumentu a operací, čtecí pohled na dokument a model skici čistý TypeScript bez Vue a Three.js; na serveru jsou knihovny domény (`server/src/document`, `ops`, `regen`, `features`, `storage`, `session`…) bez gRPC a OCCT stojí jen za portem `GeometryKernel`. **Doména serveru nezná protobuf:** `RuntimeDocument` vrací doménové výsledky (`session::ReadModel`, `ChangeResult`, `HistoryView`, `SessionEvent`) a na zprávy `tinycad.v1` je převádí jen vrstva `tinycad_rpc`; knihovny pod ní `tinycad_proto` ani gRPC nelinkují, takže hranici hlídá překladač ([[M50-occt2d-a-vrstva-rpc|M50]], [[Rozhodnutí nativního jádra|N53, N154]]). Vnější svět je za porty (rozhraními) a adaptéry. ([[0001-jadro-v-cistem-ts|ADR 0001]])
3. **Data odděleně od chování.** Featury a operace jsou neměnná serializovatelná data. Chování (builder, handler) je registrované podle typu; od [[M52-tenky-klient|M52]] obojí jen na serveru, klient registruje schémata a klientské půlky pluginů. ([[0004-data-oddelene-od-chovani|ADR 0004]])
4. **Jediná cesta ke změně dokumentu je operace.** Nástroje i UI jen vyrábějí operace a posílají je dispečerovi. ([[0005-operacni-log|ADR 0005]])
5. **Rozšiřitelnost přes registry a pluginy.** Nová featura = nový plugin, žádné `switch (type)` v jádru. (Open/closed princip.)
6. **Asynchronní hranice tam, kde je síť nebo worker.** Dnes jsou dvě: server (gRPC-Web, `remote`) a worker řešiče vazeb (`solver-planegcs`, `core/rpc`). Porty změn (`OperationDispatcher.dispatch`, metody `Transaction`, `UndoManager.undo`/`redo`) vrací `Promise<boolean>` (přijato / odmítnuto), `begin`, `inTransaction` a `canUndo`/`canRedo` jsou synchronní ([[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N163]]). Klient nic neaplikuje lokálně; jediný lokální stav změn jsou [[Rozpracované hodnoty dialogu|rozpracované hodnoty dialogu]] (N164). Optimistické zrcadlo z M46 (N63) zaniklo s [[0031-tenky-klient-bez-handleru|ADR 0031]].
7. **Doména a prezentační logika nevědí, na jaké platformě běží.** Žádné DOM, Worker, Vue, Three.js ani OCCT. Přenos na jinou platformu = přepsat jen adaptéry. ([[0009-platformove-nezavisla-domena|ADR 0009]])
8. **Programování proti rozhraním.** Veřejné API modulu tvoří rozhraní, datové typy a tovární funkce `createXxx(deps)`. Třídy zůstávají uvnitř modulu, konkrétní implementace propojuje jen `app`. Platí i tam, kde druhá implementace není v plánu. Výjimky: data a hodnotové typy, malé utility v `core`, třídy chyb. ([[0011-programovani-proti-rozhranim|ADR 0011]])
9. **Modularita.** Malé veřejné API, úzká rozhraní pojmenovaná podle role, kompozice místo dědičnosti, rozšíření bez úpravy jádra. ([[0011-programovani-proti-rozhranim|ADR 0011]])

## Vrstvy a moduly

Každý modul je složka v `src/` s veřejným API v `index.ts`. Volitelně má druhý vstupní bod `testing.ts` s pomůckami pro testy (buildery, fake implementace), viz pravidla níže. Testy modulu leží mimo `src/`, v `test/unit/<modul>/` ([[0023-testy-mimo-zdrojaky|ADR 0023]]), a pro pravidla závislostí patří k modulu.

### Tři prstence

Nad vrstvami platí hrubší dělení podle toho, jestli modul smí znát platformu ([[0009-platformove-nezavisla-domena|ADR 0009]]):

| Prstenec | Moduly | Platforma (DOM, Worker, Vue, Three.js, OCCT) |
|---|---|---|
| 1. Doména | `core`, `document` (typy, čtecí pohled nad snímky, schéma a validace), `ops` (typy operací, `OP_VERSION`, porty; [[Rozhodnutí nativního jádra\|N166]]), `kernel` (jen typy sítí a chyb, [[Rozhodnutí nativního jádra\|N122]]), `sketch` (M12), `plugin-api`, `features/*` | ne |
| 2. Prezentační logika | `interaction` ([[Prezentační model\|prezentační modely]], nástroje, port `ViewportPort`), `sketcher` (režim skicáře, [[0024-modul-sketcher\|ADR 0024]]) | ne |
| 3. Adaptéry a platforma | `render`, `ui`, `solver-planegcs` (M12), `text-opentype` (M37), `protocol` a `remote` (M39, [[14-protokol]]), `app` | ano |

Prstence 1 a 2 se typují konfigurací `tsconfig.domain.json` bez knihovny `DOM`, takže použití `window` nebo `KeyboardEvent` shodí `typecheck`. `app` je kompoziční kořen *pro danou platformu*.

```
┌──────────────────────────────────────────────────────────────┐
│ ui            Vue komponenty, composables                    │
├──────────────────────────────────────────────────────────────┤
│ app           AppSession – kompoziční kořen, fasáda pro UI,  │
│               snímky read modelu, tenký RemoteDispatcher     │
├──────────────┬───────────────────────────────────────────────┤
│ features/*   │ klientské půlky featur (nástroje, manipulátory│
│ plugin-api   │ typ FeaturePlugin                    zprávy)  │
├──────────────┴──────────┬────────────────────────────────────┤
│ sketcher (→ interaction)│ render                             │
│ režim skicáře           │ Three.js viewport, picking         │
│ interaction             │ (implementuje ViewportPort)        │
│ výběr, nástroje, akce,  ├────────────────────────────────────┤
│ prezentační modely,     │ remote   adaptéry nad gRPC-Web ────┼──► Envoy ──► tinycad-core (C++)
│ port ViewportPort       │ protocol vygenerovaný kód          │    dokument, ops, regen,
├─────────────────────────┴──┬─────────────────────────────────┤    OCCT, SQLite (server/)
│ ops   typy operací,        │ kernel   typy sítí a chyb       │
│       porty dispečera      │ sketch   model skici, port      │
├────────────────────────────┤          řešiče ◄── solver-     │
│ document  typy, snímky RM  │          planegcs, text-opentype│
├────────────────────────────┴─────────────────────────────────┤
│ core          id, události, Result, Disposable, matematika   │
└──────────────────────────────────────────────────────────────┘
```

### Povolené závislosti

Šipka = „smí importovat“. Co není v tabulce, je zakázané. Vynucuje dependency-cruiser ([[0008-hranice-modulu|ADR 0008]]).

| Modul | Smí importovat | Externí knihovny |
|---|---|---|
| `core` | – | `gl-matrix`, jen v `src/core/math/` ([[0012-gl-matrix-za-fasadou\|ADR 0012]]) |
| `document` | `core` | – |
| `ops` | `core`, `document` | – |
| `kernel` | `core` | – |
| `sketch` (M12) | `core` | – |
| `solver-planegcs` (M12) | `core`, `sketch` | `@salusoft89/planegcs` ([[0016-planegcs-resic-vazeb\|ADR 0016]]) |
| `text-opentype` (M37) | `core`, `sketch` | `opentype.js` ([[0029-text-ve-skice-pres-opentype\|ADR 0029]]) |
| `protocol` (M39) | – (vygenerovaný z `server/proto` přes `npm run gen:proto`, i `index.ts`; není v gitu, ESLint a Prettier ho ignorují) | `@bufbuild/protobuf` |
| `remote` (M39) | `core`, `document` a `ops` (převody read modelu a operací, [[Rozhodnutí nativního jádra\|N74]]), `kernel` (`createKernelError`, `KernelErrorCode`), `sketch` (porty a typy), `protocol` | `@bufbuild/protobuf`, `@connectrpc/connect`, `@connectrpc/connect-web` ([[Q106 Moduly klienta pro gRPC\|Q106]], [[14-protokol]]) |
| `render` | `core`, `kernel` (jen typy: `MeshData`, `MeshOps`, `MeshQuality`, `ShapeHandle`, `BoundingBox`), `interaction` (jen typy: `ViewportPort`, události, `BodyId`, [[Q056 Odkud render bere BodyId\|Q056]]) | `three` (včetně `three/addons`) |
| `interaction` | `core`, `document`, `ops`, `sketch` | – |
| `sketcher` | `core`, `document`, `ops` (jen `ops/testing` v testech, pravidlo `sketcher-ops-only-in-tests`), `sketch`, `interaction` | – |
| `plugin-api` | `interaction` | – |
| `features/*` | `core`, `document`, `interaction`, `plugin-api` | – |
| `app` | `core`, `document`, `ops`, `kernel`, `sketch`, `solver-planegcs`, `text-opentype`, `remote`, `render`, `interaction`, `sketcher`, `plugin-api`, `features/*` (vše kromě `ui`; `protocol` jen přes `remote`) | – |
| `ui` | `app`, `core`, typy z `document`, `interaction` a `sketcher`, hodnoty z `interaction/constants.ts` a `sketcher/constants.ts` | `vue`, `vue-i18n`, `@tabler/icons-webfont` ([[0014-preklady-vue-i18n-a-klice\|ADR 0014]], [[11-ui#Styl]]) |

Důležité zákazy:
- `features/*` se navzájem neimportují.
- Nic kromě `app` neimportuje `remote`, `solver-planegcs` ani `text-opentype` (konkrétní implementace); `protocol` importuje jen `remote`. `sketch` je doménový model skici a port řešiče, ne plugin; skicář (režim, nástroje) je modul `sketcher` ([[0024-modul-sketcher|ADR 0024]]) ([[0017-modul-sketch-a-skicar|ADR 0017]], M12).
- `ui` nesahá na `ops`, `kernel`, `remote`, `render` přímo – jen přes `AppSession`.
- `interaction/constants.ts` je datový vstupní bod ([[M20-zpevneni-struktury|M20]], D6): jen hodnoty (konstanty, rozměry glyfů, prahy) bez importů kromě `core` a datových souborů modulu bez závislostí (dnes `mode.ts`, seznam `DATA_ENTRY_MODULES` v `.dependency-cruiser.cjs`; pravidlo hlídá i je). Modul, který smí z `interaction` jen typy (`ui`), z něj smí i hodnoty (sloupec `constants` v `.dependency-cruiser.cjs`). Čistotu hlídá pravidlo `interaction-constants-only-data`. Obsah: `ACTION_IDS`, `FILE_ACTION_IDS`, `toolActionId`, `toolModes`, `MANIPULATOR_GLYPHS`, `HANDLE_VISIBILITY` a od [[M28-koty|M28]] `CLICK_TOLERANCE_PX` (práh tahu proti kliku, sdílí ho `select-tool` a tah popisku kóty v `ui`). `render` hodnoty nebere, dostane je od `app` při vytvoření viewportu.
- Porty `ops` v aplikaci implementuje jen `app/remote-dispatcher.ts` (tenký dispečer nad `RemoteSession`). Testovací dvojník portů je `FakeOps` v `ops/testing.ts` ([[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N166]], nahradil paměťový dispečer z N121): nic neaplikuje, zaznamená odeslané změny a odpovídá skriptovaně. Produkční kód ho díky pravidlu `testing-only-in-tests` použít nemůže.
- `sketcher` má `ops` mezi závislostmi jen kvůli `FakeOps` v testech; produkční kód skicáře mění dokument jen přes `FeatureEditor` z `interaction`, nikdy přes `ops` (pravidlo `sketcher-ops-only-in-tests`, platí i po M52).
- `testing.ts` smí importovat **jen testovací kód** (testy v `test/` a jiné `testing.ts`), a to jen z modulů, na které jeho modul smí záviset **hodnotově** (sloupec `deps`; typová závislost `types` k `testing.ts` nepouští). Produkční kód ho neimportuje nikdy, ani ve vlastním modulu – buildery se tak nedostanou do produkčního bundlu. Testovací kód smí používat `vitest` (fake s `vi.fn`) a skládat buildery jiných modulů. Pravidla `testing-only-in-tests` a `<modul>-allowed-deps-in-tests` v `.dependency-cruiser.cjs`.
- Testy leží v `test/` ([[0023-testy-mimo-zdrojaky|ADR 0023]]). Vše pod `test/unit/<modul>/` je testovací kód modulu `<modul>` a platí pro něj stejná pravidla jako pro jeho `testing.ts`, včetně `no-deep-import` a importů jen typů. Produkční kód v `src/` nesmí importovat nic z `test/` (pravidlo `no-test-in-production`). `test/integration/` a `test/e2e/` nepatří žádnému modulu.
- Pravidla jsou whitelist: tabulka výše je zkopírovaná v `.dependency-cruiser.cjs` a z ní se generuje jedno pravidlo na modul (vlastní soubory + `index.ts` povolených modulů + povolené npm balíčky). Importy assetů Vite s dotazem (`balík/soubor?url`) dependency-cruiser nevyřeší; místo `not-to-unresolvable` je hlídá pravidlo `<modul>-allowed-npm-assets` proti stejnému seznamu npm balíků (dnes jen WASM planegcs v `solver-planegcs`; zavedeno v M7 pro OCCT WASM).
- `interaction` nezná `render`: viewport zná jen přes port `ViewportPort`, který sám definuje. `render` ho implementuje ([[0009-platformove-nezavisla-domena|ADR 0009]]).
- Prstence 1 a 2 nepoužívají globální objekty prohlížeče (`window`, `document`, `requestAnimationFrame`, `indexedDB`, DOM typy událostí).

## Tok dat jedné změny

Příklad: uživatel v dialogu kvádru změní výšku z 10 na 20. Podrobnosti RPC jsou v [[14-protokol#Změny dokumentu]] a [[14-protokol#Read model a sítě]].

```
ui (FeatureDialog)
  └─ session.features.current.setParam('height', 20)
       interaction/FeatureEditSession
         ├─ rozpracované hodnoty = { ...params, height: 20 }  → pole dialogu hned ukazuje 20 (N164)
         └─ send #n: tx.apply({ type: 'feature.setParams', featureId, params })
              app/remote-dispatcher (implementuje Transaction z ops, nic neaplikuje)
                └─ RemoteSession.change({ kind: 'apply', op }) ── gRPC-Web ──► Envoy ──► tinycad-core
                                                                  SessionService → RuntimeDocument
                                                                  ├─ ops: Transaction::apply (C++)
                                                                  ├─ regen: Regenerator::run (OCCT)
                                                                  └─ read model + sítě nových
                                                                     content_version
  ◄── odpověď (read model) ─────────────────────────────────────────┘
  └─ app/remote-session: document.replace(snímek read modelu)   (createSnapshotDocument, N165)
       → doc.events.changed: strom featur, Prohlížeč, titulek
  └─ app/read-model-view: sítě do VersionMeshes (handle = content_version, N66)
       → viewport.syncLayers (render/SceneSync), stav featur, kresby skic, čítače
         (až po sync, aby index z pickingu a jména patřily k téže generaci, M19.1)
  └─ teprve potom se vyřeší slib tx.apply → true
       FeatureEditSession: přijato a n je poslední odeslané → rozpracované hodnoty pryč,
       EditState.params čte dokument (read model odpovědi)
ui: dialog, strom featur a stav se překreslí přes composables
...uživatel klikne OK
  └─ dialog se zavře hned; tx.commit() jde frontou za kroky ──► server zapíše 1 záznam do logu v SQLite
```

Server je autorita a jediná implementace domény ([[0031-tenky-klient-bez-handleru|ADR 0031]]). **Dokument se mění jen odpovědí:** `replace` snímkového dokumentu volá jediné místo, odběr `session.readModel` v `app/remote-session.ts`, zaregistrovaný před dispečerem, takže když se vyřeší slib změny, dokument už ukazuje read model odpovědi ([[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N165]]). Jediný lokální stav změn jsou [[Rozpracované hodnoty dialogu|rozpracované hodnoty dialogu]] s pravidlem „poslední vyhrává“ (N164); strom, Prohlížeč a titulek ukážou změnu až s odpovědí (N168). Odmítnutou změnu hlásí `app` a dokument zůstane na stavu serveru. Undo a redo čekají na odpověď jako všechno ostatní ([[Rozhodnutí nativního jádra|N64]]).

## Adresářová struktura

```
tinycad/
├─ docs/                    Obsidian vault: specifikace, ADR, plán, pojmy, deník
├─ src/                     klient (prohlížeč)
│  ├─ core/                 id, události, Result, matematika, core/rpc (RPC s workerem)
│  ├─ document/             typy modelu, čtecí pohled nad snímky read modelu (createSnapshotDocument), schéma, validace, typy chyb importu (load-error.ts)
│  ├─ ops/                  typy operací, OP_VERSION, porty; testing.ts = FakeOps (N166)
│  ├─ kernel/               jen typy sítí, oblastí profilu a chyb jádra (N122)
│  ├─ sketch/               model skici, oblasti, port ConstraintSolver (M12)
│  ├─ solver-planegcs/      adaptér řešiče vazeb, worker (M12)
│  ├─ text-opentype/        adaptér obrysů písmen, přibalené fonty (M37)
│  ├─ protocol/             vygenerovaný kód z server/proto (není v gitu)
│  ├─ remote/               adaptéry nad gRPC-Web: sezení, dokumenty, read model, SketchGeometry
│  ├─ render/
│  ├─ interaction/          prezentační modely; podsložky manipulators/ a feature-dialog/
│  ├─ sketcher/             režim skicáře (ADR 0024)
│  ├─ plugin-api/
│  ├─ features/             klientské půlky featur: tool, manipulators, messages, params, anchors
│  │  ├─ box/
│  │  ├─ cylinder/
│  │  └─ …
│  ├─ app/
│  ├─ ui/
│  │  ├─ components/
│  │  └─ composables/
│  └─ main.ts               startUi('#app', { plugins: BUILT_IN_PLUGINS }) – seznam pluginů z app, Vue z ui
├─ server/                  nativní jádro tinycad-core (C++, CMake, vcpkg; ADR 0030)
│  ├─ proto/tinycad/v1/     kontrakt gRPC (spec 14)
│  ├─ src/<oblast>/         knihovny tinycad_<oblast>: core, document, ops, features, storage,
│  │                        occt2d (interní 2D základ OCCT pro kernel a geometry), kernel, regen,
│  │                        geometry, sketch, solver-planegcs, session (doména sezení bez protobufu),
│  │                        rpc (služby gRPC, převody tinycad.v1, otisk požadavku, stavy chyb),
│  │                        app (CoreServer, main), tools (tinycad-import); hlavičky v include/tinycad/
│  ├─ test/<oblast>/        GoogleTest; test/shared-cases spouští sdílené případy
│  └─ third_party/planegcs/ vendorovaný řešič
├─ test/                    testy klienta mimo zdrojáky (ADR 0023)
│  ├─ unit/                 unit testy, zrcadlová struktura src/ (test/unit/interaction/feature-editor.test.ts)
│  ├─ shared-cases/         sdílené případy JSON pro TS i C++ (spec 13)
│  ├─ golden/               zlatý soubor popisů typů featur ze serveru
│  ├─ integration/          běžce sdílených případů sketch a schema, test remote/feature-types
│  └─ e2e/                  Playwright proti Docker Compose
├─ docker-compose.yml       tinycad-core a Envoy
├─ .dependency-cruiser.cjs
├─ vite.config.ts           mimo jiné proxy /api na Envoy
├─ tsconfig.json            řešení: odkazy na projekty níže, `vue-tsc -b`
├─ tsconfig.base.json       společné přísné volby
├─ tsconfig.domain.json     prstence 1 a 2, bez lib DOM a bez @types
├─ tsconfig.app.json        kód pro prohlížeč (DOM, vite/client), bez testů
├─ tsconfig.test.json       testy (test/unit, test/integration), typy Node, bez DOM
├─ tsconfig.test-app.json   testy app a ui v Node (s fake), lib DOM kvůli typům AppSession a render
└─ tsconfig.node.json       konfigurace Vite a Vitest
```

Testy jednotek leží v zrcadlovém stromu: `src/<modul>/foo.ts` → `test/unit/<modul>/foo.test.ts`, importy přes alias `@/` ([[0023-testy-mimo-zdrojaky|ADR 0023]]). Dřív ležely vedle kódu, přesun proběhl v [[M20-zpevneni-struktury|M20]].

## Kompoziční kořen

Klient má jeden kompoziční kořen v `app`, rozdělený na tenkou vrstvu prohlížeče a sestavení bez DOM ([[11-ui#Kompoziční kořen (app)]]):

- `app/browser.ts` (`openAppSession`, `createDocumentList`) vytváří konkrétní implementace: transport gRPC-Web (`createCoreTransport`), viewport (`createViewport`), worker řešiče (`createPlanegcsSolver`), obrysy písmen (`createOpentypeOutliner`), časovače a úložiště pro obnovení sezení v `sessionStorage` ([[Rozhodnutí nativního jádra|N70]]). Napojuje události prohlížeče: `pagehide` → `CloseSession` s `keepalive`. Prstenec 1 DOM ani časovače nezná ([[0009-platformove-nezavisla-domena|ADR 0009]]).
- `app/remote-session.ts` (`createRemoteAppSession`) z nich sestaví `AppSession`: otevře sezení na serveru, postaví snímkový dokument nad read modelem (`createSnapshotDocument`) a tenký `RemoteDispatcher` za porty `ops`, schémata z `FeatureTypeDescriptor` a nástroje a manipulátory z pluginů (`remote-registries.ts`), pohled na read model (`read-model-view.ts`) a stav spojení (`connection-state.ts`). Je to jediné místo, kde se rozhoduje, *která* implementace rozhraní se použije.
- vystavuje fasádu pro UI.

Ostatní moduly dostávají závislosti jako rozhraní v parametru `deps` tovární funkce (dependency injection bez frameworku, ručně; [[0011-programovani-proti-rozhranim|ADR 0011]]).

Na serveru je kompoziční kořen třída `CoreServer` v `server/src/app/core_server.hpp`: registr schémat, handlery operací a buildery featur, katalog SQLite, `SessionManager` nad továrnami `OcctKernel` a `PlanegcsSolver`, tři služby gRPC z `tinycad_rpc` (`SessionServiceImpl`, `DocumentServiceImpl`, `GeometryServiceImpl`) a vlákno pro timeout nečinnosti ([[Rozhodnutí nativního jádra|N130]]). Knihovny domény jsou propojené přes abstraktní rozhraní (`GeometryKernel`, porty úložiště) stejně jako v TS ([[Rozhodnutí nativního jádra|N9]]).

## Komunikace mezi vrstvami

- **Dolů:** přímé volání metod přes rozhraní.
- **Nahoru:** typované události (`Emitter` z `core`, ve veřejném rozhraní vystavený jako `Subscribable`). Nižší vrstva nikdy nevolá vyšší.
- **Do UI:** [[Prezentační model|prezentační modely]] vystavují stav jako `Observable<T>` (neměnný snapshot + `subscribe`). Pohled stav čte a volá příkazy, presenter do pohledu nezapisuje ([[0010-prezentacni-model|ADR 0010]]).
- **Do workeru řešiče:** typované RPC nad `postMessage` (`core/rpc`), velká data jako transferable `ArrayBuffer`.
- **Na server:** gRPC-Web přes Envoy, jen v modulu `remote`; změny jsou idempotentní požadavky s `operation_id`, stav přichází jako read model a stream událostí `WatchSession` ([[14-protokol]]).

## Souřadnice a jednotky

- Interně **milimetry** a **radiány**. Převod jednotek je věc UI.
- Pravotočivý systém, **Z nahoru** (jako Onshape). Three.js je standardně Y nahoru. „Z nahoru“ platí pro standardní pohledy a `setViewDirection` (`viewBasis`), kamera sama má volnou orientaci (quaternion, [[0019-vlastni-ovladani-kamery|ADR 0019]]).

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
