---
type: spec
status: implemented
order: 11
aliases:
  - "11-ui v prohlížeči"
modules:
  - plugin-api
  - app
  - ui
milestones:
  - "[[M10-ui]]"
  - "[[M12-skicar]]"
  - "[[M13-extrude-revolve]]"
  - "[[M14-topologicke-pojmenovani]]"
  - "[[M15-export-a-dokonceni]]"
  - "[[M22-rezimy-zobrazeni]]"
tags:
  - spec
  - archiv
created: 2026-10-17
updated: 2026-10-17
---
# 11 – `plugin-api` a `app` v prohlížeči (archiv)

Archivováno v [[M47-uklid-a-dokonceni|M47]] ([[Rozhodnutí nativního jádra|N128]]). Platná specifikace je [[11-ui]]. Text níže popisuje plugin featury se schématem a builderem a lokální kompoziční kořen (`createAppSession` s jádrem OCCT ve workeru, IndexedDB, Web Lockem a regenerací v prohlížeči), jak platily do [[M46-klient-nad-read-modelem|M46]]. Text je přesunutý beze změny.

## Plugin featury (plugin-api)

Jednotka rozšiřitelnosti. Každá vrstva má vlastní registr a zná jen svou část pluginu.

```ts
export interface FeaturePlugin<P = unknown, A extends FeatureAnchors = FeatureAnchors> {
  readonly schema: FeatureSchema<P>;          // → FeatureSchemaRegistry (document)
  readonly builder: FeatureBuilder<P, A>;     // → BuilderRegistry (regen)
  readonly tools?: readonly ToolDescriptor[]; // → ToolRegistry (interaction)
  readonly messages?: PluginMessages;         // { cs: {…}, en: {…} } – texty klíčů ze schématu (ADR 0014)
  readonly manipulators?: ManipulatorDescriptor<P, A>;   // → ManipulatorRegistry (interaction)
}
```

`A` je typ kotev pluginu (jména a nepovinnost kotev), sdílený builderem a deskriptorem úchytů, takže překlep ve jménu kotvy je chyba typu ([[0021-manipulatory-kotvy-z-regenerace|ADR 0021]], dodatek). Plugin bez manipulátoru `A` neuvádí. Pole `ops` (vlastní operace pluginu) původně plánované pro skicář v M12 nevzniká – editace skici je `feature.setParams` ([[Q074 Operace skicáře v logu|Q074]]); přibude, až ho bude potřebovat první plugin (pak `plugin-api` dostane závislost na `ops`).

Registrace jde jedinou funkcí, kterou používá `app` i testy ([[Q047 Registrace pluginu a úplnost registrů|Q047]]):

```ts
export function registerPlugin(
  plugin: FeaturePlugin,
  registries: {
    readonly schemas: FeatureSchemaRegistry;
    readonly builders: BuilderRegistry;
    readonly tools: ToolRegistry;            // od M9
    readonly manipulators: ManipulatorRegistry;   // od M18
  },
): void;
```

