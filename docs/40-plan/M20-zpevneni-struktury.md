---
type: milestone
status: done
order: 20
aliases:
  - M20
  - M20 Zpevnění struktury
modules:
  - core
  - document
  - regen
  - plugin-api
  - interaction
  - render
  - app
  - ui
  - features
specs:
  - "[[01-architektura]]"
  - "[[03-dokument]]"
  - "[[07-regenerace]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
  - "[[12-skicar]]"
depends_on:
  - "[[M19.2-ux-backlog]]"
started: 2026-10-14
finished: 2026-10-14
tags:
  - milnik
created: 2026-10-14
updated: 2026-10-15
---
# M20 – Zpevnění struktury

**Cíl:** splatit strukturální dluh z [[Revize kódu 2026-10-14|revize kódu]] (A2–A6, A8, A9) dřív, než přibudou další druhy referencí, featury a nástroje skicáře.

**Specifikace:** [[01-architektura]], [[03-dokument]], [[07-regenerace]], [[10-interakce]], [[11-ui]], [[12-skicar]]

**Navazuje na:** [[M19.2-ux-backlog|M19.2]]. Po něm následuje [[M21-vstupni-stav-editovane-featury|M21]] (A1, [[Q075 Vstupní stav editované featury|Q075]]).

## Rozsah

Pavel 2026-10-14 nad prezentací „body k diskuzi po revizi“:

- **Zpevnění struktury jde před A1.** Vstupní stav editované featury ([[Q075 Vstupní stav editované featury|Q075]]) se bude stavět na čistší kostře, hlavně na tabulce druhů referencí (A2).
- **V rozsahu:** A5, A6, A2, A3, A4 (v tomto pořadí), k tomu A8 (`evaluateParams` ještě před proměnnými) a A9 (úklid specifikací, kterých se milník dotkne).
- **Mimo rozsah:** A1 ([[M21-vstupni-stav-editovane-featury|M21]]), A7 (vlastní build OCCT kvůli zásobníku Emscriptenu, [[M16-vlastni-occt-build|M16]] se vrací do plánu).

Proč tohle pořadí: od nejlevnějšího a nejméně vratného. Zúžit rozhraní pro pluginy (A5) jde jen do doby, než ho plugin začne používat. Typové kontrakty (A6) se už jednou rozbily. Tabulka druhů referencí (A2) musí být hotová před vrcholy, vzory a A1. Rozdělení session (A3) a vyčlenění skicáře (A4) jsou přesuny kódu, které jde udělat kdykoli, a proto jsou poslední.

## Úkoly

- [x] Ú0 Testy mimo zdrojáky ([[0023-testy-mimo-zdrojaky|ADR 0023]]): přesun `*.test.ts`, `tests/` a `e2e/` do `test/`, pravidla hranic, tsconfigy, Vitest, Playwright, ESLint, spec a CLAUDE.md
- [x] A5 Úzká rozhraní: `ToolContext` bez celého `ViewportPort`, jména parametrů skici v modulu `sketch`, úzké závislosti `ToolManager`, `Regenerator`, `SketchEditor`, `emitter.asSubscribable()`
- [x] A6 Kontrakty v typech: `FeaturePlugin<P, A>` s typem kotev, poslední známé kotvy v controlleru, `ParamSchema` svázané s `P`, rozměry glyfů a prahy jako jediný zdroj v `interaction/constants.ts`, sdílený invariant prahů skrytí a tahu
- [x] A8 `evaluateParams(schema, params, variables)` v `document`, jediná cesta ke čtení parametrů (Regenerator, `FeatureEditor`, `visibleWhen`, manipulátory)
- [x] A2 `RefKindBehavior`: jedna tabulka chování podle druhu reference v `interaction`, obdobná v `document` pro validaci a `referencesOf`
- [x] A3 Rozdělení `app/session.ts` (`viewport-mirror`, `regen-pipeline`, `open-document`, `read-only`), port `ViewSettings`, `ToolbarModel`, `DocumentListModel`, zámek editace z `Timeline.vue` do modelu
- [x] A4 Modul `src/sketcher` (prstenec 2, závisí na `interaction`), `ToolManager` s obecnými vrstvami vstupu, podsložky manipulátorů a dialogu
- [x] A9 Specifikace jako kontrakt: dotčené sekce [[01-architektura]], [[10-interakce]], [[11-ui]] a [[07-regenerace]] přepsat na aktuální stav, historie zůstává v deníku a ADR
- [x] Ověření, `architecture-reviewer`, uzavření

## Rozhodnutí (Pavel 2026-10-14)

