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
  - persistence
  - kernel
  - kernel-occt
  - sketch
  - solver-planegcs
  - regen
  - render
  - interaction
  - plugin-api
  - features
  - app
  - ui
milestones:
  - "[[M00-zaklad-projektu]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-14
---
# 01 – Architektura

> **Pojmy:** [[Port a adaptér]], [[Kompoziční kořen]], [[Dokument]], [[Neměnná data]], [[Operace]], [[Prezentační model]]  
> **Rozhodnutí:** [[0001-jadro-v-cistem-ts]], [[0003-dokument-je-recept]], [[0004-data-oddelene-od-chovani]], [[0005-operacni-log]], [[0008-hranice-modulu]], [[0009-platformove-nezavisla-domena]], [[0010-prezentacni-model]], [[0011-programovani-proti-rozhranim]], [[0017-modul-sketch-a-skicar]]  
> **Milník:** [[M00-zaklad-projektu]]

## Principy

1. **Dokument je recept, ne geometrie.** Ukládá se seznam featur s parametry. Geometrie je vždy odvozená přehráním (regenerací) a dá se kdykoli zahodit. ([[0003-dokument-je-recept|ADR 0003]])
2. **Doména nezávisí na ničem vnějším.** Dokument, operace i regenerace jsou čistý TypeScript bez Vue, Three.js a OCCT. Vnější svět je za porty (rozhraními) a adaptéry. ([[0001-jadro-v-cistem-ts|ADR 0001]])
3. **Data odděleně od chování.** Featury a operace jsou neměnná serializovatelná data. Chování (builder, handler) je registrované podle typu. ([[0004-data-oddelene-od-chovani|ADR 0004]])
4. **Jediná cesta ke změně dokumentu je operace.** Nástroje i UI jen vyrábějí operace a posílají je dispečerovi. ([[0005-operacni-log|ADR 0005]])
5. **Rozšiřitelnost přes registry a pluginy.** Nová featura = nový plugin, žádné `switch (type)` v jádru. (Open/closed princip.)
6. **Asynchronní hranice tam, kde je worker.** Rozhraní jádra a persistence jsou od začátku asynchronní.
7. **Doména a prezentační logika nevědí, na jaké platformě běží.** Žádné DOM, Worker, Vue, Three.js ani OCCT. Přenos na jinou platformu = přepsat jen adaptéry. ([[0009-platformove-nezavisla-domena|ADR 0009]])
8. **Programování proti rozhraním.** Veřejné API modulu tvoří rozhraní, datové typy a tovární funkce `createXxx(deps)`. Třídy zůstávají uvnitř modulu, konkrétní implementace propojuje jen `app`. Platí i tam, kde druhá implementace není v plánu. Výjimky: data a hodnotové typy, malé utility v `core`, třídy chyb. ([[0011-programovani-proti-rozhranim|ADR 0011]])
9. **Modularita.** Malé veřejné API, úzká rozhraní pojmenovaná podle role, kompozice místo dědičnosti, rozšíření bez úpravy jádra. ([[0011-programovani-proti-rozhranim|ADR 0011]])

## Vrstvy a moduly

Každý modul je složka v `src/` s veřejným API v `index.ts`. Volitelně má druhý vstupní bod `testing.ts` s pomůckami pro testy (buildery, fake implementace), viz pravidla níže. Testy modulu leží mimo `src/`, v `test/unit/<modul>/` ([[0023-testy-mimo-zdrojaky|ADR 0023]]), a pro pravidla závislostí patří k modulu.

### Tři prstence

Nad vrstvami platí hrubší dělení podle toho, jestli modul smí znát platformu ([[0009-platformove-nezavisla-domena|ADR 0009]]):

| Prstenec | Moduly | Platforma (DOM, Worker, Vue, Three.js, OCCT) |
|---|---|---|
| 1. Doména | `core`, `document`, `ops`, `regen`, `kernel`, `sketch` (M12), `persistence` (bez `idb/`), `plugin-api`, `features/*` | ne |
| 2. Prezentační logika | `interaction` ([[Prezentační model\|prezentační modely]], nástroje, port `ViewportPort`), `sketcher` (režim skicáře, [[0024-modul-sketcher\|ADR 0024]]) | ne |
| 3. Adaptéry a platforma | `render`, `ui`, `kernel-occt`, `solver-planegcs` (M12), `persistence/idb`, `app` | ano |

Prstence 1 a 2 se typují konfigurací `tsconfig.domain.json` bez knihovny `DOM`, takže použití `window` nebo `KeyboardEvent` shodí `typecheck`. `app` je kompoziční kořen *pro danou platformu*.

