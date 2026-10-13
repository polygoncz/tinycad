---
type: milestone
status: doing
order: 10
aliases:
  - M10
  - M10 UI a první aplikace
modules:
  - app
  - ui
specs:
  - "[[11-ui]]"
depends_on:
  - "[[M04-persistence]]"
  - "[[M09-interakce]]"
started: 2026-10-13
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-13
---
# M10 – UI a první použitelná aplikace

**Cíl:** všechno se propojí. Spustitelná aplikace, ve které jde vytvořit kvádr, upravit ho v dialogu, vidět ve 3D, vrátit změny a po reloadu pokračovat.

**Specifikace:** [[11-ui|11 – plugin-api, app, ui]]

**Navazuje na:** [[M04-persistence]], [[M09-interakce]]

## Úkoly

Pořadí odspodu nahoru: nejdřív doména a porty, pak `app`, nakonec `ui`. Podrobný Implementační plán bude níže.

- [x] `document`: ostrá mez `exclusiveMin`/`exclusiveMax` ([[Q050 Ostrá dolní mez parametru|Q050]]), `label` jako klíč a `ParamIssue` s `code`/`params` ([[0014-preklady-vue-i18n-a-klice|ADR 0014]]); úprava `features/box` a `interaction`.
- [x] `plugin-api`: `messages` ve `FeaturePlugin`, slovník cs/en pro box.
- [x] `kernel-occt`: trap WASM je fatální → `'disconnected'` ([[Q055 Pád WASM jádra|Q055]]).
- [x] `render`: `ScenePalette`, `setPalette`, `setBodyVisible` ([[Q072 Barvy scény podle režimu|Q072]], [[Q071 Viditelnost těles|Q071]]).
- [x] `interaction`: `BrowserModel`, rozšíření `RegenSnapshot` o tělesa.
- [x] `app/createAppSession` – kompoziční kořen testovaný v Node: registrace pluginů a vestavěných handlerů, propojení událostí, `RegenScheduler` (dirty flag, žádná fronta), restart jádra, režim jen pro čtení.
- [x] Akce: undo, redo, smazat vybranou featuru, potlačit, fit all, aktivace nástrojů.
- [x] `app/openAppSession` – workery, `IdbDocumentStore`, Web Lock ([[Q038 Jeden dokument ve dvou záložkách|Q038]]), seznam dokumentů (nový, otevřít, smazat).
- [x] `ui/composables`: `useSession` (provide/inject), `useObservable` ([[0010-prezentacni-model|ADR 0010]]); `vue-i18n` se slovníky pluginů.
- [ ] Převod globální klávesnice z DOM na `ViewKeyEvent` pro `ActionRegistry`.
- [ ] Komponenty podle rozvržení v [[11-ui#Rozvržení]] (Fusion + macOS): `AppShell`, `TitleBar`, `Toolbar` se skupinami, `ViewportHost`, plovoucí `Browser` a `FeatureDialog` + `ParamField` registr, ukotvená `Timeline` (stavy, rollback značka tažením, dvojklik = edit, kontextové menu, stav regenerace), `DocumentList` (hash `#/d/<id>`, [[Q019 Úvodní obrazovka se seznamem dokumentů|Q019]]).
- [ ] Rozvržení a CSS proměnné: světlý a tmavý režim, průsvitné plovoucí panely, Tabler Icons.
- [ ] E2E smoke test v Playwright: nový dokument → Box → výška 30 → OK → undo → redo → reload → featura existuje.
- [ ] Ověřit tažením hodnoty, že regenerace bez rušení stačí ([[Q010 Zrušení probíhající operace jádra|Q010]]).

## Implementační plán

Každý úkol dělá zvlášť subagent `implementer` (TDD: test nejdřív a ověřit, že padá; `npm run check`). Kontrakty jsou ve specifikacích, odkazy u úkolů. Rozhodnutí: [[Q010 Zrušení probíhající operace jádra|Q010]], [[Q019 Úvodní obrazovka se seznamem dokumentů|Q019]], [[Q038 Jeden dokument ve dvou záložkách|Q038]], [[Q050 Ostrá dolní mez parametru|Q050]], [[Q055 Pád WASM jádra|Q055]], [[Q070 Překlady textů UI|Q070]]–[[Q072 Barvy scény podle režimu|Q072]], [[0014-preklady-vue-i18n-a-klice|ADR 0014]].

**Paralelní běh.** Úkoly jsou ve vlnách. Úkoly jedné vlny mají oddělené soubory a běží souběžně, každý implementátor ve vlastním git worktree. Hlavní sezení po vlně změny sloučí, spustí `npm run check` a zkontroluje je proti spec. Další vlna začíná až po sloučení předchozí. Soubor, který by chtěly měnit dva úkoly jedné vlny (typicky `index.ts`), smí měnit jen ten úkol, u kterého je uvedený.

| Vlna | Úkoly (paralelně) | Závisí na |
|---|---|---|
| A | Ú1 i18n v doméně · Ú2 trap jádra · Ú3 paleta a viditelnost v `render` · Ú4 `BrowserModel` | – |
| A2 | Ú1b strukturovaná chyba regenerace a klíče popisků · Ú3b dokončení palety | A |
| B | Ú5 `createAppSession` · Ú6 základ `ui` | A2 |
| C | Ú7 vestavěné akce · Ú8 `openAppSession` a dokumenty · Ú9 `Timeline` a `Browser` | B |
| D | Ú10 zbytek komponent a spuštění aplikace | C |
| E | Ú11 e2e test · Ú12 ověření a revize (hlavní sezení) | D |

### Vlna A

#### Ú1 i18n v doméně: klíče, kódy chyb, ostrá mez
- **Soubory:** `src/document/schema.ts`, `src/document/validate.ts` + testy, `src/document/testing.ts`; `src/features/box/schema.ts`, `src/features/box/messages.ts` (nový), `src/features/box/index.ts`, `box.test.ts`; `src/plugin-api/plugin.ts`, `register.test.ts`; `src/interaction/feature-editor.ts`, `feature-name.ts` + testy; `tests/feature-dialog.test.ts`. Ne `src/interaction/index.ts`, pokud není nutné exportovat nový typ.
- **Kontrakt:** [[03-dokument#Schéma featury]] – `Bounds` s `exclusiveMin`/`exclusiveMax`; `ParamIssue { param, code, params? }` místo `message`; kódy chyb z `validateAgainstSchema` podle seznamu ve spec (seznam doplnit do spec, pokud implementace potřebuje další). Všechny `label` jsou klíče: box `box.label`, `box.width`, `box.depth`, `box.height`, `box.origin`. Box: `min: 0, exclusiveMin: true` u rozměrů, vlastní pravidlo z `validate` zmizí. `FeaturePlugin.messages?: PluginMessages` s typem `PluginMessages = { readonly cs: Readonly<Record<string, string>>; readonly en: Readonly<Record<string, string>> }` (v `plugin-api`), box dodá slovník cs/en pro své klíče. `FieldState.issue: ParamIssue | null` (celý issue, ne text). `createFeatureEditor` dostane `translate?: (key: string) => string` (výchozí identita); název nové featury = `nextFeatureName(studio, translate(schema.label))`, popisek transakce zůstává klíč `schema.label`.
- **Testy:** `exclusiveMin` – hodnota rovná mezi je chyba `param.atOrBelowMin`, nad mezí v pořádku, bez `min` nemá účinek; obdobně `exclusiveMax`; každý dosavadní text chyby má kód; box výška 0 → `param.atOrBelowMin`, záporná → totéž; slovník boxu má v `cs` i `en` všechny klíče ze schématu (test výčtem přes `params` a `label`); `FeatureEditor` s `translate` pojmenuje `Kvádr 1`, bez něj `box.label 1`; `FieldState.issue` nese kód.
- **Hotovo když:** testy a `npm run check` projdou.

#### Ú2 Trap WASM je fatální
- **Soubory:** `src/kernel-occt/protocol.ts`, `worker-impl.ts`, `occt.worker.ts`, `index.ts`, `occt.ts` (jen `toKernelError`, pokud je potřeba) + testy.
- **Kontrakt:** [[06-geometricke-jadro#Chyby]] – `WebAssembly.RuntimeError` během volání je fatální: worker na volání odpoví chybou a pošle zprávu o pádu (nová notifikace v protokolu, např. `{ type: 'fatal', message }`); `index.ts` na ni zavolá `rpc.failAll('OCCT crashed: …')` a ukončí worker, takže čekající i další volání skončí `RpcError` `'disconnected'`. `WebAssembly.Exception` (výjimka OCCT) zůstává `'internal'` a jádro funguje dál.
- **Testy:** `worker-impl` s falešným jádrem, které vyhodí `WebAssembly.RuntimeError` → odpověď s chybou a notifikace o pádu; jiná výjimka → jen `'internal'` bez notifikace; klientská strana (s falešným workerem / `MessageChannel`, jak to dělají stávající testy) → po notifikaci `'disconnected'` pro čekající i nová volání.
- **Hotovo když:** testy a `npm run check` projdou.

#### Ú3 `render`: paleta a viditelnost těles
- **Soubory:** `src/render/palette.ts` (nový), `viewport.ts`, `body-view.ts`, `body-layer.ts`, `highlight-layer.ts`, `overlay-layer.ts`, `scene-helpers.ts`, `index.ts` + testy; `dev/viewport.ts` jen pokud používá `background`.
- **Kontrakt:** [[09-vykreslovani#Viewport]] – `ScenePalette`, `LIGHT_PALETTE`, `DARK_PALETTE`, `createViewport({ palette? })` místo `background`, `setPalette`, `setBodyVisible`. Barvy světlé palety jako dosavadní konstanty; tmavá podle mockupu ([[11-ui#Rozvržení]]): pozadí `0x1f2023`, plochy `0x3b6aa6`, hrany `0x9cc3f5`, výběr `0x0a84ff`, hover `0x5e9ff5`. `setPalette` mění barvy existujících materiálů (žádné nové materiály) a volá `requestRender()`. `setBodyVisible(body, false)` skryje `BodyView` a `pick` ho ignoruje; po `sync`, kde těleso chybí, se stav zapomene; neznámé těleso → nic.
- **Testy:** čisté funkce a vrstvy bez WebGL (jak stávající testy `render`): po `setPalette` mají materiály ploch, hran, zvýraznění a overlay barvy z palety a nevznikly nové instance; palety jsou zmrazené a úplné; skryté těleso `pick` přeskočí (nebo čistá funkce výběru zásahu, pokud pick testovat nejde); `sync` bez tělesa zapomene skrytí.
- **Hotovo když:** testy a `npm run check` projdou.

#### Ú4 `interaction`: `BrowserModel`
- **Soubory:** `src/interaction/regen-status-port.ts`, `browser-model.ts` (nový), `testing.ts`, `index.ts` + testy.
- **Kontrakt:** [[10-interakce]], sekce *Prohlížeč* – `RegenSnapshot.bodies`, `BrowserBodyRow`, `BrowserModel`, `createBrowserModel({ regen, selection })`. `name` je `{ key: 'browser.body', n }` místo hotového textu (překládá `ui`) – upřesnit ve spec. Pořadí řádků = pořadí v `bodies`. `FakeRegenStatus.publish(health, bodies?)`.
- **Testy:** řádky po `publish`; `selected` podle výběru (`{ kind: 'body' }`); `select` s `additive`; `setVisible(false)` → `hidden` obsahuje těleso a řádek `visible: false`, stejná hodnota nic nevyšle; těleso, které v další generaci chybí, vypadne z `hidden`; nezměněný řádek je týž objekt; `dispose` odhlásí.
- **Hotovo když:** testy a `npm run check` projdou.

### Vlna A2

Doplňky z revize vlny A (rozhodnutí 2026-10-13).

#### Ú1b Strukturovaná chyba regenerace a klíče popisků
- **Soubory:** `src/regen/state.ts`, `src/regen/regenerator.ts` + test; `src/interaction/regen-status-port.ts` (`FeatureHealth`, export `RegenBody`), `src/interaction/index.ts`, `src/interaction/feature-editor.ts` + test; `src/features/box/tool.ts`, `box.test.ts`.
- **Kontrakt:** [[07-regenerace]] – `FeatureError.issues` u `INVALID_PARAMS` (zmrazená kopie), `message` zůstává technický text. [[10-interakce#Port stavu regenerace]] – `FeatureHealth` `error` s volitelnými `issues`, export `RegenBody`. [[10-interakce]] – `FeatureEditor.edit` otevře transakci s popiskem `'feature.edit'`. `boxTool.label` = `'box.label'` (klíč, [[0014-preklady-vue-i18n-a-klice|ADR 0014]]).
- **Testy:** výška 0 → status `error` `INVALID_PARAMS` s `issues: [{ param: 'height', code: 'param.atOrBelowMin', params: { min: 0 } }]`, zmrazené; popisek záznamu v logu po editaci je `'feature.edit'`; `boxTool.label` je klíč, který má slovník boxu.
- **Hotovo když:** testy a `npm run check` projdou.

#### Ú3b Dokončení palety a skrytých těles
- **Soubory:** `src/render/palette.ts`, `scene-helpers.ts`, `highlight-layer.ts`, `camera-controller.ts` (nebo kde je `fitAll`), `viewport.ts` + testy.
- **Kontrakt:** [[09-vykreslovani#Viewport]] – `ScenePalette.grid`, osy v obou paletách `0xff3b30`, `0x34c759`, `0x0a84ff`; tmavá paleta `preview` `0x0a84ff`, `construction` `0x6b7280`, mřížka tmavé palety tlumená na pozadí `0x1f2023` (např. `0x3a3c42`/`0x2c2e33`). Zvýraznění skrytého tělesa se nekreslí, `fitAll` skrytá tělesa vynechá.
- **Testy:** `setPalette` přebarví mřížku; obě palety mají osy podle spec; hover/výběr na skrytém tělese nic nevykreslí a po zobrazení se zvýraznění vrátí; `fitAll` počítá rámeček bez skrytých těles (čistá funkce, pokud existuje).
- **Hotovo když:** testy a `npm run check` projdou.

### Vlna B

#### Ú5 `app`: `createAppSession`
- **Soubory:** `src/app/session.ts`, `regen-scheduler.ts`, `regen-status-adapter.ts`, `kernel-supervisor.ts` (nové), `src/app/index.ts`, `src/app/testing.ts` + testy; `.dependency-cruiser.cjs` jen pokud `app` potřebuje nové povolení.
- **Kontrakt:** [[11-ui#Kompoziční kořen (app)]] bez akcí (Ú7) a bez prohlížečové části (Ú8). `AppSessionDeps`: `plugins`, `store: DocumentStore`, `docId`, `createKernel: () => Promise<GeometryKernel & Disposable>`, `viewport: AppViewport` (= `ViewportPort` + `mount`, `bodies`, `camera`, `setPalette`, `setBodyVisible`; v Node fake), `scheduler: Scheduler`, `now`, `ids`, `translate`, `readOnly: boolean`. Viewport dostane `MeshOps`, které deleguje na *aktuální* jádro (restart). `RegenScheduler`: `request()`; během běhu jen `dirty`, po doběhnutí jeden další běh; výsledek `'superseded'` se ignoruje. Adaptér `RegenStatusPort` z `RegenResult` (`health` z `statuses`, `bodies` z `finalState`, `generation` +1). Restart: `RpcError 'disconnected'` z regenerace → zahodit jádro i Regenerator, `kernel` = `restarting`, nové jádro + nový Regenerator, regenerace; druhý pád do 10 s (podle `now`) → `failed`. `readOnly` → bez `PersistenceService`, dispečer pro UI zablokovaný (featury, akce a nástroje měnící dokument hodí / jsou `enabled: false`).
- **Testy (Node, `FakeKernel`, `MemoryDocumentStore`, fake viewport, ruční scheduler):** otevření prázdného i uloženého dokumentu; `features.create('box')` → `setParam` → commit → regenerace → `viewport.bodies.sync` s jedním tělesem a `regen` stav `bodyCount: 1`; 10 rychlých změn = nejvýš 2 běhy regenerace; chybný parametr (výška 0) → `errorCount: 1`, ostatní tělesa zůstanou; uložení do store po flush; pád jádra → `restarting` → `ready` a znovu tělesa; dva pády do 10 s → `failed`; `readOnly` → žádný zápis do store a změna dokumentu selže; `setTheme('dark')` → `viewport.setPalette(DARK_PALETTE)`; `browser.setVisible` → `viewport.setBodyVisible`; `dispose` uvolní jádro, službu i modely.
- **Hotovo když:** testy a `npm run check` projdou.

#### Ú6 Základ `ui`: composables, i18n, téma, `ParamField`
- **Soubory:** `package.json` (`vue-i18n`, `@tabler/icons-webfont`), `.dependency-cruiser.cjs` (npm balíky `ui`), `src/ui/composables/use-observable.ts`, `use-session.ts`, `src/ui/i18n/` (instance, slovníky `cs.ts`, `en.ts` vestavěných textů, `issueText(issue)`), `src/ui/theme/` (`tokens.css` s proměnnými světlého a tmavého režimu, `use-theme.ts`), `src/ui/keyboard.ts` (DOM `KeyboardEvent` → `ViewKeyEvent`, `inTextField`), `src/ui/components/params/` (`LengthField`, `AngleField`, `NumberField`, `BoolField`, `EnumField`, `PointField`, `RefListField`, `registry.ts`) + testy.
- **Kontrakt:** [[11-ui#Pravidla]], [[11-ui#Styl]], [[0014-preklady-vue-i18n-a-klice|ADR 0014]]. `useObservable` podle spec. `useSession` přes `provide/inject`, bez session vyhodí. i18n: `createUiI18n(pluginMessages)` sloučí vestavěné a pluginové slovníky, jazyk z `localStorage` (`tinycad.locale`) jinak z `navigator.language`. Téma: `data-theme` na `<html>`, výchozí podle `prefers-color-scheme`, volba v `localStorage` (`tinycad.theme`). Registr `kind → komponenta` pro všechny `ParamSpec.kind` kromě `region`. Pole bere `FieldState`, zobrazí přeložený label, hodnotu a chybu (`issueText`), změnu hlásí událostí `update` (komponenta sama nic nemění).
- **Testy (Node, bez DOM, kde to jde):** `useObservable` v `effectScope` – počáteční hodnota, změna, po `scope.stop()` odhlášeno; registr pokrývá všechny druhy kromě `region` (výčet z typu); `keyboard.ts` – převod modifikátorů, `Mod` podle platformy, textové pole; i18n – vestavěné klíče mají `cs` i `en`, `issueText` přeloží kód s parametry.
- **Hotovo když:** testy a `npm run check` projdou.

### Vlna C

#### Ú7 Vestavěné akce
- **Soubory:** `src/app/actions.ts` + test, `src/app/session.ts` (jen zapojení).
- **Kontrakt:** [[10-interakce#Akce a klávesové zkratky]]: `undo` (`Mod+Z`), `redo` (`Mod+Shift+Z`), `feature.delete` (`Delete`/`Backspace`, vybraná featura), `feature.suppress` (`S`, přepne), `view.fitAll` (`F`), aktivace nástrojů podle `ToolDescriptor.shortcut`, `timeline.stepBack`/`stepForward`/`toStart`/`toEnd` (posun baru), jednorázové `camera.fitAll()` po první regeneraci s tělesy ([[11-ui#Kompoziční kořen (app)]]). `UndoManager` už `createAppSession` vytváří, jen ho zapoj. `enabled` jako `Observable` (undo/redo podle `UndoManager`, mazání a potlačení podle výběru, vše `false` v `readOnly` nebo při otevřené session). Popisky akcí jsou klíče.
- **Testy:** každá akce v `createAppSession` s fake závislostmi: undo/redo vrátí dokument, delete smaže vybranou featuru, suppress přepne, kroky timeline posunou bar a na krajích jsou zakázané, `enabled` reaguje na výběr a session.
- **Hotovo když:** testy a `npm run check` projdou.

#### Ú8 `openAppSession` a dokumenty
- **Soubory:** `src/app/browser.ts` (nový), `src/app/documents.ts` (nový), `src/app/index.ts` + test toho, co jde v Node.
- **Kontrakt:** [[11-ui#Kompoziční kořen (app)]], [[05-persistence#Jeden zapisovatel na dokument]]. `openAppSession({ docId, plugins, translate })`: `createOcctKernel`, `createIdbDocumentStore`, `createViewport` (s `palette` podle tématu a zástupnými `MeshOps`), Web Lock (`navigator.locks.request(…, { ifAvailable: true })`, zámek drží promise až do `dispose`), pak `createAppSession` s `verify: import.meta.env.DEV`; `dispose` uvolní session, viewport, store, jádro a zámek. `listDocuments`, `createNewDocument`, `deleteDocument` nad `DocumentStore` (`documents.ts` bere store jako parametr, takže je testovatelný s `MemoryDocumentStore`).
- **Testy:** `documents.ts` s `MemoryDocumentStore` (nový dokument má jméno a je v seznamu, smazání); funkce zámku s falešným `LockManager` (dostane / nedostane zámek → `readOnly`, `dispose` zámek uvolní).
- **Hotovo když:** testy a `npm run check` projdou.

#### Ú9 Komponenty `Timeline` a `Browser`
- **Soubory:** `src/ui/components/Timeline.vue`, `TimelineItem.vue`, `Browser.vue`, `ContextMenu.vue` (sdílené menu z `ActionState[]`).
- **Kontrakt:** [[11-ui#Komponenty]], vzhled podle mockupu `ui-m10-mockup.html`. Komponenty dostanou modely přes `useSession()` a čtou je jen přes `useObservable`; žádná logika kromě vazeb (pravidlo 4). Tažení rollback značky volá `featureTree.moveRollbackBar` až při puštění.
- **Testy:** žádné jednotkové (pokryje e2e Ú11), jen `npm run check` (typecheck šablon přes `vue-tsc`).
- **Hotovo když:** `npm run check` projde a komponenty jsou v `npm run dev` vidět na dočasné stránce nebo v `AppShell`, pokud už existuje.

### Vlna D

#### Ú10 Zbytek komponent a spuštění aplikace
- **Soubory:** `src/ui/App.vue`, `src/ui/components/AppShell.vue`, `TitleBar.vue`, `Toolbar.vue`, `ViewportHost.vue`, `FeatureDialog.vue`, `DocumentList.vue`, `src/main.ts`; odstranění dočasných stránek `dev/occt.*`, `dev/viewport.*`, `src/ui/occt.*`, `src/ui/viewport.*` (zůstanou v historii gitu; potvrdit s Pavlem před smazáním); `vite.config.ts`, pokud build potřebuje úpravu.
- **Kontrakt:** [[11-ui#Rozvržení]], [[11-ui#Komponenty]], [[11-ui#Styl]]. Hash `#/d/<id>` (prázdný → `DocumentList`), změna hashe = `dispose` staré session a otevření nové. `ViewportHost` jako sourozenec plovoucích panelů. Klávesnice z `window` přes `keyboard.ts` do `actions.handleKey`. Režim jen pro čtení ukáže hlášku. Stav jádra `restarting`/`failed` ukáže hlášku v `TitleBar`.
- **Testy:** `npm run build` vydá worker jádra a WASM jako samostatné assety (kontrola výpisu `dist/assets`).
- **Hotovo když:** `npm run check` a `npm run build` projdou a aplikace v `npm run dev` projde ručně cestu nový dokument → kvádr → OK → undo.

### Vlna E

#### Ú11 E2E smoke test
- **Soubory:** `package.json` (`@playwright/test`, skript `test:e2e`), `playwright.config.ts`, `e2e/smoke.spec.ts`.
- **Kontrakt:** akceptační kritéria níže. Test proti `vite preview` (produkční build).
- **Testy:** nový dokument → Kvádr → výška 30 → OK → undo → redo → reload → featura existuje a těleso je vykreslené (počet těles ve stavu); výška 0 → featura v Timeline s chybou, ostatní těleso zůstane; druhá záložka se stejným dokumentem → jen pro čtení.
- **Hotovo když:** `npm run test:e2e` projde.

#### Ú12 Ověření a revize (hlavní sezení)
Projít akceptační kritéria, ověřit [[Q010 Zrušení probíhající operace jádra|Q010]] rychlou změnou hodnoty v prohlížeči, spustit `architecture-reviewer`, propsat odchylky do specifikací.

## Akceptační kritéria

- Celá cesta *klik → operace → log → regenerace ve workeru → vykreslení → undo* funguje v prohlížeči.
- Po reloadu stránky je dokument i undo historie zpět.
- Chybný parametr (výška 0) → featura červená ve stromu, zbytek modelu v pořádku.
- `ui` neimportuje nic kromě `app`, `core` a typů z `document`/`interaction`.
- `npm run build` vydá worker jádra a WASM OCCT jako samostatné assety; dočasná `dev/occt.html` z [[M07-kernel-occt|M7]] je odstraněná nebo archivovaná.

## Co se naučíš

Vue 3 Composition API, propojení externího stavu s reaktivitou Vue (`shallowRef`, `markRaw`), kompoziční kořen bez DI frameworku.

## Retrospektiva

_(vyplnit po dokončení)_