- **D1 – Testy mimo zdrojáky** ([[0023-testy-mimo-zdrojaky|ADR 0023]]): unit testy v `test/unit/<modul>/` se zrcadlovou strukturou, integrační v `test/integration/`, e2e v `test/e2e/`. `testing.ts` zůstává v modulu. Je to první úkol (Ú0), aby ostatní úkoly počítaly s novými cestami.
- **D2 – Modul `sketcher`** ([[0024-modul-sketcher|ADR 0024]]): prstenec 2, závisí na `interaction`, ne naopak.
- **D3 – Typované kotvy** jako dodatek k [[0021-manipulatory-kotvy-z-regenerace|ADR 0021]]: `FeaturePlugin<P, A>`, controller drží poslední známé kotvy.
- **D4 – `evaluateParams` bez proměnných** vrací parametry beze změny, ale pod vlastním typem „vyhodnocené parametry“. Typecheck tak najde každého, kdo čte parametry jinou cestou. Až přijde [[Q003 Proměnné a výrazy v parametrech|Q003]], změní se jen tělo funkce.
- **D5 – Dvě tabulky druhů referencí:** v `document` validace a `referencesOf` (čistá data), v `interaction` picking, zvýraznění a Prohlížeč. Obě jako `satisfies Record<RefKind, …>`, takže chybějící druh je chyba typu.
- **D6 – Konstanty pro `ui`** (`actionIds`, `toolModes`…) přes nový vstupní bod `interaction`, který vystavuje jen data. Žádná výjimka v pravidlech závislostí.
- **D7 – `ViewSettings` jako port v `app`** (Claude při kontrole A3, Pavel schválil 2026-10-15): rozhraní nastavení pohledu (`setTheme`, `setViewCubeLabels`, `setOrbitMode`, `onOrbitModeToggle`) definuje `app` jako port spotřebitele ([[0011-programovani-proti-rozhranim|ADR 0011]]) a implementuje ho malá továrna v `app` nad `Viewport` a `defaultBodyColor`. `Viewport` ho jmenovitě neimplementuje. Proč: paletu podle tématu vybírá `app` ([[Q072 Barvy scény podle režimu|Q072]]). Kdyby `Viewport` uměl `setTheme`, znalost tématu by se přesunula do `render` a session by `setTheme` stejně musela obalit kvůli `defaultBodyColor`.

## Implementační plán

_(Jeden úkol = jedno spuštění subagenta `implementer`. Úkoly A5 a dál doplní hlavní sezení po dotažení kontraktů.)_

### Společná pravidla

- Kód, komentáře a commity anglicky. TypeScript `strict`, žádné `any`, neměnná data, TDD, `npm run check` zelený.
- Od Ú0 platí [[0023-testy-mimo-zdrojaky|ADR 0023]]: nový test patří do `test/unit/<modul>/` na zrcadlové místo ke zdrojovému souboru a importuje přes `@/`.

### Ú0 Testy mimo zdrojáky

Mechanický přesun bez změny chování. Počet testů musí sedět před i po (dnes 5062 unit + 35 integračních, e2e 70).

- **Soubory:**
  - každý `src/**/*.test.ts` → `test/unit/**/*.test.ts` se stejnou relativní cestou (`git mv`, ať zůstane historie); relativní importy přepsat na `@/…`, importy jiných testů a pomocných souborů relativně v rámci `test/`;
  - `tests/` → `test/integration/`, `e2e/` → `test/e2e/` (`playwright.config.ts` `testDir`, výstupy Playwrightu se nemění);
  - `vitest.config.ts` (projekty `unit` a `integration`), `package.json` (`lint:deps` nad `src test`), `tsconfig.test.json`, `tsconfig.test-idb.json`, `tsconfig.test-app.json`, `tsconfig.domain.json`, `tsconfig.app.json` (výjimky pro testy v `src` už nejsou potřeba), případně `tsconfig.node.json` kvůli `test/e2e`;
  - `.dependency-cruiser.cjs`: testovací kód modulu `<modul>` je `^test/unit/<modul>/` (pro `features/*` `^test/unit/features/([^/]+)/` se stejným `$1` jako dnes, pro `persistence` bez `idb/`, `persistence/idb` zvlášť); `testCodeOf`, `TEST_FILES` a pravidlo `testing-only-in-tests` podle toho; integrační a e2e testy smí to co dnes `tests/`;
  - `eslint.config.js` (výjimka `src/**/*.test.ts` v pravidle platformních globálů → `test/**`), `scripts/code-format.mjs` (hook formátuje i `test/**/*.{ts,vue}`), `.claude/agents/implementer.md` (příklad cesty `npx vitest run --project unit test/unit/…`).
- **Kontrakt:** [[0023-testy-mimo-zdrojaky|ADR 0023]]. `testing.ts` zůstává v `src/<modul>/`. Produkční kód nesmí importovat nic z `test/`.
- **Testy:** žádné nové testy chování. Ověření hranic: dočasně přidat do testu jednoho modulu hluboký import do cizího modulu a do produkčního souboru import `testing.ts`; `npm run lint:deps` musí obojí odmítnout stejným pravidlem jako před přesunem. Pak dočasné importy odebrat.
- **Hotovo když:** `find src -name '*.test.ts'` nic nenajde, `tests/` a `e2e/` neexistují, `npm run check` je zelený se stejným počtem testů jako před přesunem a `npm run test:e2e` projde (70 testů).
- **Mimo úkol:** spec [[01-architektura]] a CLAUDE.md upraví hlavní sezení.