```
┌──────────────────────────────────────────────────────────────┐
│ ui            Vue komponenty, composables                    │
├──────────────────────────────────────────────────────────────┤
│ app           AppSession – kompoziční kořen, fasáda pro UI   │
├──────────────┬───────────────────────────────────────────────┤
│ features/*   │ pluginy featur (box, cylinder, …)             │
│ plugin-api   │ typ FeaturePlugin                             │
├──────────────┴──────────┬────────────────────────────────────┤
│ sketcher (→ interaction)│ render                             │
│ režim skicáře           │ Three.js viewport, picking         │
│ interaction             │ (implementuje ViewportPort)        │
│ výběr, nástroje, akce,  │                                    │
│ prezentační modely,     │                                    │
│ port ViewportPort       │                                    │
├─────────────────────────┴────────────────────────────────────┤
│ regen         Regenerator, FeatureBuilder, RegenState        │
├───────────────────────────┬──────────────────────────────────┤
│ persistence (port+IDB)    │ kernel (port)  ◄── kernel-occt   │
├───────────────────────────┤                    (adaptér,     │
│ ops     operace, log,     │                     worker)      │
│         undo/redo         │                                  │
├───────────────────────────┤                                  │
│ document  doménový model  │                                  │
├───────────────────────────┴──────────────────────────────────┤
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
| `persistence` | `core`, `document`, `ops` | – |
| `persistence/idb` | `core`, `document`, `ops`, `persistence` | (IndexedDB API) |
| `kernel` | `core` | – |
| `kernel-occt` | `core`, `kernel` | `replicad-opencascadejs` ([[0013-replicad-opencascadejs\|ADR 0013]]) |
| `sketch` (M12) | `core` | – |
| `solver-planegcs` (M12) | `core`, `sketch` | `@salusoft89/planegcs` ([[0016-planegcs-resic-vazeb\|ADR 0016]]) |
| `regen` | `core`, `document`, `kernel`, `sketch` | – |
| `render` | `core`, `kernel` (jen typy: `MeshData`, `MeshOps`, `MeshQuality`, `ShapeHandle`, `BoundingBox`), `interaction` (jen typy: `ViewportPort`, události, `BodyId`, [[Q056 Odkud render bere BodyId\|Q056]]) | `three` (včetně `three/addons`) |
| `interaction` | `core`, `document`, `ops`, `sketch` | – |
| `sketcher` | `core`, `document`, `ops` (jen `ops/testing` v testech, pravidlo `sketcher-ops-only-in-tests`), `sketch`, `interaction` | – |
| `plugin-api` | `core`, `document`, `regen`, `interaction` | – |
| `features/*` | `core`, `document`, `ops`, `kernel`, `sketch`, `regen`, `interaction`, `plugin-api` | – |
| `app` | vše kromě `ui` | – |
| `ui` | `app`, `core`, typy z `document`, `interaction` a `sketcher`, hodnoty z `interaction/constants.ts` a `sketcher/constants.ts` | `vue`, `vue-i18n`, `@tabler/icons-webfont` ([[0014-preklady-vue-i18n-a-klice\|ADR 0014]], [[11-ui#Styl]]) |

Důležité zákazy:
- `features/*` se navzájem neimportují.
- Nic kromě `app` neimportuje `kernel-occt` ani `solver-planegcs` (konkrétní implementace). `sketch` je doménový model skici a port řešiče, ne plugin; skicář (režim, nástroje) je modul `sketcher` ([[0024-modul-sketcher|ADR 0024]]) ([[0017-modul-sketch-a-skicar|ADR 0017]], M12).
- `ui` nesahá na `ops`, `regen`, `kernel`, `render` přímo – jen přes `AppSession`.
- `regen` nezná `ops` (regenerace neví, jak změna vznikla).
- `interaction/constants.ts` je datový vstupní bod ([[M20-zpevneni-struktury|M20]], D6): jen hodnoty (konstanty, rozměry glyfů, prahy) bez importů kromě `core` a datových souborů modulu bez závislostí (dnes `mode.ts`, seznam `DATA_ENTRY_MODULES` v `.dependency-cruiser.cjs`; pravidlo hlídá i je). Modul, který smí z `interaction` jen typy (`ui`), z něj smí i hodnoty (sloupec `constants` v `.dependency-cruiser.cjs`). Čistotu hlídá pravidlo `interaction-constants-only-data`. Obsah: `ACTION_IDS`, `FILE_ACTION_IDS`, `toolActionId`, `toolModes`, `MANIPULATOR_GLYPHS`, `HANDLE_VISIBILITY` a od [[M28-koty|M28]] `CLICK_TOLERANCE_PX` (práh tahu proti kliku, sdílí ho `select-tool` a tah popisku kóty v `ui`). `render` hodnoty nebere, dostane je od `app` při vytvoření viewportu.
- `persistence/idb` je samostatný vstupní bod (vlastní `index.ts`), který importuje jen `app`. `persistence/index.ts` ho nereexportuje, jinak by se adaptér přes import dostal do prstence 1.
- `testing.ts` smí importovat **jen testovací kód** (testy v `test/` a jiné `testing.ts`), a to jen z modulů, na které jeho modul smí záviset **hodnotově** (sloupec `deps`; typová závislost `types` k `testing.ts` nepouští). Produkční kód ho neimportuje nikdy, ani ve vlastním modulu – buildery se tak nedostanou do produkčního bundlu. Testovací kód smí používat `vitest` (fake s `vi.fn`) a skládat buildery jiných modulů. Pravidla `testing-only-in-tests` a `<modul>-allowed-deps-in-tests` v `.dependency-cruiser.cjs`.
- Testy leží v `test/` ([[0023-testy-mimo-zdrojaky|ADR 0023]]). Vše pod `test/unit/<modul>/` je testovací kód modulu `<modul>` a platí pro něj stejná pravidla jako pro jeho `testing.ts`, včetně `no-deep-import` a importů jen typů. Produkční kód v `src/` nesmí importovat nic z `test/` (pravidlo `no-test-in-production`). `test/integration/` a `test/e2e/` nepatří žádnému modulu.
- Pravidla jsou whitelist: tabulka výše je zkopírovaná v `.dependency-cruiser.cjs` a z ní se generuje jedno pravidlo na modul (vlastní soubory + `index.ts` povolených modulů + povolené npm balíčky). Importy assetů Vite s dotazem (`balík/soubor?url`) dependency-cruiser nevyřeší; místo `not-to-unresolvable` je hlídá pravidlo `<modul>-allowed-npm-assets` proti stejnému seznamu npm balíků ([[06-geometricke-jadro]], M7).
- `interaction` nezná `render`: viewport zná jen přes port `ViewportPort`, který sám definuje. `render` ho implementuje ([[0009-platformove-nezavisla-domena|ADR 0009]]).
- Prstence 1 a 2 nepoužívají globální objekty prohlížeče (`window`, `document`, `requestAnimationFrame`, `indexedDB`, DOM typy událostí).

## Tok dat jedné změny

Příklad: uživatel v dialogu kvádru změní výšku z 10 na 20.

```
ui (FeatureDialog)
  └─ session.features.current.setParam('height', 20)
       interaction/FeatureEditSession
         └─ tx.apply({ type: 'feature.setParams', featureId, params })
              ops/OperationDispatcher
                ├─ handler.invert(doc, op)      → inverzní operace
                ├─ handler.apply(writer, op)    → PartStudio.features = nové pole
                └─ emit('applied')
document emit('changed')
  └─ app (regen-pipeline): regenScheduler.request()
       regen/Regenerator.run(studio)
         ├─ najde první featuru, jejíž instance se změnila (identita objektu)
         ├─ builder.build(...) → kernel.makeBox(...)   ── postMessage ──► worker (OCCT)
         └─ RegenResult { finalState: { artifacts }, statuses }
  └─ app: await viewport.bodies.sync(tělesa)            (render/SceneSync)
       ├─ kernel.tessellate(handle) pro nové handle   ── worker ──►
       └─ Three.js mesh, requestRender()
  └─ app: regenStatus.publish(result), kresby skic, čítače   (až po sync: index
       z pickingu a jména patří k téže generaci, M19.1)
ui: strom featur a stav se překreslí přes composables
...uživatel klikne OK
  └─ tx.commit() → OperationLog.append(1 záznam) → persistence (worker, IndexedDB)
```

## Adresářová struktura

```
tinycad/
├─ docs/                    Obsidian vault: specifikace, ADR, plán, pojmy, deník
├─ src/
│  ├─ core/
│  ├─ document/
│  ├─ ops/
│  ├─ persistence/
│  │  └─ idb/               adaptér IndexedDB + worker
│  ├─ kernel/               port + FakeKernel (pro testy)
│  ├─ kernel-occt/          adaptér OCCT, worker
│  ├─ sketch/               model skici, oblasti, port ConstraintSolver (M12)
│  ├─ solver-planegcs/      adaptér řešiče vazeb, worker (M12)
│  ├─ regen/
│  ├─ render/
│  ├─ interaction/          prezentační modely; podsložky manipulators/ a feature-dialog/
│  ├─ sketcher/             režim skicáře (ADR 0024)
│  ├─ plugin-api/
│  ├─ features/
│  │  ├─ box/
│  │  ├─ cylinder/
│  │  └─ …
│  ├─ app/
│  ├─ ui/
│  │  ├─ components/
│  │  └─ composables/
│  └─ main.ts               startUi('#app', { plugins: BUILT_IN_PLUGINS }) – seznam pluginů z app, Vue z ui
├─ test/                    testy mimo zdrojáky (ADR 0023)
│  ├─ unit/                 unit testy, zrcadlová struktura src/ (test/unit/interaction/feature-editor.test.ts); testy OCCT v unit/kernel-occt (Q051)
│  ├─ integration/          integrační testy se skutečnými adaptéry
│  └─ e2e/                  Playwright
├─ .dependency-cruiser.cjs
├─ vite.config.ts
├─ tsconfig.json            řešení: odkazy na projekty níže, `vue-tsc -b`
├─ tsconfig.base.json       společné přísné volby
├─ tsconfig.domain.json     prstence 1 a 2, bez lib DOM a bez @types
├─ tsconfig.app.json        kód pro prohlížeč (DOM, vite/client), bez testů
├─ tsconfig.test.json       testy (test/unit, test/integration), typy Node, bez DOM
├─ tsconfig.test-idb.json   testy adaptéru IndexedDB (fake-indexeddb v Node), typy Node + lib DOM
├─ tsconfig.test-app.json   testy app a ui v Node (s fake), lib DOM kvůli typům AppSession a render
└─ tsconfig.node.json       konfigurace Vite a Vitest
```

Testy jednotek leží v zrcadlovém stromu: `src/<modul>/foo.ts` → `test/unit/<modul>/foo.test.ts`, importy přes alias `@/` ([[0023-testy-mimo-zdrojaky|ADR 0023]]). Dřív ležely vedle kódu, přesun proběhl v [[M20-zpevneni-struktury|M20]].

## Kompoziční kořen

`app/AppSession` je jediné místo, které:
- vytváří konkrétní implementace voláním továrních funkcí (`createOcctKernel`, `createIdbDocumentStore`, `createViewport`…) – jediné místo, kde se rozhoduje, *která* implementace rozhraní se použije,
- registruje pluginy (`registerPlugin(boxPlugin)` → schéma do `FeatureSchemaRegistry`, builder do `BuilderRegistry`, nástroje do `ToolRegistry`),
- propojuje události (změna dokumentu → regenerace → vykreslení; operace → persistence),
- napojuje události prohlížeče na doménové služby: `pagehide` a `visibilitychange` → `PersistenceService.flush()` ([[Q034 Uložení při zavírání stránky|Q034]]), `setTimeout` jako `Scheduler`. Prstenec 1 DOM ani časovače nezná ([[0009-platformove-nezavisla-domena|ADR 0009]]),
- vystavuje fasádu pro UI.

Ostatní moduly dostávají závislosti jako rozhraní v parametru `deps` tovární funkce (dependency injection bez frameworku, ručně; [[0011-programovani-proti-rozhranim|ADR 0011]]).

## Komunikace mezi vrstvami

- **Dolů:** přímé volání metod přes rozhraní.
- **Nahoru:** typované události (`Emitter` z `core`, ve veřejném rozhraní vystavený jako `Subscribable`). Nižší vrstva nikdy nevolá vyšší.
- **Do UI:** [[Prezentační model|prezentační modely]] vystavují stav jako `Observable<T>` (neměnný snapshot + `subscribe`). Pohled stav čte a volá příkazy, presenter do pohledu nezapisuje ([[0010-prezentacni-model|ADR 0010]]).
- **Do workerů:** typované RPC nad `postMessage` (`core/rpc`), velká data jako transferable `ArrayBuffer`.

## Souřadnice a jednotky

- Interně **milimetry** a **radiány**. Převod jednotek je věc UI.
- Pravotočivý systém, **Z nahoru** (jako Onshape). Three.js je standardně Y nahoru. „Z nahoru“ platí pro standardní pohledy a `setViewDirection` (`viewBasis`), kamera sama má volnou orientaci (quaternion, [[0019-vlastni-ovladani-kamery|ADR 0019]]).

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
