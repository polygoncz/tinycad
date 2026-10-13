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
updated: 2026-10-13
---
# 01 – Architektura

> **Pojmy:** [[Port a adaptér]], [[Kompoziční kořen]], [[Dokument]], [[Neměnná data]], [[Operace]], [[Prezentační model]]  
> **Rozhodnutí:** [[0001-jadro-v-cistem-ts]], [[0003-dokument-je-recept]], [[0004-data-oddelene-od-chovani]], [[0005-operacni-log]], [[0008-hranice-modulu]], [[0009-platformove-nezavisla-domena]], [[0010-prezentacni-model]], [[0011-programovani-proti-rozhranim]]  
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

Každý modul je složka v `src/` s veřejným API v `index.ts`. Volitelně má druhý vstupní bod `testing.ts` s pomůckami pro testy (buildery, fake implementace), viz pravidla níže.

### Tři prstence

Nad vrstvami platí hrubší dělení podle toho, jestli modul smí znát platformu ([[0009-platformove-nezavisla-domena|ADR 0009]]):

| Prstenec | Moduly | Platforma (DOM, Worker, Vue, Three.js, OCCT) |
|---|---|---|
| 1. Doména | `core`, `document`, `ops`, `regen`, `kernel`, `persistence` (bez `idb/`), `plugin-api`, `features/*` | ne |
| 2. Prezentační logika | `interaction` ([[Prezentační model\|prezentační modely]], nástroje, port `ViewportPort`) | ne |
| 3. Adaptéry a platforma | `render`, `ui`, `kernel-occt`, `persistence/idb`, `app` | ano |

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
│ interaction             │ render                             │
│ výběr, nástroje, akce,  │ Three.js viewport, picking         │
│ prezentační modely,     │ (implementuje ViewportPort)        │
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
| `kernel-occt` | `core`, `kernel` | OCCT WASM |
| `regen` | `core`, `document`, `kernel` | – |
| `render` | `core`, `kernel` (jen typy `MeshData`), `interaction` (jen typy: `ViewportPort`, události) | `three` |
| `interaction` | `core`, `document`, `ops` | – |
| `plugin-api` | `core`, `document`, `regen`, `interaction` | – |
| `features/*` | `core`, `document`, `ops`, `kernel`, `regen`, `interaction`, `plugin-api` | – |
| `app` | vše kromě `ui` | – |
| `ui` | `app`, `core`, typy z `document` a `interaction` | `vue` |

Důležité zákazy:
- `features/*` se navzájem neimportují.
- Nic kromě `app` neimportuje `kernel-occt` (konkrétní implementace).
- `ui` nesahá na `ops`, `regen`, `kernel`, `render` přímo – jen přes `AppSession`.
- `regen` nezná `ops` (regenerace neví, jak změna vznikla).
- `persistence/idb` je samostatný vstupní bod (vlastní `index.ts`), který importuje jen `app`. `persistence/index.ts` ho nereexportuje, jinak by se adaptér přes import dostal do prstence 1.
- `testing.ts` smí importovat **jen testovací kód** (`*.test.ts` a jiné `testing.ts`), a to jen z modulů, na které jeho modul smí záviset **hodnotově** (sloupec `deps`; typová závislost `types` k `testing.ts` nepouští). Produkční kód ho neimportuje nikdy, ani ve vlastním modulu – buildery se tak nedostanou do produkčního bundlu. Testovací kód smí používat `vitest` (fake s `vi.fn`) a skládat buildery jiných modulů. Pravidla `testing-only-in-tests` a `<modul>-allowed-deps-in-tests` v `.dependency-cruiser.cjs`.
- Pravidla jsou whitelist: tabulka výše je zkopírovaná v `.dependency-cruiser.cjs` a z ní se generuje jedno pravidlo na modul (vlastní soubory + `index.ts` povolených modulů + povolené npm balíčky).
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
  └─ app: regenScheduler.request()
       regen/Regenerator.run(studio)
         ├─ najde první featuru, jejíž instance se změnila (identita objektu)
         ├─ builder.build(...) → kernel.makeBox(...)   ── postMessage ──► worker (OCCT)
         └─ RegenResult { bodies, statuses }
  └─ render/SceneSync.update(result)
       ├─ kernel.tessellate(handle) pro nové handle   ── worker ──►
       └─ Three.js mesh, requestRender()
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
│  ├─ regen/
│  ├─ render/
│  ├─ interaction/
│  ├─ plugin-api/
│  ├─ features/
│  │  ├─ box/
│  │  ├─ cylinder/
│  │  └─ …
│  ├─ app/
│  ├─ ui/
│  │  ├─ components/
│  │  └─ composables/
│  └─ main.ts               vytvoří AppSession a připojí Vue
├─ tests/                   integrační testy (kernel-occt, e2e)
├─ .dependency-cruiser.cjs
├─ vite.config.ts
├─ tsconfig.json            řešení: odkazy na projekty níže, `vue-tsc -b`
├─ tsconfig.base.json       společné přísné volby
├─ tsconfig.domain.json     prstence 1 a 2, bez lib DOM a bez @types
├─ tsconfig.app.json        kód pro prohlížeč (DOM, vite/client), bez testů
├─ tsconfig.test.json       testy (*.test.ts, tests/), typy Node, bez DOM
├─ tsconfig.test-idb.json   testy adaptéru IndexedDB (fake-indexeddb v Node), typy Node + lib DOM
└─ tsconfig.node.json       konfigurace Vite a Vitest
```

Testy jednotek leží vedle kódu (`foo.ts` + `foo.test.ts`).

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
- Pravotočivý systém, **Z nahoru** (jako Onshape). Three.js je standardně Y nahoru → kamera má `up = (0, 0, 1)`.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