### A5 Úzká rozhraní

Podle [[0011-programovani-proti-rozhranim|ADR 0011]]: spotřebitel dostane jen to, co používá. Chování se nemění. Úzké typy se pojmenují podle role, ne `Pick<>` přímo v signatuře veřejného API.

- **A5.1 `ToolContext`** (`interaction/tools.ts`), bod rozšíření pro pluginy:
  - `viewport: ToolViewport`, kde `ToolViewport` = `pick`, `screenToRay`, `overlay` a `highlight` jen s `setHover`. Bez `manipulators`, `sketches`, `project`, `events` a `highlight.setSelection` (to vlastní `bindSelectionHighlight`).
  - `ops` z kontextu zmizí. Žádný nástroj ho nevolá a operace jdou přes `FeatureEditor` ([[Q069 Smí nástroj otevřít vlastní transakci|Q069]]). Přidat ho později jde zpětně kompatibilně, odebrat ne.
  - `features` jen se členy, které nástroje volají (dnes `create`, `current`), jako typ `ToolFeatures`. `selection`, `doc`, `ids` zůstávají, případně zúžené stejným pravidlem.
  - `ToolManager` dostane události viewportu vlastní závislostí (`viewportEvents: Subscribable<ViewportEvents>`), ne přes `ctx.viewport.events`. `refPick` a `topo-inspector` dostanou úzký typ podle toho, co volají.
- **A5.2 Jména parametrů skici:** modul `sketch` exportuje `SKETCH_PARAM = { plane: 'plane', entities: 'entities', constraints: 'constraints' } as const`. `SketchParams` zůstává v `features/sketch`, protože `PlaneRef` a `TopoRef` jsou z `document` a `sketch` smí jen `core` ([[0017-modul-sketch-a-skicar|ADR 0017]]). Schéma pluginu ověří typem, že klíče `SketchParams` jsou přesně hodnoty `SKETCH_PARAM` (`satisfies`). `interaction` (`sketch-editor.ts`, `sketch-session.ts`, `ref-values.ts`) používá jen `SKETCH_PARAM`, žádný řetězec.
- **A5.3 Úzké závislosti:**
  - `createToolManager`: `manipulators` jako `Pick` s `onPointer` a `onKey` (A4 ho pak nahradí obecnými vrstvami vstupu);
  - `Regenerator`: `kernel: ModelingKernel & Pick<GeometryKernel, 'release'>` plus to, co regenerace volá navíc (diagnostika chyb jádra), nic dalšího;
  - `SketchEditor`: `features` jen s tím, co volá (`create`, `edit`).
- **A5.4 `Emitter.asSubscribable()`** v `core`: vrátí zmrazený objekt jen s `on` (a `once`, pokud ho `Subscribable` má). Nahradí pět ručních kopií (`cad-document`, `persistence/service`, `ops/log`, `ops/undo`, `ops/dispatcher`). `Regenerator.events` vrací `emitter.asSubscribable()`, ne samotný emitter.
- **Soubory:** `core/emitter.ts`, `sketch/model.ts` a `index.ts`, `features/sketch/schema.ts`, `interaction/{tools,tool-manager,ref-pick-tool,topo-inspector,select-tool,sketch-editor,sketch-session,ref-values}.ts`, `interaction/sketch-tools/*`, `regen/regenerator.ts`, místa s pěti kopiemi, `app` (sestavení), `features/*/tool*.ts`, odpovídající testy v `test/unit/`.
- **Testy:**
  - `asSubscribable`: odběr přes pohled dostane události, pohled nemá `emit` (ani za běhu), je zmrazený;
  - typové testy (`expectTypeOf`): `ToolContext['viewport']` nemá `manipulators` ani `events`, `ToolContext` nemá `ops`, `Regenerator['events']` nemá `emit`;
  - `SKETCH_PARAM`: hodnoty odpovídají klíčům schématu skici (test i typ);
  - stávající testy nástrojů, skicáře a regenerace projdou jen s úpravou sestavení kontextu.
- **Hotovo když:** testy výše projdou, `grep` v `interaction` nenajde řetězce `'plane'`, `'entities'` a `'constraints'` jako jména parametrů a `npm run check` je zelený.
- **Spec:** [[10-interakce]] (sekce Nástroje, `ToolContext`), [[07-regenerace]] (závislosti `Regenerator`), [[12-skicar]] (jména parametrů). Upraví hlavní sezení.

### A6 Kontrakty v typech

Kontrakt z komentáře převést do typu, nebo aspoň do jediné sdílené hodnoty s testem ([[Implicitní kontrakty první implementace]]). Dodatek k [[0021-manipulatory-kotvy-z-regenerace|ADR 0021]].