- **M18:** `plugin.manipulators` se zaregistruje do `ManipulatorRegistry` pod svým `type` ([[10-interakce#Manipulátory (M18)]]). `manipulators.type !== schema.type` → výjimka. Duplicitní typ v `ManipulatorRegistry` → výjimka `Duplicate manipulator '…'`. Obojí se kontroluje ještě před registrací čehokoli, za kontrolou nástrojů.

- Od M9 registruje i `plugin.tools` do `ToolRegistry`. Duplicitní id nástroje (i mezi nástroji jednoho pluginu) → výjimka `Duplicate tool '…'` ještě před registrací čehokoli. Pořadí kontrol: typy, schéma, builder, nástroje.

- `plugin.schema.type !== plugin.builder.type` → výjimka (chyba programu), nic se nezaregistruje.
- Duplicitní typ v kterémkoli registru → výjimka (`Duplicate feature schema|builder '…'`) ještě před registrací, takže se nezaregistruje nic (nejdřív se ověří `has` v obou registrech).
- `FeatureBuilder.build` a metody `FeatureSchema` jsou zapsané jako **metody**, ne jako vlastnosti s typem funkce. TS u metod porovnává parametry bivariantně, proto jde `FeaturePlugin<BoxParams>` předat jako `FeaturePlugin` bez přetypování. Přepis na `build: (…) => …` by to rozbil (hlídá test v `plugin-api`).
- Invariant „každý typ má schéma i builder“ tak platí z konstrukce. Kontrolu úplnosti všech pluginů aplikace dělá `app` (M10).

Struktura pluginu:

```
src/features/box/
├─ index.ts          export const boxPlugin: FeaturePlugin<BoxParams>
├─ schema.ts         BoxParams, boxSchema (verze, parametry, defaults, validate)
├─ builder.ts        boxBuilder
├─ tool.ts           boxTool (ToolDescriptor)
└─ box.test.ts       testy builderu s FakeKernel, validace, nástroj s ToolManager
```

Plugin **neobsahuje Vue komponenty**. Formulář dialogu se generuje ze schématu. Pro featuru, které generovaný formulář nestačí, je od M13 v `ui` registr vlastních dialogů podle typu – ne v pluginu ([[#Vlastní dialog featury (úniková cesta)]]).

## Kompoziční kořen (app)

`app` je rozdělený na dvě části (rozhodnutí 2026-10-13):

- **`createAppSession(deps)`** – čisté propojení hotových implementací. Nezná worker ani IndexedDB, takže se testuje v Node s `FakeKernel`, `MemoryDocumentStore` a `FakeViewport` (propojení událostí, regenerace, restart jádra, jen pro čtení).
- **`openAppSession(opts)`** – tenká vrstva pro prohlížeč: vytvoří workery, `IdbDocumentStore`, Web Lock a `Viewport` a předá je `createAppSession`. Testuje ji jen e2e test.

Stav pro UI je jednotně `Observable` ([[0010-prezentacni-model|ADR 0010]]), takže `ui` používá jen `useObservable`. Návrh tvaru (kontrakt upřesní Implementační plán [[M10-ui]]):

```ts
export type RegenUiState = { readonly busy: boolean; readonly bodyCount: number; readonly lastMs: number | null; readonly failed: string | null };  // failed: M19.1; počet chyb je od M19.2 FeatureTreeModel.errorCount
export type KernelUiState = 'starting' | 'ready' | 'restarting' | 'failed' | 'unavailable';

export interface AppSession extends Disposable {
  readonly doc: DocumentReader;
  readonly readOnly: boolean;                          // Q038: dokument otevřený v jiné záložce
  readonly locked: Observable<boolean>;                // readOnly || otevřený dialog – jediné místo pravidla (interaction)
  readonly toolbar: Omit<ToolbarModel, 'dispose'>;   // M20: lišta nástrojů (10-interakce); konstanty akcí bere ui z @/interaction/constants
  readonly regen: Observable<RegenUiState>;
  readonly kernel: Observable<KernelUiState>;          // Q055: restart po pádu jádra
  readonly kernelError: Observable<string | null>;     // příčina u 'unavailable' a od M19.1 i 'failed'
  retryKernel(): void;                                 // M19.1: z 'failed' / 'unavailable' spustí jádro znovu
  readonly persistence: Observable<PersistenceStatus>; // 'saved' | 'pending' | 'error' | 'failed' (M19.1)
  readonly persistenceError: Observable<string | null>; // text poslední chyby úložiště; null v 'saved' a 'pending' (M19.1)
  readonly selection: SelectionModel;
  readonly featureTree: FeatureTreeModel;              // Timeline
  readonly browser: BrowserModel;                      // Prohlížeč, viditelnost těles (Q071)
  readonly features: FeatureEditor;
  readonly actions: Pick<ActionRegistry, 'actions' | 'run' | 'handleKey'>;   // ui akce jen čte, spouští a předává klávesy
  readonly messages: PluginMessages;                   // slovníky pluginů pro vue-i18n (ADR 0014)
  readonly sketches: Omit<SketchEditor, 'gridStep'>;   // M12: skicář (panel skici, režim); krok mřížky čtou jen nástroje (M19.2)
  readonly mode: Observable<Mode>;                     // M12: = sketches.mode; Toolbar, dialog vs. panel skici
  readonly history: Omit<HistoryModel, 'dispose'>;     // M15: panel historie úprav; uvolní ho session (oprava revize M15)
  readonly files: Omit<FileActions, 'dispose'>;        // M15: stav exportu (akce jsou v actions, skupina 'file'); uvolní je session
  readonly defaultBodyColor: Observable<string>;       // '#rrggbb' barvy ploch aktuální palety (první hodnota z AppSessionDeps.theme, pak viewSettings.setTheme), pro pole barvy v Prohlížeči
  readonly documentName: Omit<DocumentNameModel, 'dispose'>;   // M19.2: jméno dokumentu a jeho přejmenování (document.rename, mimo undo); uvolní ho session
  readonly view: {                                     // M19.2 D4: průmět do pohledu pro vše, co ui kreslí nad viewportem (kóty skici)
    project(world: Vec3): readonly [x: number, y: number] | null;   // px vůči ploše pohledu; null = pohled není připojený
    onViewChanged(listener: () => void): Unsubscribe;               // pohyb pohledu (kamera, resize), každý snímek animace
  };

  mountViewport(el: HTMLElement): void;
  flush(): Promise<void>;                              // dopíše frontu persistence hned (jen pro čtení: nic); openAppSession ho volá na pagehide / visibilitychange=hidden
  close(): Promise<void>;                              // dopíše frontu persistence a uvolní vše; ui na něj čeká při přepnutí dokumentu
  readonly viewSettings: ViewSettings;                // nastavení pohledu (téma, popisky view cube, režim otáčení, od M22 styl zobrazení), port z app (M20, D7)
  dispose(): void;
}

export function createAppSession(deps: AppSessionDeps): Promise<AppSession>;   // Node i prohlížeč
export function openAppSession(opts: {
  docId: DocumentId; plugins: readonly FeaturePlugin[];
  translate: (key: string) => string; theme: 'light' | 'dark';   // název nového dokumentu, počáteční paleta
  confirm: (request: ConfirmRequest) => boolean;                  // potvrzovací dotaz akcí (M11), ui: globalThis.confirm + překlad
  download: (file: DownloadFile) => void;                         // M15: stažení souboru, ui: Blob + <a download>
}): Promise<AppSession>;                                            // M12: vytvoří i createPlanegcsSolver() a po session ho uvolní                                                       // jen prohlížeč
export function createDocumentList(opts: { plugins: readonly FeaturePlugin[]; translate: (key: string) => string; confirm: (request: ConfirmRequest) => boolean }): DocumentListModel;   // M20: model seznamu dokumentů nad IndexedDB a navigator.locks (10-interakce)
/** M15: typy vestavěných operací (klíče OP_VERSION včetně 'batch'); ui nesmí ops, test překladů je bere odtud. */
export const BUILT_IN_OPERATION_TYPES: readonly string[];

/** M15: port stažení souboru; implementuje ui (app ani interaction DOM neznají). */
export interface DownloadFile { readonly name: string; readonly mime: string; readonly data: string | Uint8Array<ArrayBuffer> }
```

Co `createAppSession` dělá: jen sestaví moduly, určí pořadí kroků, řídí životní cyklus a vystaví fasádu ([[M20-zpevneni-struktury|M20]], A3). Logika je v malých modulech `app` s vlastními testy v Node:

| Modul | Odpovědnost |
|---|---|
| `regen-pipeline.ts` | regenerace od plánovače po zveřejnění: `RegenUiState`, `lastState`, kresby skic, první pohled (*Krok regenerace* níže) |
| `viewport-mirror.ts` | zrcadlení stavu Prohlížeče do viewportu (skrytí, barvy, od M24 materiály, roviny, osy) jedním obecným diffem; `reapply()` po `sync` |
| `open-document.ts` | otevření a založení dokumentu; jméno nového dokumentu jen ve `storeNewDocument` (sdílí ho katalog dokumentů) |
| `read-only.ts` | `refuseChanges` a `createSessionPersistence` (se zámkem `PersistenceService`, bez něj vždy `'saved'`) |
| `view-settings.ts` | port `ViewSettings` a továrna `createViewSettings(viewport, theme)` → `{ viewSettings, defaultBodyColor }`; volba palety podle tématu (`paletteOf`); od M22 `setDisplayStyle(style)` předá styl viewportu (`Viewport.setDisplayStyle`, [[09-vykreslovani#Styl zobrazení]]) a `app` reexportuje `DisplayMode`, `DisplayStyle`, `DISPLAY_MODES` a `DEFAULT_DISPLAY_STYLE` pro `ui`; od M23 `setAoSettings(settings)` předá nastavení AO (`Viewport.setAoSettings`, [[09-vykreslovani#Víceprůchodové vykreslování (AO)]]) a `app` reexportuje `AoSettings`, `AoSettingRange`, `DEFAULT_AO_SETTINGS`, `AO_SETTING_RANGES` a `isValidAoSetting` |
| `kernel-supervisor.ts` | start a restart jádra |

Kroky:
1. Vytvoří registry, zaregistruje pluginy (`registerPlugin`) a vestavěné handlery operací, ověří úplnost registrů.
2. Načte nebo vytvoří dokument (`loadDocument`). Bez zámku (Q038) dokument jen načte a nevytvoří `PersistenceService`.
3. Sestaví `OperationDispatcher`, `UndoManager`, `PersistenceService`, `Regenerator`, `RegenScheduler`, `ToolManager`, `FeatureEditor`, `ActionRegistry`, prezentační modely a adaptéry portů (`RegenStatusPort` z `RegenState`).
4. Propojí události: `doc.changed` → `RegenScheduler.request()` → regenerace (viz *Krok regenerace* níže); `browser.hidden` → `viewport.setBodyVisible`.
5. Zaregistruje vestavěné akce voláním `createBuiltInActions(deps)` z `interaction` ([[10-interakce#Vestavěné akce]]); pravidla akcí v `app` nejsou (ADR 0010, revize M10).

Pravidla:

- **Jádro startuje na pozadí**: `createAppSession` se vrátí po otevření dokumentu s `kernel: 'starting'`; po `ready` zavolá `viewport.bodies.reset(jádro)` ([[09-vykreslovani]]) a vyžádá regeneraci. Totéž po restartu – viewport tak vždy tesseluje aktuálním jádrem a zahodí cache sítí. `MeshOps` předané `createViewport` v `openAppSession` jsou proto jen zástupné.
- **První pohled** (M19.2 D7): rozhoduje **první dokončená regenerace** po otevření session. Má-li tělesa, `app` zavolá `camera.fitAll()`, jinak nic. V obou případech je rozhodnuto a další regenerace (nová tělesa, restart jádra) kameru nechají, jak ji uživatel nastavil. Kamera v novém dokumentu tak při prvním vysunutí neposkočí, „Zobrazit vše“ je na kliknutí. Regenerace, která vyhodí, k `fitFirstView` nedojde, takže rozhodne až další úspěšná.
- **Potvrzení** (M11): `AppSessionDeps.confirm` (povinné) a `OpenAppSessionOptions.confirm` předá `app` do `createBuiltInActions` ([[10-interakce#Vestavěné akce]]). `ui` (`App.vue`) dodá `({ key, params }) => globalThis.confirm(i18n.global.t(key, params))` – stejný nativní dialog jako mazání dokumentu v `DocumentList`; vlastní dialogová komponenta zatím není potřeba ([[Rozhodnutí noční rychloakce#M11 – Další entity|R16]]).
- **Skicář** ([[12-skicar]], [[10-interakce#Skicář]], modul `sketcher`): `AppSessionDeps.solver: ConstraintSolver` (povinné; testy `FakeSolver`, prohlížeč `createPlanegcsSolver()` z `openAppSession`). `createAppSession` vytvoří `createSketchEditor({ features, solver, viewport, resolvePlane, gridStep })`: viewport jen `Pick<ViewportPort, 'sketches' | 'screenToRay' | 'overlay'>` (`screenToRay` od M28 pro tah popisku kóty, `overlay` od M26 pro vodítka snapperu), `gridStep: () => viewport.sketchGridStep()` (krok mřížky, kterou viewport právě kreslí, [[09-vykreslovani#Skici]]), `resolvePlane(ref) = planeOfRef(pipeline.lastState(), ref)` z `regen` (počáteční roviny i rovinné plochy; před první regenerací `EMPTY_STATE`). Zaregistruje `createSketchTools({ sketches })` do registru nástrojů (za nástroje pluginů) a `createSketchActions`; `ActionRegistry`, `ToolManager` (`defaultToolIds: { sketch: <výchozí nástroj skicáře ze sketcher> }`) a vestavěné akce dostanou `mode`; `FeatureTreeModel` a `BrowserModel` dostanou `sketchEdit: (id) => sketches.edit(id)` a `locked` (zábrany editace jsou v presenterech). Při vstupu do skici `viewport.camera.setViewDirection(session.plane.normal)`. Kresby skic po regeneraci (`artifactDrawing` každé skice kromě editované, kterou kreslí `SketchEditor`) kreslí `regen-pipeline`; roviny a osy z `browser.visiblePlanes` a `browser.visibleAxes` (`planeDrawing`, `axisDrawing`) zrcadlí `viewport-mirror`.
- **Vestavěné pluginy:** `BUILT_IN_PLUGINS` = box, cylinder, transform, boolean, sketch, extrude, revolve, fillet, chamfer (v tomto pořadí). Adaptér portu regenerace plní `RegenBody.names = body.names` (`NameTable` z `regen` strukturálně splňuje `TopoNames`) a `RegenSnapshot.anchors` z `RegenResult.anchors`. `bindSelectionHighlight(selection, viewport.highlight, features, regenStatus)`: vybrané plochy, hrany, tělesa i oblasti a reference v dialogu jsou zvýrazněné ([[10-interakce#Výběr]]). `createTopoInspector({ viewport, regen })` jako `session.topoInspector`, `dispose` se session.
- **Export a historie** (M15, [[M15-export-a-dokonceni|M15]], [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R121–R128]]): `AppSessionDeps.download` (povinné; testy zachytávají, `openAppSession` předá `OpenAppSessionOptions.download` z `ui`) a `AppSessionDeps.theme: 'light' | 'dark'` (povinné: počáteční téma, z něj první hodnota `defaultBodyColor`, aby pole barvy v tmavém režimu neukázalo světlou barvu; oprava revize M15). `createAppSession` vytvoří `createHistoryModel({ log })` (od M19.2 i `createDocumentNameModel({ doc, ops, locked })` pro `documentName`, [[10-interakce#Jméno dokumentu: `DocumentNameModel`]]) a `createFileActions({ registry: actions, exporter, regen, browser, editor: features, mode })` s exportérem `createFileExporter` z `file-exporter.ts`. Exportér dostává úzké závislosti: `name: () => string` (aktuální jméno dokumentu, ne celý `DocumentReader`), `regenBusy`, `lastState: () => RegenState`, `kernel: () => ExchangeOps | null` (ne celé `GeometryKernel`), `flush`, `store`, `docId`, `schemas`, `handlers`, `download` ([[0011-programovani-proti-rozhranim|ADR 0011]]):
  - **STEP** (`exportStep(bodies)`): počká, až `RegenScheduler.busy` je `false`, pak **synchronně** vezme poslední `finalState` (týž, ze kterého vznikl poslední `RegenSnapshot`), živé jádro (`KernelSupervisor.kernel()`, `null` → odmítne) a handle těles v pořadí `bodies` (těleso, které ve stavu není, přeskočí; žádné → odmítne) a hned zavolá `kernel.exportStep`. Worker zprávy zpracuje v pořadí, takže `release` pozdější regenerace přijde až po exportu; čekání na nečinnost pokryje sweep, který běží před `finished` ([[07-regenerace#Životnost handle: mark & sweep]]). Výsledek → `download({ name: safeFileName(name()) + '.step', mime: 'model/step', data })`.
  - **Dokument** (`exportDocument()`): `flush()` (jen pro čtení nic), `exportStoredDocument(store, docId, { schemas, handlers })` ([[05-persistence#Export a import souboru]]), chyba → odmítne. Když je stav úložiště `'failed'` (flush se pak nevolá) nebo `flush()` selže, exportér stáhne **živý dokument bez historie** (závislosti `persistenceStatus` a úzké `liveFile: () => TinycadFile`, které session dodá jako `() => exportDocument(doc)`; exportér celý dokument nevidí, M19.1, D4); s otevřeným dialogem v něm je i náhled transakce. Volajícímu to oznámí `{ withHistory: false }` (Ú13); `download({ name: safeFileName(…) + '.tinycad.json', mime: 'application/json', data: JSON.stringify(file, null, 2) + '\n' })` – odsazení kvůli čitelným rozdílům v gitu.
  - `safeFileName` (interní, čistá): `\ / : * ? " < > |` a řídicí znaky → `_`, ořízne mezery a tečky na koncích, nejvýš 100 znaků, prázdné → `'tinycad'`.
  - **Import** přes `DocumentCatalog.importFile` (adaptér v `documents.ts` s `store`, `ids`, `now` pro testy v Node): registry z `createPluginRegistries(plugins)` (`registries.ts`, totéž, co staví `createAppSession`), `importDocument` s novým id; vrací id nového dokumentu nebo chybu dat. `JSON.parse` dělá `ui`. Neznámý typ featury import propustí (`fromData` neznámé typy drží beze změny, [[03-dokument]]); regenerace pak featuru označí chybou.
  - **Barva** (M15, [[Q073 Průhlednost a barva těles|Q073]]): `browser.colors` → `viewport.setBodyColor` (rozdíl proti minulé mapě, jako `hidden`); `defaultBodyColor` z `face` palety podle tématu (`deps.theme`, pak `viewSettings.setTheme`). `viewport.setBodyColor` na těleso, které ještě není zobrazené, se zahodí ([[09-vykreslovani#Viewport]]), proto `app` po každém dokončeném `sync` skrytí a barvy znovu použije (`ViewportMirror.reapply()`).
  - **Materiál** (M24, [[Q078 Sada materiálů těles|Q078]]): `browser.materials` → `viewport.setBodyMaterial` stejným diffem jako barva. Těleso, které z mapy zmizí, dostane `DEFAULT_BODY_MATERIAL`. `reapply()` po `sync` pošle znovu i materiály. `AppViewport` má `setBodyMaterial`, falešný viewport v `app/testing.ts` zapisuje volání. `app` reexportuje pro `ui` `BodyMaterial`, `BODY_MATERIALS` a `DEFAULT_BODY_MATERIAL`.
  - `KernelSupervisor.kernel(): GeometryKernel | null` – živé jádro (během startu, restartu a po selhání `null`); `dispose` session uvolní historii a akce souboru (proto je `AppSession` vystavuje bez `dispose`).
  - Známé omezení: `exportStep` čekající na nečinnost regenerace zůstane viset, když se session mezitím zavře – neškodné, akce jsou uvolněné a nikdo na výsledek nečeká.
- **Manipulátory** ([[10-interakce#Manipulátory (M18)]], [[0021-manipulatory-kotvy-z-regenerace|ADR 0021]], [[0022-rezimy-a-hud-manipulatoru|ADR 0022]]): `createPluginRegistries` vytvoří i `ManipulatorRegistry` (`PluginRegistries.manipulators`). `createAppSession` vytvoří `createManipulatorController({ features, regen, registry, viewport })` a `createRefPickLayer(…)` a předá je `createToolManager({ …, layers: [manipulátory, refPick] })`. `dispose` session controller uvolní (po `ToolManager`). `AppSession.manipulator: { hud: Observable<ManipulatorHud | null>; setMode(id); setValue(handleId, shown); project(world); onViewChanged(listener) }`, kde `project` a `onViewChanged` delegují na `AppSession.view: { project, onViewChanged }` (přeposílá viewport pro vše, co `ui` kreslí nad pohledem, včetně kót skici). `app` znovu vyváží typy `ManipulatorHud` a `HudField`.
- **Nový dokument** se jmenuje `translate('document.untitled')` (stejně jako nová featura), jméno vzniká jen ve `storeNewDocument` (`open-document.ts`). Od M19.2 ho jde přejmenovat v titulku i v seznamu dokumentů (viz níže a [[#Komponenty]]).
- **Přidání do výběru** (M19.2): v každém seznamu `ui` (timeline, Prohlížeč, řádky a kóty skicáře) přidá nebo odebere klik či mezerník se Shift, Ctrl nebo Cmd. Rozhoduje jediná čistá `isAdditive(e)` v `ui/item-actions.ts`. Shift odpovídá kliku do pohledu (`select-tool`), Ctrl/Cmd seznamům v systému. Akce nad položkou z klávesnice spouští `runOnSelected(select, actions, id)`: nejdřív položku vybere, potom akci spustí, jen když je pro nový výběr povolená.
- **Přejmenování dokumentu** (M19.2 D5): jméno mění operace `document.rename` v logu, kterou undo přeskakuje ([[04-operace-a-historie#Operace dokumentu]]). Otevřený dokument přejmenuje `AppSession.documentName.rename(name)`. Dokument ze seznamu přejmenuje `renameDocument(deps: { store, locks, plugins, now }, id, name): Promise<void>` v `app/documents.ts` (logika pro Node, stejný vzor jako `importDocumentFile`): ořízne jméno (prázdné → výjimka), vezme zámek dokumentu (otevřený v jiné záložce → výjimka jako u smazání), načte dokument (`loadDocument`, chyba načtení → výjimka), vytvoří dispečer nad jeho logem, přejmenuje přes `createDocumentNameModel(...).rename(name)` (pravidlo jména je tak jen v modelu a ve validaci handleru; stejné jméno nic nezapíše a nezmění čas změny) a nové záznamy zapíše přes `store.appendEntries`. Jméno pak přežije reload a seznam ho ukáže ([[05-persistence]]). Pro `ui` ho obaluje `renameDocument(id, name, { plugins })` v `app/browser.ts` (store IndexedDB, `navigator.locks`, `now: Date.now`; stejný vzor jako `deleteDocument` a `importDocumentFile`), který `@/app` vyváží vedle `deleteDocument`.
- **Zavření** (rozhodnutí 2026-10-13): `close()` je asynchronní – dopíše frontu persistence (`flush`), pak uvolní session, a v `openAppSession` až potom store, viewport a zámek. **HMR (vývoj):** při `import.meta.hot.dispose` `App.vue` session zavře přes `close()` a nová instance na to počká, aby nenašla zámek dokumentu obsazený. `flush()` funguje i po `dispose()` a zařadí se za pojistný zápis. `dispose()` zůstává synchronní pojistka: spustí pojistný `flush` a `openAppSession` uvolní store a zámek až po jeho doběhnutí (`.finally`), viewport hned. Druhé `close` vrátí tentýž promise. Selže-li zápis, `close` vše přesto uvolní a odmítne s chybou zápisu – `ui` ji při přepnutí dokumentu zachytí a ukáže. `verify` je v `AppSessionDeps` volitelné (výchozí `false`).
- **Smazání dokumentu** si vezme zámek dokumentu (`ifAvailable`); dokument otevřený jinde nesmaže a odmítne chybou.
- **Kdo co uvolní**: `createAppSession.dispose` uvolní, co sám vytvořil (modely, služby, jádra přes továrnu), a před tím dopíše frontu persistence (`dispose` + `flush`). Viewport, store a zámek předané v `deps` uvolní `openAppSession`, který je vytvořil.
- **Ověření při načtení**: `AppSessionDeps.verify` se předá `loadDocument` ([[05-persistence]]); `openAppSession` ho zapne ve vývojovém režimu (`import.meta.env.DEV`).
- **`RegenScheduler`**: při změně spustí regeneraci; když už běží, poznamená si „dirty“ a po doběhnutí spustí znovu jen jednou (žádná fronta stovek regenerací při tažení posuvníku). Běžící operaci jádra **nepřerušuje** ([[Q010 Zrušení probíhající operace jádra|Q010]]); výsledek zastaralé regenerace se jen zahodí.
- **Krok regenerace** (`regen-pipeline.ts`; [[M19.1-opravy-z-revize|M19.1]], D3, revize C6): `run` → kontrola, že session žije a regenerátor je pořád živý → `await viewport.bodies.sync(bodies)` → znovu tatáž kontrola. Teprve pak `lastState`, `regenStatus.publish` (tělesa, jména, kotvy), kresby skic, čítače, `ViewportMirror.reapply()` a `fitFirstView`. Index z pickingu a tabulka jmen tak vždy patří k téže generaci (dřív se snapshot zveřejnil před tessellací a klik v tom okně uložil `TopoRef` jiné hrany). Plánovač běží sériově a krok zahrnuje i tessellaci, takže zastaralý výsledek se nezveřejní a tessellace se pro něj neodešle. Důsledky: `regen.busy` je `true` i během tessellace (export STEP čeká i na ni) a kresby skic s čítači se ukážou až s tělesy.
  - **Otevřený dialog featury** ([[0025-vstupni-stav-editovane-featury|ADR 0025]], [[M21-vstupni-stav-editovane-featury|M21]]): pipeline čte `features.current` na začátku běhu a volá `run(studio, { inputOf: session.featureId })`. S `result.input` volá `viewport.syncLayers({ main: tělesa vstupu, preview: previewBodies(koncový stav, vstup) })`, bez vstupu `syncLayers({ main: koncový stav, preview: [] })`. Obě vrstvy se vymění atomicky a před `publish`, takže D3 platí pro obě ([[09-vykreslovani#Náhled]]). `AppViewport` má `syncLayers` místo samostatného náhledu. `previewBodies` (čistá, v `regen-pipeline.ts`) vrací tělesa výsledku v jeho pořadí, která ve vstupu nejsou se stejným `(BodyId, handle)`. Snapshot: `bodies` koncový stav, `pick` z `result.input` (adaptér), jinak koncový stav s `feature: null`. `lastState`, `bodyCount` a první pohled počítají dál s koncovým stavem. Otevření a zavření dialogu vyžádá regeneraci; při `edit` s posunem lišty tak proběhne nejvýš jedna regenerace navíc (první bez vstupu, mezi nimi mezistav, ve kterém `refPick` zásahy ignoruje).
  - **`RegenUiState.failed`**: výjimka regenerace jiná než `'disconnected'` nastaví text chyby a jde do `reportError`; úspěšná regenerace ho vynuluje. Výjimka odběratele `publish` zbytek kroku nezastaví, nahlásí se až na konci.
- **Restart jádra** ([[Q055 Pád WASM jádra|Q055]]): když jádro skončí `'disconnected'` (trap, pád workeru), `app` ho zahodí, vytvoří nové přes továrnu z `deps`, počká na `ready` a vyžádá regeneraci (`kernel`: `restarting` → `ready`). O pádu rozhoduje stav spojení ([[M19.1-opravy-z-revize|M19.1]], D2). Jádro pro supervisor je `SupervisedKernel = GeometryKernel & Disposable & { onDisconnected(listener): Unsubscribe }` (port definuje `app`, `createOcctKernel` ho splní přes `RpcClient.onDisconnected`). Supervisor se přihlásí ke každému spuštěnému jádru, takže pád zachytí bez ohledu na to, kdo na něj narazil (regenerace, tessellace, export STEP). `lost(regenerator)` z regenerace zůstává jako druhá cesta. Pád jádra, které už není živé, je ozvěna a ignoruje se. Restartuje se nejvýš `RESTART_LIMIT = 3` pádů v posuvném okně `RESTART_WINDOW_MS = 60 000` ms monotónních hodin (`deps.monotonic`, v prohlížeči `performance.now`). Další pád → `failed`, aby se pády necyklily, a `kernelError` nese příčinu. `AppSession.retryKernel()` z `failed` i `unavailable` spustí jádro znovu s prázdným oknem. `onReady` nového jádra nastaví `lastState = EMPTY_STATE`, protože handly starého jádra nesmí jít novému (export STEP). Chybu v `onReady` pošle do `reportError`. Supervisor startuje (`start()`) až jako poslední krok sestavení session. Když konstrukce session selže, `lifetime.dispose()` uvolní, co vzniklo, a worker neosiří. Jádro, které se **nespustí** (worker nebo WASM se nenačte, selže inicializace OCCT), je `unavailable` – jiná hláška („Geometrické jádro se nepodařilo spustit“) s technickou chybou v tooltipu; `AppSession.kernelError: Observable<string | null>` nese její text (oprava po chybě v Safari, 2026-10-13). Jádro, které naběhne až po zavření session, se jen uvolní a viewport se nepoužije. Nepovedený restart po pádu je také `unavailable`. U `unavailable` i `failed` nabízí TitleBar „Zkusit znovu“ (`retryKernel`, M19.1 Ú13).
- **Jen pro čtení** ([[Q038 Jeden dokument ve dvou záložkách|Q038]], [[05-persistence#Jeden zapisovatel na dokument]]): bez zámku `readOnly: true`, akce a nástroje měnící dokument jsou zakázané.
- **Dokumenty** ([[Q019 Úvodní obrazovka se seznamem dokumentů|Q019]]): bez routeru. Id otevřeného dokumentu je v `location.hash` (`#/d/<id>`), prázdný hash ukáže `DocumentList`. Změnu hashe řeší `ui` (dispose staré session, otevření nové).