- **A6.1 Typované kotvy:**
  - `FeaturePlugin<P, A extends FeatureAnchors = FeatureAnchors>`, `FeatureBuilder<P, A>`, `ManipulatorDescriptor<P, A>`. Builder i deskriptor jednoho pluginu sdílí `A`, takže překlep ve jménu kotvy je chyba typu.
  - `BuildOutput.anchors` je **povinné** (`A`, featura bez manipulátoru vrací `{}`). Zmizí podmínka „builder featury s manipulátorem musí vrátit aspoň `{}`“ a s ní třída chyb, kterou opravoval pivot Transformace.
  - Transformace a Extrude dostanou vlastní typ kotev (`TransformAnchors`, `ExtrudeAnchors`) a nepovinné kotvy jsou v typu nepovinné (`pivot?`).
  - Strukturální kopie typu kotvy v `interaction` zůstává ([[10-interakce#Port stavu regenerace]]), propojení dělá `plugin-api`.
- **A6.2 Poslední známé kotvy:** `ManipulatorController` si pro otevřenou session pamatuje poslední kotvy, které snapshot pro editovanou featuru nesl. Když snapshot kotvy nemá (featura v chybě po tahu), úchyty se kreslí z posledních známých a tahem jde chybu vrátit. Paměť se maže se zavřením session nebo změnou editované featury. Nová featura bez první úspěšné regenerace úchyty nemá (jako dnes).
- **A6.3 `ParamSchema` svázané s `P`:** `FeatureSchema<P>.params: ParamSchemaOf<P>`, kde `ParamSchemaOf<P> = { readonly [K in keyof P]-?: ParamSpec }`. Netypované `ParamSchema` zůstává pro registry a čtení bez znalosti pluginu.
- **A6.4 Rozměry glyfů a prahy jako jediný zdroj:** hodnoty patří modulu `interaction`, který o manipulátorech rozhoduje, a jsou ve vstupním bodě jen s daty (D6):
  - `MANIPULATOR_GLYPHS` (délka šipky, poloměr oblouku, velikost čtverce v px), dnes v `render/manipulator-pick.ts` a opsané v `ui/manipulator-hud.ts`;
  - `HANDLE_VISIBILITY` (prahy skrytí glyfů, dnes v `render`) vedle prahů tahu (`PARALLEL_LIMIT`, `EDGE_ON_LIMIT` v `manipulator-drag.ts`).
  - `render` smí z `interaction` jen typy, proto hodnoty dostane od `app` při vytvoření viewportu. `ui` je importuje ze vstupního bodu s daty. Pravidla závislostí se kvůli tomu nemění.
  - Test v `interaction`: každý práh skrytí je přísnější než odpovídající práh tahu (glyf zmizí dřív, než ho nejde táhnout).
- **Soubory:** `plugin-api/plugin.ts`, `regen/builder.ts` a `regenerator.ts`, `interaction/manipulators.ts`, `manipulator-controller.ts`, `manipulator-drag.ts`, nový vstupní bod s daty (společně s A3, viz D6), `document/schema.ts`, `features/*/{schema,builder,manipulators}.ts`, `render/manipulator-pick.ts` a vytvoření viewportu, `app` (předání hodnot), `ui/manipulator-hud.ts`, testy v `test/unit/`.
- **Testy:**
  - typové: deskriptor s kotvou, kterou builder nevrací, neprojde; schéma s klíčem navíc nebo chybějícím neprojde;
  - controller: po tahu, který featuru shodí, zůstanou úchyty a tah zpět featuru opraví; po zavření session se paměť smaže;
  - `regen`: featura bez manipulátoru vrací `{}`, cache kotvy přenáší (stávající testy);
  - práh skrytí × práh tahu (viz výše); HUD počítá odsazení z `MANIPULATOR_GLYPHS`.
- **Hotovo když:** testy projdou, v `ui` ani `render` nejsou opsané rozměry glyfů ani prahy a `npm run check` je zelený.
- **Spec:** [[07-regenerace]] (kotvy), [[10-interakce]] (manipulátory), [[09-vykreslovani]] (glyfy), [[11-ui]] (plugin, HUD), [[03-dokument]] (schéma).

### A8 `evaluateParams`

Jediná cesta od surových parametrů featury k hodnotám, se kterými se počítá ([[Parse, don't validate]]). Dnes bez proměnných, ale každý čtenář už jde přes ni, takže [[Q003 Proměnné a výrazy v parametrech|Q003]] později změní jen tělo funkce (D4).

- **Kontrakt (`document`):**
  - `type Evaluated<P> = P & { readonly [evaluatedBrand]: true }`, kde `evaluatedBrand` je `declare const … : unique symbol` (jen v typech, za běhu nic).
  - `evaluateParams<P>(schema: FeatureSchema<P>, params: unknown, variables: ParamVariables): { readonly params: Evaluated<P> | null; readonly issues: readonly ParamIssue[] }`. Spojuje vyhodnocení a `schema.validate`: `params` je `null` právě tehdy, když `issues` není prázdné.
  - `ParamVariables = ReadonlyMap<string, number>`, zatím vždy `NO_VARIABLES` (prázdná a zmrazená).
  - Výraz zůstává v datech featury; vyhodnocené hodnoty se nikam neukládají.
- **Čtenáři:**
  - `Regenerator` volá `evaluateParams` místo `schema.validate`. `BuildInput<P>` nese `params: Evaluated<P>` a `feature` **bez** `params` (jen id, typ a metadata), aby builder neměl jak číst surové hodnoty. Všechny buildery v `features/*` čtou `input.params`.
  - `FeatureEditor` bere issues a stav polí z `evaluateParams`. Zapisuje dál surové hodnoty.
  - ~~`isParamVisible(spec, params)` dostává `Evaluated<unknown>`~~ Upřesněno při implementaci: signatura zůstává nad hodnotami, protože se volá i uvnitř validace. Editor jí předává vyhodnocené parametry, a když neprojdou, surové; s výrazy to rozhodne Q003.
  - `ManipulatorDescriptor.frame` a výpočet úchytů dostávají `Evaluated<P>`. Co udělá tah s parametrem, který obsahuje výraz, rozhodne Q003 (zapsat do otázky).
- **Soubory:** `document/schema.ts` a nový `document/evaluate.ts`, `document/index.ts`, `regen/builder.ts` a `regenerator.ts`, `features/*/builder.ts`, `interaction/feature-editor.ts`, `manipulators.ts`, `manipulator-controller.ts`, testy v `test/unit/`.
- **Testy:**
  - `evaluateParams`: platné parametry → `params` se stejnými hodnotami a `issues: []`; neplatné → `params: null` a issues shodné se `schema.validate`;
  - typové: `Evaluated<P>` jde použít jako `P`, `P` jako `Evaluated<P>` ne; `BuildInput` nemá `feature.params`;
  - stávající testy builderů, editoru a manipulátorů projdou jen s úpravou sestavení vstupu.
- **Hotovo když:** mimo `document/evaluate.ts` nikdo nevolá `schema.validate` na parametry featury (kromě registru schémat a načítání dokumentu) a `npm run check` je zelený.
- **Spec:** [[03-dokument]] (schéma, vyhodnocení), [[07-regenerace]] (`BuildInput`), [[10-interakce]] (editor, manipulátory). Do [[Q003 Proměnné a výrazy v parametrech|Q003]] doplnit dvě otevřené věci: viditelnost při chybě a tah nad výrazem.

### A2 Tabulky druhů referencí

Chování podle druhu referenčního parametru je dnes rozepsané v paralelních `switch` (`document/references.ts`, `refs.ts`, `validate.ts`, `interaction/ref-pick-tool.ts`, `selection.ts`, `feature-editor.ts` s `REF_KINDS`, `browser-model.ts`, `ref-values.ts`, `ui/components/Browser.vue`). Cíl: nový druh = jeden záznam v každé ze dvou tabulek a TypeScript nahlásí, který chybí (D5).

- **Typ druhu:** `RefParamKind` = druhy `ParamSpec`, které nesou reference (`bodies`, `topo`, `region`, `planes`, `axis`), odvozené z `ParamSpec` (`Extract<…>`), ne vypsané ručně.
- **Tabulka v `document`** (`document/ref-kinds.ts`, čistá data a funkce):
  - `REF_PARAM_KINDS = { … } satisfies { readonly [K in RefParamKind]: RefParamKindRules }`;
  - `RefParamKindRules`: `refKinds` (které `EntityRef` parametr nese), `items(value)` (položky reference v hodnotě) a pravidla validace, která dnes leží ve `validate.ts`;
  - `refKindsOf`, `referencesOf` a validace referenčních parametrů z ní jen čtou.
- **Tabulka v `interaction`** (`interaction/ref-kinds.ts`):
  - `REF_KIND_BEHAVIOR = { … } satisfies { readonly [K in RefParamKind]: RefKindBehavior }`;
  - `RefKindBehavior`: `pickFilter` (dnes `pickFilterFor`), `fromHit(hit, value, ctx)` → nová hodnota nebo `null` (dnes `switch` v `createRefPick` nad `toggle*Ref`), `highlightTargets(value, snapshot)` (dnes `paramTargetsOf`), `browserAccepts(row)` (dnes v `BrowserModel` a `Browser.vue`), `focusable` (dnes `REF_KINDS` ve `FeatureEditor`) a texty čipů;
  - `refPick`, `bindSelectionHighlight`, `FeatureEditor` a `BrowserModel` z ní jen čtou. `Browser.vue` dostane rozhodnutí hotové z `BrowserModel`.
- **Chování se nemění.** Dnešní nesoulady se do tabulky zapíšou výslovně a s komentářem: `planes` je `focusable`, ale `pickFilter` je prázdný a Prohlížeč ho nebere; Prohlížeč nebere `topo`. Jestli je opravit, je UX otázka mimo M20 (založí hlavní sezení).
- **Soubory:** nové `document/ref-kinds.ts` a `interaction/ref-kinds.ts`, dále `document/{references,refs,validate,index}.ts`, `interaction/{ref-pick-tool,selection,feature-editor,browser-model,ref-values,index}.ts`, `ui/components/Browser.vue`, testy v `test/unit/`.
- **Testy:**
  - typový: tabulka bez jednoho druhu neprojde (`@ts-expect-error`);
  - ~~tabulka pokrývá všechny `RefParamKind` i za běhu~~ Upřesněno při kontrole: test za běhu by opisoval seznam pluginů a hodnotových druhů a nehlídal nic navíc oproti `satisfies`, proto vypuštěn;
  - po druzích: `pickFilter`, `fromHit` (přidání a odebrání), `highlightTargets`, `browserAccepts` se shodují s dnešním chováním (stávající testy přesunout na tabulku);
  - stávající testy `refPick`, `selection`, `FeatureEditor`, `BrowserModel` projdou.
- **Hotovo když:** v uvedených souborech nezbyde `switch` ani `Set` podle druhu referenčního parametru mimo obě tabulky a `npm run check` je zelený.
- **Spec:** [[03-dokument]] (reference), [[10-interakce]] (picking referencí, zvýraznění, Prohlížeč).

### A3 Kompoziční kořen jen jako sestavení

`app/session.ts` má 911 řádků; `wireSession` sestavuje i rozhoduje. Cíl: session jen sestaví moduly a vystaví fasádu, logika je v malých modulech s vlastními testy v Node. Chování se nemění.

- **A3.1 Rozdělení `app/session.ts`:**
  - `app/viewport-mirror.ts`: jeden obecný zrcadlič množiny a mapy z `Observable` do viewportu (přidat, změnit, odebrat jen rozdíl). Nahradí čtyři ruční diffy `shownHidden`, `shownColors`, `shownPlanes`, `shownAxes`. Barva nastavená dřív, než se těleso ukáže, se zahodí jako dnes.
  - `app/regen-pipeline.ts`: regenerace od plánovače po zveřejnění (`regenerate`, skládání `RegenUiState`, `lastState`, výběr kreseb skic, první pohled `fitFirstView`). Zachová D3 z [[M19.1-opravy-z-revize|M19.1]] (zveřejnit až po `sync`).
  - `app/open-document.ts`: otevření a založení dokumentu. Jediná konstanta `NAME_OF_NEW_DOCUMENT`, sdílená s `documents.createNewDocument`.
  - `app/read-only.ts`: `refuseChanges` a zámek dokumentu jen pro čtení.
  - `session.ts` zůstane sestavení, pořadí kroků, úklid a fasáda; cílově do ~300 řádků včetně typů.
- **A3.2 Port `ViewSettings`:** `setTheme`, `setViewCubeLabels`, `setOrbitMode`, `onOrbitModeToggle` (a další nastavení pohledu, která dnes procházejí čtyřmi místy) jako jedno rozhraní. Implementuje ho továrna v `app` nad `Viewport` (D7), `AppSession` ho vystaví jako člen `viewSettings`, fake v `app/testing.ts` je jeden objekt. Další nastavení = jedna metoda v rozhraní, ne čtyři.
- **A3.3 Konstanty pro `ui` bez fasády (D6):** nový vstupní bod `src/interaction/constants.ts` jen s daty a čistými funkcemi bez závislostí (`ACTION_IDS`, `toolActionId`, `toolModes`, `FILE_ACTION_IDS`, `MANIPULATOR_GLYPHS` z A6). `ui` z něj smí hodnoty, z `index.ts` dál jen typy. Pravidlo v `.dependency-cruiser.cjs` a tabulka ve spec [[01-architektura]]: `constants.ts` neimportuje nic kromě `core` a vlastních souborů s daty. Z `AppSession` zmizí `actionIds`, `toolActionId`, `toolModes`, `fileActionIds` (a po A4 `sketchActionIds`, `sketchConstraintActionId`).
- **A3.4 `ToolbarModel` v `interaction`:** filtr nástrojů podle režimu, povolení a pořadí skupin z `ui/toolbar-groups.ts`. `ui` si nechá jen rozložení do šířky (`toolbar-fit.ts`, pixely).
- **A3.5 `DocumentListModel` v `interaction`:** stav `busy`, potvrzení smazání přes port (`confirm(text): boolean | Promise<boolean>`, dodá `ui`), pořadí smazání a znovunačtení, přejmenování. Seznam dokumentů dostane přes port `DocumentCatalog` definovaný v `interaction`, adaptér z `app/documents.ts`. Stavy načítání z `ui/document-list.ts` se přesunou do modelu. `DocumentList.vue` jen zobrazuje.
- **Soubory:** `app/{session,viewport-mirror,regen-pipeline,open-document,read-only,documents,browser,testing,index}.ts`, `render` (implementace `ViewSettings`), `interaction/{constants,toolbar-model,document-list-model,index}.ts`, `ui/{toolbar-groups,document-list}.ts`, `ui/components/{Toolbar,DocumentList}.vue` a místa, která četla konstanty z `AppSession`, `.dependency-cruiser.cjs`, testy v `test/unit/`.
- **Testy:**
  - `viewport-mirror`: přidání, změna, odebrání, opakovaná stejná hodnota nevolá viewport, barva před zobrazením;
  - `regen-pipeline`: přenést odpovídající části `session.test.ts` (generace, chyby, první pohled), běží bez celé session;
  - `ToolbarModel`, `DocumentListModel`: chování dnešních `toolbar-groups` a `DocumentList.vue` (busy blokuje druhou akci, zamítnuté potvrzení nic nesmaže, chyba vrátí `busy` na `false`);
  - lint: import hodnoty z `@/interaction` v `ui` neprojde, z `@/interaction/constants` projde;
  - `session.test.ts` zůstane jako test sestavení a projde.
- **Hotovo když:** `session.ts` obsahuje jen sestavení a fasádu (žádný `let` se stavem kromě životního cyklu), nové moduly mají vlastní testy a `npm run check` i e2e jsou zelené.
- **Spec:** [[01-architektura]] (kompoziční kořen, vstupní body modulu), [[10-interakce]] (tabulka modelů), [[11-ui]] (`AppSession`, lišta, seznam dokumentů).

### A4 Modul `sketcher`

Podle [[0024-modul-sketcher|ADR 0024]].

- **A4.1 Přesun:** `interaction/{sketch-editor,sketch-session,sketch-actions,sketch-drawing,sketch-dimensions}.ts` a `interaction/sketch-tools*` → `src/sketcher/`, testy do `test/unit/sketcher/`. Veřejné API v `sketcher/index.ts`, konstanty akcí skicáře (`SKETCH_ACTION_IDS`, `sketchConstraintActionId`) v `sketcher/constants.ts` (stejné pravidlo jako A3.3).
- **A4.2 Hranice:** v `.dependency-cruiser.cjs` a v tabulce modulů spec [[01-architektura]] nový řádek `sketcher: { deps: ['core', 'document', 'ops', 'sketch', 'interaction'] }`. `app` smí `sketcher`, `ui` z něj jen typy a `constants.ts`. `interaction` nesmí `sketcher`. Co skicář z `interaction` potřebuje, přidá `interaction/index.ts` do veřejného API (nic víc).
- **A4.3 Obecné vrstvy vstupu v `ToolManager`:** `InputLayer { onPointer(e): boolean; onKey(e): boolean }` (true = událost zpracovaná, dál nejde). `createToolManager({ layers: readonly InputLayer[] … })` je volá v pořadí před aktivním nástrojem. Manipulátory a `refPick` jsou vrstvy, které skládá `app`; `ToolManager` už nezná `ManipulatorController` ani `createRefPick`. Pořadí vrstev je dnešní (manipulátory, pak `refPick`, pak nástroj).
- **A4.4 Podsložky v `interaction`:** `manipulators/` (controller, tažení, deskriptory) a `feature-dialog/` (editor featury, `ref-pick-tool`, `ref-values`, tabulka druhů z A2). Jen přesun, API se nemění.
- **Soubory:** `src/sketcher/**`, `src/interaction/**` (přesuny, `index.ts`, `tool-manager.ts`), `app` (sestavení skicáře a vrstev), `ui` (typy skicáře), `render` pokud bere typy skicáře, `.dependency-cruiser.cjs`, `test/unit/{sketcher,interaction}/**`.
- **Testy:**
  - `ToolManager`: vrstva, která událost zpracuje, ji nepustí dál; pořadí vrstev; bez vrstev chování jako dřív;
  - lint: import `@/sketcher` z `interaction` neprojde (záměrně chybný import, pak odebrat);
  - stávající testy skicáře projdou po přesunu beze změny chování.
- **Hotovo když:** v `interaction` nezbyde nic ze skicáře, `npm run lint:deps` hlídá směr a `npm run check` i e2e jsou zelené.
- **Spec:** [[01-architektura]] (tabulka modulů, adresáře), [[10-interakce]] (`ToolManager`, vrstvy), [[12-skicar]] (umístění skicáře).

### A9 Specifikace jako kontrakt

Dělá hlavní sezení, ne implementátor, průběžně po každém úkolu. Sekce, kterých se úkol dotkl, se přepíšou tak, aby popisovaly **aktuální stav** bez odrážek „M12:“, „M14:“. Historie zůstává v deníku, ADR a retrospektivách. Navíc jednorázově opravit rozchody z A9 [[Revize kódu 2026-10-14|revize]], které M19.1 nechal (tok dat v [[01-architektura]], výběr po regeneraci a tabulka modelů v [[10-interakce]], `unknown-handle` v [[07-regenerace]]). `architecture-reviewer` na konci milníku zkontroluje i bloky kódu ve spec proti `index.ts`.

### Pořadí a vlny

Úkoly jdou postupně, každý mění sdílené soubory (`index.ts`, `app`): Ú0 → A5 → A6 → A8 → A2 → A3 → A4. Po každém kontrola hlavním sezením, úprava spec (A9) a zaškrtnutí.

## Akceptační kritéria

Splnění (kontrola 2026-10-14):

- `ToolContext` nevystavuje `manipulators`, `sketches`, `project` ani `events` a nástroje všech pluginů projdou beze změny chování. → typový test v `tool-manager.test.ts`, testy pluginů zelené.
- Přejmenování parametru ve schématu bez úpravy typu `P` neprojde typecheckem, stejně jako překlep ve jméně kotvy. → `ParamSchemaOf<P>`, `FeaturePlugin<P, A>`, typové testy v `schema.test.ts` a `plugin.test.ts`; ověřeno dočasnou chybou. Známá mez u samostatně typovaného deskriptoru ([[07-regenerace]]).
- Nový druh reference znamená jeden nový záznam v tabulce. → obě tabulky přes `satisfies { [K in RefParamKind]: … }`; test za běhu vypuštěn jako nadbytečný (viz A2).
- `createAppSession` je jen sestavení a fasáda, logika má vlastní testy v Node. → `regen-pipeline`, `viewport-mirror`, `open-document`, `read-only`, `view-settings` s vlastními testy; `session.ts` 611 řádků, z toho ~250 typy fasády. Cíl ~300 řádků nesplněn, logika v ní ale nezůstala (jen reakce kamery na vstup do skici).
- `interaction` neimportuje nic ze skicáře, směr hlídá `npm run lint:deps`. → `interaction-allowed-deps`, ověřeno záměrně chybným importem; po revizi `interaction` nezná ani obsah lišty skicáře.
- Všechny cesty ke čtení parametrů jdou přes `evaluateParams`. → Regenerator, `FeatureEditor`, `ManipulatorController`; výjimka pro data skici a reference zapsaná ve [[03-dokument#Vyhodnocení parametrů]] a v Q003.
- Dotčené sekce specifikací popisují aktuální stav bez odrážek „M12:“, „M14:“. → 09 Manipulátory, 10 Nástroje a referenční parametr, 11 Kompoziční kořen přepsány; jinde odrážky z historie zůstávají (viz retrospektiva).
- V `src/` není žádný `*.test.ts`. Hranice testů hlídá `npm run lint:deps` stejně přísně jako předtím. → ověřeno sadou chybných importů před a po přesunu.
- `npm run check` a e2e zelené. → 5239 unit + 35 integračních testů, e2e 70/70.

## Co se naučíš

- Jak poznat, kdy je rozhraní „moc široké“, a proč se zužuje jen do chvíle, než ho začnou používat cizí pluginy.
- Jak převést kontrakt z komentáře do typu (mapované typy, generika pluginu).
- Tabulka chování místo paralelních `switch` a jak TypeScript vynutí její úplnost.
- Jak rozdělit kompoziční kořen, aby zůstal jen sestavením.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(Návrh Clauda, Pavel schválil 2026-10-15.)_

- **Co bylo jinak, než se čekalo:**
  - Kontrakty z prezentace narazily na skutečnost ve třech místech a implementátor se správně zastavil: `isParamVisible` nad vyhodnocenými parametry (volá se i uvnitř validace), `ViewSettings` implementovaný `Viewport` (paletu vybírá `app`, D7) a obecný `leave` pod vrstvou (`refPick` kreslí hover do téhož portu). Plán na úrovni kontraktu se vyplatí, ale u přesunů odpovědnosti je lepší napsat cíl a invarianty než přesnou signaturu.
  - Architektonická revize našla závislost, kterou nástroj nevidí: `interaction` neimportoval skicář, ale znal obsah jeho lišty. Čistý graf importů neznamená čistou hranici.
  - `session.ts` cíl ~300 řádků nesplnil, protože třetina jsou typy fasády. Délka souboru je špatné měřítko; lepší je „žádný `let` se stavem a žádné rozhodování“.
- **Co se osvědčilo:**
  - Pořadí od nejlevnějšího (testy, úzká rozhraní, typy) po přesuny modulů. Každý další úkol stál na předchozím (A2 na `Evaluated`, A4 na tabulce druhů).
  - Jeden implementátor na úkol a kontrola hlavním sezením po každém úkolu včetně propsání spec. Odchylky se řešily hned, ne na konci.
  - Ověřování pravidel hranic záměrně chybným importem: pravidlo, které nikdo neviděl selhat, nic nehlídá.
- **Co zůstává:**
  - `ToolDescriptor.group` je uzavřený výčet se skupinami skicáře (`draw`, `constrain`).
  - Pole hodnoty v HUD (96 px) leží přes kužel šipky (špička 98 px).
  - e2e `m19-2-rename` byl jednou nestabilní ve WebKitu pod zátěží.
  - Specifikace 10 a 11 mají v jiných sekcích dál odrážky z historie milníků.


