---
type: spec
status: implemented
order: 10
aliases:
  - interaction – výběr, nástroje, akce
  - Spec 10
modules:
  - interaction
milestones:
  - "[[M09-interakce]]"
  - "[[M12-skicar]]"
  - "[[M13-extrude-revolve]]"
  - "[[M14-topologicke-pojmenovani]]"
  - "[[M15-export-a-dokonceni]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-15
---
# 10 – `interaction`: výběr, nástroje, akce

> **Pojmy:** [[Výběr]], [[Nástroj]], [[Akce]], [[Transakce]], [[Rollback bar]], [[Prezentační model]]  
> **Rozhodnutí:** [[0009-platformove-nezavisla-domena]], [[0010-prezentacni-model]], [[0011-programovani-proti-rozhranim]]  
> **Milník:** [[M09-interakce]]

Převádí vstupy uživatele (myš, klávesnice, UI) na operace. **Nikdy nemění dokument přímo** – jen vytváří operace a posílá je dispečerovi nebo transakci. Závisí jen na `core`, `document`, `ops` a od M12 `sketch` (model skici a port řešiče).

`interaction` je **prstenec 2** ([[0009-platformove-nezavisla-domena|ADR 0009]]): obsahuje logiku obrazovek jako [[Prezentační model|prezentační modely]] ([[0010-prezentacni-model|ADR 0010]]), ale nezná DOM, Vue ani Three.js. Viewport zná jen přes vlastní port `ViewportPort`.

## Port viewportu

```ts
export interface ViewportPort {
  pick(x: number, y: number, filter?: PickFilter): PickResult | null;   // souřadnice v px vůči ploše pohledu; výchozí filtr ['edge', 'face']
  screenToRay(x: number, y: number): { origin: Vec3; direction: Vec3 };
  readonly highlight: HighlightPort;                // hover a výběr
  readonly overlay: OverlayPort;                    // dočasná geometrie nástrojů
  readonly sketches: SketchPort;                    // kresby skic a rovin (M12)
  readonly manipulators: ManipulatorPort;           // úchyty manipulátorů (M18), viz Manipulátory
  project(world: Vec3): readonly [x: number, y: number] | null;   // M19: průmět do px vůči ploše pohledu; nepřipojený → null
  readonly events: Subscribable<{ pointer: ViewPointerEvent; key: ViewKeyEvent; viewChanged: ViewChangedEvent }>;   // viewChanged od M19
}

export type PickKind = 'face' | 'edge' | 'sketchEntity' | 'sketchRegion';   // 'sketchEntity' od M12, 'sketchRegion' od M13; 'vertex' odložen (M14, R101 ⚠)
export type PickFilter = readonly PickKind[];   // prázdné = nic nejde vybrat

/** Co jde zvýraznit: plocha nebo hrana tělesa, bez bodu a normály (Q065). */
export type HighlightTarget =
  | { kind: 'face'; body: BodyId; faceIndex: number }
  | { kind: 'edge'; body: BodyId; edgeIndex: number }
  | { kind: 'sketchEntity'; sketch: string; entity: string }    // M12; HighlightPort ho zatím ignoruje (zvýraznění nese styl kresby)
  | { kind: 'sketchRegion'; sketch: string; region: string }    // M13: oblast kresby (id kresby, id oblasti); render ji vyplní
  | { kind: 'body'; body: BodyId };                             // M14: celé těleso (výběr v Prohlížeči, reference bodies v dialogu)

/** Výsledek pickingu je HighlightTarget doplněný o místo zásahu, lze ho předat přímo do setHover. */
export type PickResult =
  | { kind: 'face'; body: BodyId; faceIndex: number; point: Vec3; normal: Vec3 }  // normal = jednotková normála ve světě, směrem ven z tělesa
  | { kind: 'edge'; body: BodyId; edgeIndex: number; point: Vec3 }
  | { kind: 'sketchEntity'; sketch: string; entity: string; point: Vec3 }    // sketch = id kresby, entity = id bodu nebo křivky (M12)
  | { kind: 'sketchRegion'; sketch: string; region: string; point: Vec3 };   // M13: oblast kresby pod kurzorem

export interface HighlightPort {
  setHover(target: HighlightTarget | null): void;              // vždy celý stav, ne přírůstek
  setSelection(targets: readonly HighlightTarget[]): void;     // prázdné pole = nic vybráno
}

export type OverlayStyle = 'preview' | 'construction';
export type OverlayShape =
  | { kind: 'lines'; points: readonly Vec3[]; style: OverlayStyle }   // páry bodů = úsečky (lichá délka = chyba)
  | { kind: 'points'; points: readonly Vec3[]; style: OverlayStyle };

export interface OverlayPort {
  set(id: string, shapes: readonly OverlayShape[]): void;  // nahradí vše pod daným id
  remove(id: string): void;                                // neznámé id = nic
  clear(): void;
}

/** Kresba skici nebo roviny (M12): rovina + 2D tvary se stylem; render ji tesseluje a pickuje (spec 09, Skici). */
export type SketchStyle = 'normal' | 'defined' | 'construction' | 'hover' | 'selected' | 'plane';
export type SketchDrawingCurve =
  | { kind: 'line'; id: string; from: Vec2; to: Vec2; style: SketchStyle }
  | { kind: 'arc'; id: string; center: Vec2; radius: number; startAngle: number; endAngle: number; style: SketchStyle };  // proti směru hodin, endAngle > startAngle; kruh = +2π
export interface SketchDrawingPoint { id: string; at: Vec2; style: SketchStyle }
export interface SketchDrawing { plane: Plane; curves: readonly SketchDrawingCurve[]; points: readonly SketchDrawingPoint[]; regions?: readonly SketchDrawingRegion[];
  editing?: boolean }   // M19.2: kresba skici editované ve skicáři; chybí = false
/** Oblast kresby (M13): uzavřený polygon v rovině (poslední bod ≠ první), díry jako další polygony; id = jméno oblasti. */
export interface SketchDrawingRegion { id: string; outer: readonly Vec2[]; holes: readonly (readonly Vec2[])[] }

export interface SketchPort {
  set(id: string, drawing: SketchDrawing): void;   // nahradí kresbu pod id
  remove(id: string): void;                        // neznámé id = nic
}
```

**Id kresby je kontrakt** (revize M20): id kresby určuje, jestli zásah do ní jde odkázat. Kresba skici artefaktu má id skici (`sketchId`), rovina a osa id roviny a osy (`PlaneId`, `AxisId`). Kresba, jejíž id není id artefaktu (`parseSketchId`, `parseAxisId` ho nepřijmou), například upravovaná skica ve skicáři, se z dialogu odkázat nedá: tabulka druhů referencí její zásahy ignoruje. Kdo kreslí (`sketcher`, `app`), tuto konvenci dodržuje.

```ts

export interface ViewPointerEvent {
  readonly type: 'down' | 'move' | 'up' | 'leave';   // leave = kurzor opustil plochu pohledu (zruší hover)
  readonly x: number; readonly y: number;
  readonly button: 'left' | 'middle' | 'right' | null;
  readonly mods: KeyMods;
}

export interface ViewKeyEvent {
  readonly key: string;              // hodnota KeyboardEvent.key
  readonly mods: KeyMods;
  readonly inTextField: boolean;     // fokus v textovém poli → zkratky se ignorují
}

/** M19: po vykresleném snímku, ve kterém se změnila kamera nebo velikost plochy (HUD manipulátoru se přesune). */
export interface ViewChangedEvent { readonly generation: number }

export interface KeyMods { readonly shift: boolean; readonly alt: boolean; readonly mod: boolean } // mod = Cmd/Ctrl
```

- Port definuje `interaction`, protože ho potřebuje. `render` ho implementuje (`Viewport`) a z `interaction` importuje jen tyto typy.
- `interaction/index.ts` re-exportuje typ `BodyId` z `document` jako součást slovníku portu. `render` ho bere odtud a na `document` nesahá ([[Q056 Odkud render bere BodyId|Q056]]).
- V kódu mají všechna pole typů portu `readonly` ([[Neměnná data]]), ve výpisu výše jsou kvůli čitelnosti vynechaná. Mapa událostí `{ pointer, key }` má v kódu jméno `ViewportEvents`.
- `pick` s filtrem (M10.1): pořadí druhů ve filtru nemá význam, hrana má přednost před plochou jako dosud; prázdný filtr → `null` bez dotazu na scénu. Nástroj nebo parametr dialogu tak určí, co jde vybrat, a hover nezvýrazňuje nic jiného.
- `sketches` (M12): stejné zrcadlo jako overlay, ale s id entit a pickovatelné (`'sketchEntity'` ve filtru; výchozí filtr ho neobsahuje, `SelectTool` o něm neví). Editovanou skicu kreslí `SketchEditor`, skici z regenerace a roviny `app` ([[#Skicář]]). `FakeViewport` kresby zaznamenává (`sketchDrawings: ReadonlyMap<string, SketchDrawing>`).
- `SketchDrawing.editing` (M19.2 D2) má jen kresba `SketchEditor` (`toSketchDrawing(…, { editing: true })`). Kresby z regenerace, roviny a osy ho nemají. Tělesa takovou kresbu pro picking nezakrývají, její zakryté části `render` kreslí slabě a čárkovaně a v její rovině kreslí mřížku skici ([[09-vykreslovani#Skici]]). Ostatní kresby tělesa zakrývají i pro picking.
- `sketchRegion` (M13): oblasti kresby z `SketchDrawing.regions` jsou pickovatelné jen se `'sketchRegion'` ve filtru (parametr `region` v dialogu); render je bez zvýraznění nekreslí ([[09-vykreslovani#Skici]]).
- `PickResult` je definovaný jen tady, [[09-vykreslovani]] na něj odkazuje. Varianta `vertex` přibude, až bude výběr vrcholů potřeba ([[Q057 Tvar PickResult|Q057]]; v M14 znovu odloženo, [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R101]] ⚠). `PickResult` ani `HighlightTarget` nenesou topologické jméno: `render` jména nezná, `interaction` si je dohledá v portu stavu regenerace (`RegenBody.names`).
- `HighlightPort` je zrcadlo: stav hoveru a výběru drží `interaction` a vždy ho předá celý. Bere `HighlightTarget`, protože výběr bod zásahu nezná ([[Q065 Cíl zvýraznění bez bodu a normály|Q065]]); `PickResult` je jeho podtyp, takže výsledek `pick` jde předat beze změny. `OverlayPort` nese jen platformově nezávislé tvary ve světových souřadnicích, žádné typy Three.js. Další druhy (síť pro náhled tělesa) přibudou s potřebou ([[Q058 Kontrakt HighlightPort a OverlayPort|Q058]]).
- `ViewPointerEvent` chodí pro všechna tlačítka. Pravé a prostřední tlačítko zároveň ovládá kameru, nástroje je mají ignorovat. Kolečko se do `interaction` neposílá, patří jen kameře.
- Převod DOM událostí na `ViewPointerEvent`/`ViewKeyEvent` dělají adaptéry (`render` pro canvas, `ui` pro globální klávesnici). Adaptér také převádí Cmd (macOS) / Ctrl (jinde) na `mods.mod`, takže `interaction` platformu nezná. Do `interaction` se DOM typ nikdy nedostane.
- V testech nahrazuje viewport `FakeViewport` (předpřipravené výsledky `pick`, ruční emit událostí, zaznamenaný stav `highlight` a `overlay`). `pick` si zapamatuje poslední filtr (`lastFilter`; `undefined` před prvním voláním i po volání bez filtru) a připravený výsledek vrátí jen tehdy, když jeho `kind` je ve filtru (bez filtru platí výchozí `['edge', 'face']`); připravenou funkci volá vždy, i s prázdným filtrem, aby test poznal, že `refPick` s prázdným filtrem `pick` nevolá.

## Port stavu regenerace

`interaction` nesmí znát `regen`, ale strom featur ukazuje chyby regenerace a výběr podtvarů se po regeneraci přemapuje podle jmen (R102, níže). Proto si `interaction` definuje vlastní port a `app` ho plní z [[Stav regenerace|RegenState]] ([[Q063 Stav regenerace v interaction|Q063]], [[Q064 Výběr po regeneraci|Q064]]).

```ts
export type FeatureHealth =
  | { kind: 'ok' }
  | { kind: 'warning'; message: string }
  | { kind: 'error'; message: string; issues?: readonly ParamIssue[] };   // issues = neplatné parametry (INVALID_PARAMS), překládá ui

export interface RegenBody { readonly body: BodyId; readonly feature: FeatureId; readonly names: TopoNames }   // names od M14

/** Topologická jména tělesa poslední regenerace (M14, spec 08). Úzké rozhraní definované tady; NameTable z regen ho strukturálně splňuje. */
export interface TopoNames {
  nameOfFace(index: number): TopoName | undefined;
  nameOfEdge(index: number): TopoName | undefined;
  faces(name: TopoName): readonly number[];      // vzestupně; neznámé jméno → []
  edges(name: TopoName): readonly number[];
}
export const NO_TOPO_NAMES: TopoNames;            // nic nemá jméno

export interface RegenSnapshot {
  /** Roste o 1 s každou dokončenou regenerací; 0 = ještě žádná. */
  readonly generation: number;
  /** Featury, které poslední regenerace vyhodnotila (ne potlačené, ne za barem). */
  readonly health: ReadonlyMap<FeatureId, FeatureHealth>;
  /** Tělesa poslední regenerace v pořadí, v jakém je ukazuje Prohlížeč (M10). */
  readonly bodies: readonly RegenBody[];
  /** Skici poslední regenerace v jejím pořadí (M12): Prohlížeč, skupina Skici. */
  readonly sketches: readonly RegenSketch[];
  /** Kotvy manipulátorů featur poslední regenerace (M18, RegenResult.anchors). */
  readonly anchors: ReadonlyMap<FeatureId, FeatureAnchors>;
  /**
   * Pickovatelná tělesa (ADR 0025): při otevřené session dialogu vstup její featury (feature = její id),
   * jinak koncový stav (feature = null, bodies === this.bodies). Index z pickingu patří k nim.
   */
  readonly pick: { readonly feature: FeatureId | null; readonly bodies: readonly RegenBody[] };
}

/** Kotva manipulátoru (M18); strukturálně shodná s Anchor z regen, app ji předá beze změny. */
export interface Anchor { readonly point: Vec3; readonly direction?: Vec3 }
export type FeatureAnchors = Readonly<Record<string, Anchor>>;

export interface RegenSketch { readonly sketch: SketchId; readonly feature: FeatureId; readonly regions: readonly string[] }   // M12; regions = jména oblastí v pořadí artefaktu (M13, Prohlížeč)

export interface RegenStatusPort {
  readonly state: Observable<RegenSnapshot>;
}
```

- `health` je `ReadonlyMap`, ale `Map` zmrazit nejde: adaptér v `app` posílá v každém snapshotu **novou** mapu a už ji nemění. `interaction` ji jen čte.
- Potlačení a pozice za barem port nenese: `interaction` je čte přímo z dokumentu, takže se projeví hned, ne až po regeneraci.
- `anchors` (M18): stejně jako `health` nová mapa v každém snapshotu. Typy `Anchor` a `FeatureAnchors` jsou veřejné API `interaction`, pluginy je potřebují pro podpis `ManipulatorDescriptor.frame`. `FakeRegenStatus.publish` dostane volitelný čtvrtý argument `anchors` (chybějící = prázdná mapa).
- **Kdo čte `pick` a kdo `bodies`:** (výjimka: skrytí a barvy pro viewport v `BrowserModel` jdou přes sjednocení `bodies` a `pick.bodies`, aby skryté těleso spotřebované editovanou featurou zůstalo skryté i ve vstupu, Q071)  všechno, co převádí index na jméno nebo jméno na indexy, čte `pick.bodies`: `nameOfHit` (`refPick`, `SelectionModel.set`/`toggle`, `TopoInspector`), `highlightTargets` u `topo` (`bindSelectionHighlight`) a přemapování výběru po regeneraci. `bodies` čtou jen Prohlížeč a export.
- V testech port nahrazuje `FakeRegenStatus` (`testing.ts`) s metodou `publish(health, bodies?, sketches?, anchors?, pick?)` (bez `pick` platí `{ feature: null, bodies }`), která zvýší `generation` (chybějící seznamy prázdné; těleso bez `names` dostane `NO_TOPO_NAMES`, M14). `aTopoNames({ faces?: Record<string, number[]>, edges?: … })` v `testing.ts` sestaví `TopoNames` z ručně zadaných jmen. Port nese `sketches` vedle `bodies` místo sjednocení `artifacts` z revize – stejná informace s menší změnou ([[Rozhodnutí noční rychloakce#M12 – Skicář|R38]] ⚠). `RegenBody` se exportuje, potřebuje ho adaptér v `app`.

## Prezentační modely a `Observable`

Stav, který UI zobrazuje, vystavují prezentační modely jako `Observable<T>` z `core` (neměnný snapshot + `subscribe`). Pohled volá jen příkazy. **Prezentační modely nemají vlastní `events`, jediný kanál změn je `Observable`** ([[0010-prezentacni-model|ADR 0010]]).

| Model | Stav pro UI | Příkazy |
|---|---|---|
| `FeatureTreeModel` | `rows: Observable<readonly TreeRow[]>`, `rollbackIndex`, `errorCount`, `renaming` | `edit`, `rename`, `beginRename`, `cancelRename`, `moveRollbackBar`, `select`, `move`, `dependentsOf` (dotaz) |
| `FeatureEditor` | `current: Observable<FeatureEditSession \| null>` | `create`, `edit` |
| `FeatureEditSession` | `state: Observable<EditState>` (parametry, chyby, pole formuláře, aktivní referenční parametr) | `setParam`, `removeRef`, `focusRefParam`, `commit`, `cancel` |
| `ToolManager` | `active: Observable<string>` | `activate` |
| `ActionRegistry` | `actions: Observable<readonly ActionState[]>` | `run` |
| `SelectionModel` | `items: Observable<readonly SelectionItem[]>` | `set`, `toggle`, `clear` |
| `SketchEditor` (M12) | `current: Observable<SketchSession \| null>`, `mode: Observable<Mode>` | `create`, `edit` |
| `SketchSession` (M12) | `state: Observable<SketchState>` (entity, vazby, stupně volnosti, výběr, řádky vazeb) | `addGeometry`, `addConstraint`, `setDimension`, `remove`, `drag`, `select`, `finish`, `cancel`; M28 `previewDimension`, `moveDimension`, `endMoveDimension` |
| `HistoryModel` (M15) | `state: Observable<HistoryState>` (řádky logu, celkový počet, počet starších) | – (jen čtení) |
| `FileActions` (M15) | `status: Observable<FileStatus>` | `dismiss` (akce exportu jsou v `ActionRegistry`) |
| `ToolbarModel` (M20) | `groups: Observable<readonly ToolbarGroup[]>` (nástroje a akce aktuálního režimu po skupinách, povolení, `active`, `menuOnly`) | `run(item)` |
| `DocumentListModel` (M20) | `list: Observable<DocumentListState>` (`loading` / `loaded` / `failed`), `busy`, `error`, `renaming` | `load`, `retry`, `create`, `importFile`, `remove`, `beginRename`, `commitRename`, `cancelRename` |

- **`ToolbarModel`** (`createToolbarModel({ tools, toolList, actions, locked, mode, contributions })`): logika lišty z dřívějšího `ui/toolbar-groups.ts` (filtr podle režimu, povolení, pořadí skupin) a navíc `ToolbarItem.active` (aktivní nástroj). Obsah lišty režimu nezná, dodá ho příspěvek:
  - **Povolení nástroje bez akce** (M27): nástroj bez klávesové zkratky nemá akci; jeho položka je povolená podle akce, je-li, jinak v režimu `sketch` vždy a v ostatních režimech jen bez zámku (`action?.enabled ?? (mode === 'sketch' || !locked)`) – stejné pravidlo jako akce nástrojů ve vestavěných akcích (ve skicáři se zámek editace nepočítá). Dřív se neprojevilo, protože všechny nástroje skicáře měly zkratku.

  ```ts
  interface ToolbarModeContribution {
    readonly mode: Mode;
    readonly groupOrder: readonly string[];                                          // neuvedené skupiny na konec
    readonly actionButtons: Readonly<Record<string, readonly ToolbarActionButton[]>>; // před nástroji skupiny
    readonly actionGroups: readonly ToolbarActionGroup[];                            // za nástroji, v pořadí registrace
  }
  interface ToolbarActionButton { readonly id: string; readonly icon: string; readonly menuOnly?: boolean }
  interface ToolbarActionGroup { readonly actionGroup: string; readonly toolbarGroup: string; icon(actionId: string): string }
  ```

  Režim `model` a společná tlačítka všech režimů (historie, zobrazení) jsou vestavěné. Dva příspěvky pro tentýž režim jsou chyba sestavení (výjimka). Skicář dodá `SKETCH_TOOLBAR` (revize M20: `interaction` dřív obsah lišty skicáře znal, i když ho neimportoval).
  Známá mez: `ToolDescriptor.group` je uzavřený výčet a obsahuje skupiny skicáře `draw` a `constrain`, takže jejich jména `interaction` pořád zná. Čistá `toolbarGroups(input)` je vedle modelu kvůli testům. `ui` si nechává jen rozložení do šířky a přetečení (`ui/toolbar-fit.ts`). Sestavuje ho `createAppSession`, `AppSession.toolbar` je bez `dispose`.
- **`DocumentListModel`** (`createDocumentListModel({ catalog, confirm })`): stavy načítání (načtení nikdy neodmítne, chyba je `failed` se „Zkusit znovu“), `busy` blokuje druhou akci, potvrzení smazání přes `confirm(request: ConfirmRequest)` (klíč a parametry, překládá `ui`, jako u vestavěných akcí), pořadí smazání a znovunačtení, přejmenování na místě a import (`importFile(readText)`, čtení souboru i `JSON.parse` běží pod `busy`). Seznam dokumentů dodá port `DocumentCatalog { list, create, importFile, remove, rename }` definovaný v `interaction`; adaptér `createDocumentCatalog` je v `app/documents.ts`. Model nedrží nic mezi voláními, proto nemá `dispose`.

Společná pravidla snapshotů:
- Model vystavuje `ObservableValue.asObservable()`, nikdy samotnou `ObservableValue` (přetypováním by šlo zapisovat, revize M9). Závislosti dostává v nejužší potřebné podobě: `RegistryReader` místo registru, `SelectionCommands` místo `SelectionModel`, `Pick<FeatureEditor, …>` místo celého editoru ([[0011-programovani-proti-rozhranim|ADR 0011]]).
- Snapshot je zmrazený ([[Neměnná data]]). Nový snapshot vzniká jen při skutečné změně obsahu; beze změny `subscribe` nic nedostane.
- Položky pole, které se nezměnily, jsou v novém snapshotu **tytéž objekty** (`===`). UI tak překreslí jen změněné řádky.

## Výběr

```ts
export type SelectionItem =
  | { kind: 'feature'; feature: FeatureId }
  | { kind: 'body'; body: BodyId }
  | { kind: 'face'; body: BodyId; faceIndex: number; name?: TopoName }   // name doplní model z RegenBody.names (M14)
  | { kind: 'edge'; body: BodyId; edgeIndex: number; name?: TopoName }
  | { kind: 'plane'; plane: PlaneId };   // M12: rovina z Prohlížeče (vstup do skici)

export interface SelectionModel {
  readonly items: Observable<readonly SelectionItem[]>;
  set(items: readonly SelectionItem[]): void;
  toggle(item: SelectionItem): void;
  clear(): void;
  dispose(): void;              // odhlásí se od RegenStatusPort; výběr dál funguje, jen se po regeneraci nepřemapuje
}

/** Co dostávají spotřebitelé výběru (nástroje, strom): bez dispose, ten patří app (revize M9). */
export type SelectionCommands = Omit<SelectionModel, 'dispose'>;

export function createSelectionModel(deps: { regen: RegenStatusPort }): SelectionModel;
export function sameSelectionItem(a: SelectionItem, b: SelectionItem): boolean;

/** Zrcadlí položky face/edge/body výběru (a od M13 oblasti, od M14 topo a bodies reference otevřeného dialogu) do HighlightPort.setSelection; vrací odhlášení. */
export function bindSelectionHighlight(selection: SelectionModel, highlight: HighlightPort, editor?: Pick<FeatureEditor, 'current'>, regen?: RegenStatusPort): Unsubscribe;
```

- Výběr je **dočasný stav session**, neukládá se do dokumentu ani do logu.
- Položky se porovnávají hodnotou (`sameSelectionItem`: druh + id + index). Výběr neobsahuje duplicity a drží pořadí, v jakém položky přibyly.
- `set` odstraní duplicity (první výskyt vyhrává). `set` se stejným obsahem nic nevyšle.
- `toggle`: položka ve výběru → odebere ji; jinak ji přidá na konec.
- Model ukládá zmrazené kopie položek jen s poli jejich druhu, nikdy objekt volajícího (předaný `PickResult` tak do výběru nezanese `point` a `normal`). Položka, která už ve výběru je, zůstává v novém snapshotu týmž objektem.
- `clear` na prázdném výběru nic nevyšle.
- Indexy ploch/hran platí jen pro aktuální regeneraci. **Jméno** (M14, [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R102]], nahrazuje pravidlo [[Q064 Výběr po regeneraci|Q064]]): `set`/`toggle` doplní položce `face`/`edge` `name` z `RegenBody.names` posledního snapshotu (`nameOfFace`/`nameOfEdge`; těleso nebo jméno chybí → položka bez `name`); jméno od volajícího se ignoruje. `sameSelectionItem` jméno neporovnává. Když `RegenStatusPort` ohlásí novou `generation`, položka `face`/`edge` s jménem se nahradí položkami pro **všechny** indexy `names.faces(name)` / `edges(name)` těla v novém snapshotu (vzestupně, na místě původní položky, bez duplicit – při shodě vyhrává první v pořadí výběru); přemapovaná položka nese jméno, podle kterého se mapovala, ne primární jméno nového indexu ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R116]]); položka bez jména, s tělesem, které v novém snapshotu není, nebo s jménem, které zaniklo, vypadne. Beze změny obsahu se nový snapshot nevyšle. Položky `feature`, `body` a `plane` zůstávají.
- `bindSelectionHighlight` při každé změně předá `HighlightPort.setSelection` položky `face`/`edge` a od M14 `body` (`{ kind: 'body', body }`, [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R104]]) v pořadí výběru (ihned při navázání i jednou). Zvýraznění `feature` přibude s potřebou. S `editor` (M13, [[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R76]]) přidá za ně reference viditelných parametrů druhu `region` otevřené session jako `{ kind: 'sketchRegion', sketch: sketchId(ref.sketch), region }` (kresba skici z regenerace má id artefaktu) a sleduje `editor.current` i `state` session. **M14:** s `regen` přidá i reference viditelných parametrů `topo` – pro každou `TopoRef` cíle `face`/`edge` pro všechny indexy `faces(name)`/`edges(name)` tělesa v posledním snapshotu (podle `spec.entity`; nevyřešená reference nic) – a `bodies` jako `{ kind: 'body', body }`; pořadí: výběr, pak parametry v pořadí schématu; duplicitní cíle se vynechají; sleduje i `regen.state`. Bez `regen` jen `region` jako v M13.
- Filtr výběru (jen plochy, jen hrany…) nastavuje aktivní nástroj nebo parametr dialogu.

## Nástroje

```ts
export interface Tool {
  activate(ctx: ToolContext): void;
  deactivate(): void;
  onPointer?(e: ViewPointerEvent): void;
  onKey?(e: ViewKeyEvent): boolean;      // true = událost zpracována
}

/** Viewport, jak ho vidí nástroj: picking, paprsky, overlay a hover. */
export interface ToolViewport extends Pick<ViewportPort, 'pick' | 'screenToRay' | 'overlay'> {
  readonly highlight: Pick<HighlightPort, 'setHover'>;
}

/** FeatureEditor, jak ho používá nástroj: otevře dialog nové featury. */
export type ToolFeatures = Pick<FeatureEditor, 'create' | 'current'>;

export interface ToolContext {
  readonly viewport: ToolViewport;
  readonly selection: SelectionCommands;
  readonly doc: DocumentReader;
  readonly ids: IdGenerator;
  readonly features: ToolFeatures;       // dokument mění nástroj jen přes dialog featury (Q069)
  finish(): void;                        // nástroj skončil → ToolManager přepne na výchozí
}

export interface ToolDescriptor {
  readonly id: string;
  readonly label: string;
  readonly icon: string;                 // název ikony, UI si ji přeloží
  readonly group: 'select' | 'primitive' | 'sketch' | 'feature' | 'modify' | 'draw' | 'constrain';   // 'draw', 'constrain' od M12 (lišta skicáře)
  readonly modes?: readonly Mode[];      // režimy, ve kterých nástroj je; výchozí ['model'] (M12)
  readonly shortcut?: string;            // jen informace pro UI; zkratku registruje app jako akci
  readonly family?: string;              // M27: nástroje stejné rodiny ve skupině = jedno dělené tlačítko v liště ([[12-skicar#Oblouky a kružnice (M27)]])
  create(): Tool;
}

export type ToolRegistry = Registry<ToolDescriptor>;   // klíč = id, viz core
export function createToolRegistry(): ToolRegistry;

export interface ToolManager {
  readonly active: Observable<string>;   // id aktivního nástroje
  activate(id: string): void;            // deaktivuje předchozí
  dispose(): void;                       // odhlásí se od událostí, deaktivuje aktivní nástroj
}

export function createToolManager(deps: {
  registry: RegistryReader<ToolDescriptor>;
  ctx: Omit<ToolContext, 'finish'>;
  /** Události viewportu (ukazatel, klávesy); nástroj je dostává přes Tool, ne přes ctx. */
  viewportEvents: Subscribable<ViewportEvents>;
  defaultToolId: string;
  /** Klávesy z viewportu, které nástroj nezpracoval (app sem napojí ActionRegistry.handleKey). */
  unhandledKey?: (e: ViewKeyEvent) => boolean;
  /** Vrstvy vstupu nad aktivním nástrojem, shora dolů (viz Směrování v ToolManager); výchozí []. */
  layers?: readonly InputLayer[];
}): ToolManager;

/** Vrstva vstupu nad nástrojem (M20, A4): true = událost zpracovaná, dál nejde. */
export interface InputLayer {
  onPointer(e: ViewPointerEvent): boolean;
  onKey(e: ViewKeyEvent): boolean;
  /** Když vrstva převezme move, dostanou vrstvy pod ní jednou syntetický leave; výchozí true. */
  readonly leaveBelow?: boolean;
}

/** refPick jako vrstva: sama sleduje features.current a activeRefParam. */
export function createRefPickLayer(deps: {
  features: Pick<FeatureEditor, 'current'>; viewport: RefPickViewport; doc: DocumentReader;
  regen?: RegenStatusPort;                 // jména těles pro topo; bez něj zásah do topo nic nepřidá
  unhandledKey?: (e: ViewKeyEvent) => boolean;
}): RefPickLayer;

export const SELECT_TOOL: ToolDescriptor;   // id 'select', group 'select'
```

- `ToolContext` je bod rozšíření pro pluginy, a proto nese jen to, co nástroje opravdu volají ([[0011-programovani-proti-rozhranim|ADR 0011]], [[M20-zpevneni-struktury|M20]]). Rozšířit ho později jde zpětně kompatibilně, zúžit ne. Výběrové zvýraznění patří `bindSelectionHighlight`, kresby skic skicáři a manipulátory `ManipulatorController`, proto je nástroj nevidí.
- Nástroj nemá vlastní operace ani transakci: dokument mění jen přes `FeatureEditor` nebo `SketchEditor` ([[Q069 Smí nástroj otevřít vlastní transakci|Q069]], [[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R78]]). Jediné místo, které drží transakci, vylučuje souběh s dialogem.
- `Tool` nemá `id`: identitu nese `ToolDescriptor`, instanci vytváří `create()` při každé aktivaci (nástroj začíná vždy s čistým stavem).
- Vždy je aktivní právě jeden nástroj. `createToolManager` hned aktivuje výchozí (`defaultToolId` musí být v registru, jinak výjimka).
- `activate(id)`: neznámé id → výjimka a aktivní nástroj zůstává. Stejné id jako aktivní → nic. Jinak `deactivate()` předchozího, `create()` + `activate(ctx)` nového, `active` vyšle nové id.
- Každá aktivace dostane vlastní `ctx` s `finish` svázaným s touto instancí. `finish()` neaktivního (starého) nástroje nedělá nic, `finish()` výchozího nástroje také ne.
- `finish()` volaný **uvnitř** `activate` (nástroj typu „otevři dialog a skonči“) se provede až po návratu z `activate`: `active` vyšle id nástroje a hned potom výchozí.
- Výjimka z `descriptor.create()` nebo `tool.activate()`: manager nástroj zahodí (bez `deactivate`), aktivuje výchozí nástroj a výjimku pošle dál; `active` pak ukazuje výchozí. Selže-li sám výchozí nástroj, manager zůstane bez aktivního nástroje (události zahazuje) a výjimka letí dál – chyba programátora; selhal-li předtím jiný nástroj, letí `AggregateError` s oběma chybami. `createToolManager` spouští výchozí nástroj před přihlášením k událostem, takže při jeho selhání nic nezůstane přihlášené.
- Po `dispose` hodí `activate` výjimku, druhé `dispose` nic nedělá.
- `ToolManager` přeposílá `pointer` a `key` z `ViewportPort.events` aktivnímu nástroji. Klávesa: nejdřív `tool.onKey`; když vrátí `false` nebo ho nemá, `Escape` bez modifikátorů mimo textové pole ukončí nevýchozí nástroj (návrat k výchozímu). Ostatní nezpracované klávesy jdou do `unhandledKey`.
- **Referenční parametr dialogu** ([[Q066 Klik do referenčního parametru|Q066]]): vrstva `refPick` (`createRefPickLayer`) sama sleduje `features.current` a `state` aktuální session. Dokud má session `activeRefParam !== null`, bere všechny události (vrací `true`) a aktivní nástroj je nedostane (ten zůstává aktivní, `active` se nemění, jen je dočasně „zakrytý“; nedostane `deactivate` a jeho hover obnoví až další `move`). `refPick` není `Tool` z registru. Chování podle druhu parametru bere z tabulky druhů (níže): `move` → hover, když `hovers(hit)`; levý klik → `fromHit(hit, value)` a nová hodnota přes `setParam` (zásah, který druh nepřevede, se ignoruje); `Escape` → `focusRefParam(null)`. Filtr pickingu se odvozuje při každé události z `pickFilter(spec)` aktivního parametru a platí i pro hover; při změně `activeRefParam` `refPick` zruší hover (`setHover(null)`). **Mezistav:** při otevřené session `refPick` zásahy ignoruje (nepickuje, zruší hover, klik nic nezapíše), dokud `snapshot.pick.feature !== session.featureId`, tedy dokud regenerace s posunutou lištou nezveřejní vstup editované featury ([[0025-vstupni-stav-editovane-featury|ADR 0025]]). Featura otevřené session stojí vždy před lištou, takže vstup existuje. Bez portu regenerace (`regen` v `createRefPick` je volitelné, jen testy) mezistav neplatí. Převod zásahu plochy nebo hrany na jméno (`topo`) dělá jediné místo `nameOfHit(snapshot, body, kind, index)` v `regen-status-port.ts` nad `snapshot.pick.bodies`, sdílené se `SelectionModel` a `TopoInspector`; zásah bez jména se ignoruje ([[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R103]]).
- **Tabulka druhů referencí** ([[M20-zpevneni-struktury|M20]], A2): `REF_KIND_BEHAVIOR` v `interaction/ref-kinds.ts` (vnitřní) má pro každý `RefParamKind` z [[03-dokument]] jeden záznam `RefKindBehavior` a chybějící druh je chyba typu (`satisfies`). `refPick`, `bindSelectionHighlight`, `FeatureEditor` a `BrowserModel` z ní jen čtou:

  ```ts
  interface RefKindBehavior<S extends RefParamSpec = RefParamSpec> {
    readonly focusable: boolean;          // jde do něj kliknout v dialogu
    readonly autoFocus: boolean;          // create ho aktivuje jako první referenční parametr
    pickFilter(spec: S): PickFilter;
    hovers(hit: PickResult, ctx: RefHitContext): boolean;
    fromHit(hit: PickResult, value: unknown, ctx: RefHitContext): { value: unknown } | null;   // null = zásah se ignoruje; { value: null } u osy = vymazat
    highlightTargets(value: unknown, spec: S, snapshot: RegenSnapshot | undefined): readonly HighlightTarget[];
    browserAccepts(target: 'body' | 'plane' | 'axis' | 'region'): boolean;
    chips(value: unknown, spec: S, doc: DocumentReader): readonly FieldRef[] | null;
    refText(value: unknown, doc: DocumentReader): RefText | null;
    preselect(snapshot: RegenSnapshot): { value: unknown } | null;   // předvýběr při create
  }
  ```

  | Druh | `pickFilter` | Klik | Prohlížeč |
  |---|---|---|---|
  | `bodies` | plocha, hrana (zásah = těleso) | přidat/odebrat `{ kind: 'body' }` | těleso |
  | `topo` | plocha nebo hrana podle `entity` (vrchol `[]`, R101) | přidat/odebrat `TopoRef` přes jméno | ne |
  | `region` | oblast skici (ne `'sketch-edit'`) | přidat/odebrat `SketchRegionRef` | oblast |
  | `axis` | entita skici (osa počátku, úsečka) | nastavit, stejná znovu = vymazat | osa |
  | `planes` | plocha, entita kresby (rovina počátku) | nahradit jedinou položku: kresba s id roviny (`parsePlaneId`) → `PlaneRef`, plocha se jménem v `pick` → `TopoRef`; stejná rovina nic | rovina |

  `planes` je `focusable`, ale ne `autoFocus`, a má `pickEndsFocus: true`: zásah, který druh převede, fokus zruší i bez změny hodnoty (`refPick` i `BrowserModel.selectPlane`), takže výběr roviny skončí i klikem na tutéž rovinu. `planes` (skicář se nemá otevřít ve výběru roviny); text čipu je popisek roviny počátku, u plochy `field.planeFace` se jménem tělesa ([[Q076 Rovina a hrany z Prohlížeče do referenčního parametru|Q076]], [[M21-vstupni-stav-editovane-featury|M21]]). `highlightTargets` u `planes` je prázdné. Prohlížeč nebere `topo` (nemá řádky hran a ploch).

### `SelectTool`

Výchozí nástroj (`SELECT_TOOL`).

| Událost | Chování |
|---|---|
| `move` | `highlight.setHover(viewport.pick(x, y))` |
| `leave` | `highlight.setHover(null)` |
| levé `down` | zapamatuje si pozici |
| levé `up` do `CLICK_TOLERANCE_PX = 4` px od `down` (jinak tažení, nic) | zásah → položka `face`/`edge`; bez Shift `set([položka])`, se Shift `toggle(položka)`. Prázdno: bez Shift `clear()`, se Shift nic |
| `Escape` bez modifikátorů mimo textové pole | neprázdný výběr → `clear()` a vrátí `true`; prázdný → `false` |
| `deactivate` | `setHover(null)` |

Pravé a prostřední tlačítko ignoruje. `mods.mod` a `alt` při kliku zatím nemají význam. Hover se mění i během tažení (orbit kamery), `leave` rozpracovaný klik nezahazuje.

## Dialog featury: `FeatureEditor`

Většina featur se v Onshape vytváří stejně: klik na nástroj → otevře se dialog s výchozími parametry → živý náhled → OK nebo Zrušit. Tenhle tok je obecný a nemusí ho psát každý plugin.

```ts
export interface FeatureEditor {
  /** Vytvoří novou featuru daného typu na pozici rollback baru a otevře pro ni editační session. */
  create(type: string): FeatureEditSession;
  /** Otevře existující featuru k úpravě (dvojklik ve stromu). */
  edit(featureId: FeatureId): FeatureEditSession;
  readonly current: Observable<FeatureEditSession | null>;
}

export function createFeatureEditor(deps: {
  doc: DocumentReader; ops: OperationDispatcher; schemas: RegistryReader<FeatureSchema>; ids: IdGenerator;
  translate?: (key: string) => string;   // výchozí identita; název nové featury = nextFeatureName(studio, translate(schema.label))
  regen?: Pick<RegenStatusPort, 'state'>; // M19.2 D6: create předvybere jedinou oblast poslední skici; bez něj nic
}): FeatureEditor;

export interface FeatureEditSession {   // vytváří ji jen FeatureEditor
  readonly mode: 'create' | 'edit';
  readonly featureId: FeatureId;
  readonly schema: FeatureSchema;
  readonly state: Observable<EditState>;
  setParam(name: string, value: unknown): void;          // → tx.apply(feature.setParams)
  setParams(patch: Readonly<Record<string, unknown>>): void;   // víc parametrů jednou operací (M12, skicář)
  removeRef(name: string, index: number): void;          // × u čipu: → setParam bez položky (M11)
  focusRefParam(name: string | null): void;
  commit(): void;                                        // → tx.commit()
  cancel(): void;                                        // → tx.abort()
}

export interface EditState {
  readonly params: Readonly<Record<string, unknown>>;    // aktuální hodnoty (z dokumentu)
  readonly issues: readonly ParamIssue[];                // evaluateParams(schema, params, NO_VARIABLES).issues
  readonly fields: readonly FieldState[];                // pořadí podle schema.params
  readonly activeRefParam: string | null;                // parametr typu bodies/topo/region, který přijímá výběr
  readonly open: boolean;                                // false po commit/cancel
  readonly name: string;                                 // jméno featury z dokumentu (po zmizení featury poslední známé)
}

export interface FieldState {
  readonly name: string;
  readonly spec: ParamSpec;            // kind, label, min/max… – UI podle něj zvolí ovládací prvek
  readonly value: unknown;
  readonly issue: ParamIssue | null;   // první ParamIssue s param === name (kód, překládá ui – ADR 0014)
  readonly active: boolean;            // name === activeRefParam
  readonly refs: readonly FieldRef[] | null;   // čipy u druhu 'bodies', jeden na položku hodnoty; jinak null (M11)
  readonly hidden: boolean;            // M13: !isParamVisible(spec, params) – dialog pole nekreslí
  readonly group: string | null;       // M13: spec.group (klíč nadpisu sekce)
  readonly heading: string | null;     // M13: klíč skupiny u prvního viditelného pole (druh ≠ 'data') jiné skupiny než předchozí viditelné pole; pole bez skupiny skupinu přeruší; jinak null
  readonly refText: RefText | null;    // M13: text reference u druhu 'axis' s hodnotou; jinak null
}

/** Text reference pro UI (M13): klíč překladu a hodnoty. */
export interface RefText { readonly key: string; readonly params: Readonly<Record<string, string>> }

export interface FieldRef {
  readonly index: number;              // pozice položky v hodnotě
  readonly body: BodyId | null;        // null = položka není odkaz na těleso správného tvaru
  readonly label: string | null;       // bodyRefLabel(doc, body); null = chybějící těleso („Chybí těleso“)
  readonly text: RefText | null;       // M19.1: klíč popisku – topo pořadový (ref.edge/face/vertex, n = index + 1), chybějící těleso field.refs.missing, neplatná položka field.missingRef;
                                       //        u každého čipu je vyplněné právě jedno z label (jméno od uživatele) a text
  readonly missing: boolean;           // M19.1: styl chyby; bodies: label === null, topo: body === null
}
```

**`create(type)`**
1. Předpoklady (jinak výjimka, nic se nezmění): žádná otevřená session, dispečer není v transakci, typ je v `schemas`.
2. `ops.begin(schema.label)`, pak `tx.apply(feature.add)` s `id = ids.next()`, `typeVersion = schema.version`, `params = schema.defaults()`, `suppressed: false`, `index = rollbackIndex`.
   - **Předvýběr oblasti** (M19.2 D6, jako ve Fusion): s `regen` v deps, když první automaticky fokusovaný parametr (pravidlo bodu 5) je druhu `region` a poslední skica posledního stavu regenerace (`regen.state.get().sketches.at(-1)`) má právě jednu oblast, dostane `feature.add` rovnou `params = { ...defaults, [param]: [{ kind: 'region', sketch: <feature skici>, region: <jméno> }] }`. Je to pořád jedna operace `feature.add`, žádný další krok v transakci. Pravidlo je obecné podle druhu parametru (Vysunutí i Rotace), pluginy se nemění. `activeRefParam` zůstává na oblasti, další klik oblast přidá nebo odebere. Výběr roli nehraje: oblast ve výběru nikdy není. Bez `regen`, bez snapshotu nebo s jiným počtem oblastí se nepředvybírá nic.
3. Jméno: `"<schema.label> <n>"`, kde `n` je nejmenší kladné číslo, pro které takové jméno ve studiu ještě není.
4. Vložení na pozici baru posune bar za novou featuru samo (pravidlo mutátoru v [[03-dokument]]), takže nová featura je aktivní ([[Q068 Kam se vloží nová featura|Q068]]).
5. `activeRefParam` nové session = první **viditelný** parametr schématu druhu `bodies`, `topo`, `region` nebo (M13) `axis` (v pořadí schématu), jinak `null` – výběr ve viewportu a v Prohlížeči jde rovnou do něj, jako v Onshape (M11, [[Rozhodnutí noční rychloakce#M11 – Další entity|R19]]). `edit` začíná s `null`.

**`edit(featureId)`**
1. Předpoklady jako u `create`; neznámá featura → výjimka.
2. `ops.begin('feature.edit')` – popisek transakce je klíč překladu ([[0014-preklady-vue-i18n-a-klice|ADR 0014]]), jméno featury do něj nepatří. Je-li `rollbackIndex !== index + 1`, `tx.applyTransient(studio.setRollback(index + 1))`: bar je během editace těsně za editovanou featurou, ať byla před barem, nebo za ním. Pozdější featury se nepřehrávají a náhled ukazuje model ve stavu editované featury ([[Q018 Rollback bar při editaci starší featury|Q018]]). Přechodná operace se při `commit` i `cancel` vrátí sama a do logu se nedostane ([[04-operace-a-historie]]).

**Session**
- `setParam(name, value)`: `name` musí být klíč `schema.params`, jinak výjimka. Nové `params = { ...params, [name]: value }` → `tx.apply(feature.setParams)` s `typeVersion: schema.version` ([[04-operace-a-historie#Migrace dat featur]]). Hodnota se **nekontroluje** před aplikací: neplatné parametry dokument unese, regenerace featuru označí chybou a `issues` je ukážou. `setParam` se stejnou hodnotou (`Object.is` u primitiv) nic neaplikuje. Selže-li handler, výjimka letí dál a session zůstává otevřená beze změny.
- `setParams(patch)` (M12): každý klíč musí být v `schema.params`, jinak výjimka a nic se neaplikuje; nové `params = { ...params, ...patch }` → **jedna** `feature.setParams`; když jsou všechny hodnoty `Object.is` shodné s aktuálními, nic. Jinak pravidla jako `setParam`.
- `removeRef(name, index)` (M11): neznámý parametr → výjimka. Hodnota, která není pole, `index` mimo rozsah (nebo neceločíselný) a zavřená session → nic. Jinak `setParam(name, hodnota bez položky na index)`.
- `params` čte session vždy z dokumentu (jediný zdroj pravdy), `issues` z `evaluateParams` se přepočítají po každé změně. Viditelnost polí se počítá z vyhodnocených parametrů, a když neprojdou, ze surových.
- `refs` (M11): pro každou položku hodnoty parametru druhu `bodies` jeden `FieldRef`; `body` z `bodyOfRef` (ověří tvar id přes `parseBodyId`, hodnota parametru smí být neplatná), `label` z `bodyRefLabel` v `ref-values` (interní, pravidla níže a [[Rozhodnutí noční rychloakce#M11 – Další entity|R25]]). Jména jsou z dokumentu, proto se otevřená session přepočítá i při `doc.events.changed`; nezměněné `refs` zůstávají týž objekt.
- `bodyRefLabel(doc, body)`: featura původu v dokumentu chybí → `null`, i když těleso má jméno v metadatech (metadata smazané featury v dokumentu zůstávají, čip má ukázat „Chybí těleso“); jinak `userName` z metadat, jinak jméno featury původu (u `bodyId(f, n)` s příponou ` (n)`). Nečte poslední regeneraci: náhled booleanu nástroj z mapy těles odebere, ale čip v dialogu ho musí pojmenovat dál.
- `focusRefParam(name)`: `name` musí být **viditelný** parametr druhu `bodies`, `topo`, `region`, (M12) `planes` nebo (M13) `axis`, jinak výjimka (i pro neznámé jméno). Když změna parametrů aktivní parametr skryje, `activeRefParam` se nastaví na `null`.
- `hidden`, `group`, `refText` (M13): `hidden` přes `isParamVisible` z `document` při každém přepočtu; `refText` u `axis` – osa počátku → `{ key: <label z ORIGIN_AXES>, params: {} }`, entita skici → `{ key: 'field.sketchLine', params: { sketch: <jméno featury skici> } }`, featura skici chybí nebo neznámá osa → `{ key: 'field.missingRef', params: {} }`; `null` nebo chybějící hodnota → `null`; neplatná nenulová hodnota → `{ key: 'field.missingRef', params: {} }` (pole ji tak umí smazat). Nezměněné `FieldState` zůstává týž objekt (porovnávají se i nová pole). `null` zruší fokus. Stejné jméno znovu nevytvoří nový snapshot.
- `commit()`: `tx.commit()` → session zavřená (`open: false`), `editor.current` → `null`. Celý dialog je v logu **jeden** záznam. `commit` je povolený i s `issues` (featura s chybou je v Onshape také platný stav).
- `cancel()`: `tx.abort()` → dokument i log beze změny, session zavřená, `current` → `null`.
- Po zavření hodí každý příkaz výjimku – kromě `removeRef`, který nic neudělá (× u čipu může přijít z doznívajícího UI). Poslední snapshot má `open: false` a `activeRefParam: null`; `params` drží poslední známé hodnoty (po zrušeném `create` featura v dokumentu už není).
- Session se zavře, až transakce opravdu skončí (`!ops.inTransaction`), i když odběratel při `commit`/`abort` vyhodí.
- Selže-li hned po `begin` `feature.add` nebo přechodný posun baru, `FeatureEditor` transakci zruší a výjimku pošle dál; session nevznikne.
- Během otevřené session jsou undo/redo zakázané (pravidlo transakcí, `UndoManager.canUndo()` vrací `false`).

Díky tomu je nástroj pro většinu featur triviální – `ToolDescriptor`, jehož `create()` vrací nástroj, který při aktivaci zavolá `ctx.features.create('box')` a skončí (je-li už otevřená jiná session, jen skončí). Interaktivní tvorbu tažením myší si plugin může dopsat jako vlastní `Tool`, který mezivýsledky posílá přes `FeatureEditSession.setParam` (z M13 vypuštěno, nápad v [[M15-export-a-dokonceni]], [[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R79]] ⚠).

## Manipulátory (M18)

[[Manipulátor|Manipulátory]] jsou úchyty ve viewportu, jejichž tažením se mění parametry featury s otevřeným dialogem ([[0021-manipulatory-kotvy-z-regenerace|ADR 0021]]). Geometrii, kterou zná jen regenerace, dostávají jako [[Kotva manipulátoru|kotvy]] z `RegenSnapshot.anchors`. Živou část polohy počítají z aktuálních params. Do dokumentu zapisují přes `FeatureEditSession.setParams`, takže OK, Zrušit, undo i slučování v logu fungují beze změny. Od M19 má manipulátor režimy, úchyty se dvěma a třemi stupni volnosti a [[HUD manipulátoru|HUD]] (lišta režimů a editovatelné pole hodnoty, [[0022-rezimy-a-hud-manipulatoru|ADR 0022]]).

### Deskriptor a úchyty (`manipulators.ts`)

```ts
export type HandleTint = 'x' | 'y' | 'z' | 'neutral';
export type HandleUnit = 'length' | 'angle';      // mm a radiány, jako dokument (spec 01)
export type Patch = Readonly<Record<string, unknown>>;

interface HandleBase {
  readonly id: string;                             // stabilní mezi voláními frame() ('tx', 'rz', 'distance')
  readonly unit: HandleUnit;
  readonly tint: HandleTint;
  readonly dashed?: boolean;                       // M19: čárkovaný glyf (režim pivotu)
}
/** Skalární úchyt: jedna hodnota, štítek a editovatelné pole. */
interface ScalarHandle extends HandleBase {
  readonly value: number;                          // aktuální hodnota čočky z params
  readonly min?: number;                           // včetně; ořez po přichycení
  readonly max?: number;
  /** Zobrazená hodnota = value · displayScale (symetrické vysunutí: 2); výchozí 1 (M19, nahrazuje display()). */
  readonly displayScale?: number;
  /** Změna params pro novou hodnotu (jen klíče, které úchyt mění). */
  toParams(value: number): Patch;
}
export interface LinearHandle extends ScalarHandle {
  readonly kind: 'linear';
  readonly position: Vec3;                         // kde stojí glyf (začátek šipky)
  readonly direction: Vec3;                        // jednotkový; kladné value = po směru
}
export interface AngularHandle extends ScalarHandle {
  readonly kind: 'angular';
  readonly center: Vec3;
  readonly axis: Vec3;                             // jednotkový; kladný úhel = proti směru hodin při pohledu proti axis
  readonly zero: Vec3;                             // jednotkový, kolmý na axis; vztažný směr pro měření úhlu
  readonly extent: 'quarter' | 'full';             // M19: čtvrtkruh od zero k axis × zero, nebo celá kružnice
}
/** M19: posun ve dvou směrech najednou (čtverec mezi osami). */
export interface PlanarHandle extends HandleBase {
  readonly kind: 'planar';
  readonly origin: Vec3;                           // roh čtverce u středu manipulátoru
  readonly u: Vec3;                                // jednotkové, navzájem kolmé
  readonly v: Vec3;
  readonly value: readonly [number, number];
  toParams(value: readonly [number, number]): Patch;
}
/** M19: volný posun v rovině kolmé na pohled (střed manipulátoru). */
export interface PointHandle extends HandleBase {
  readonly kind: 'point';
  readonly position: Vec3;
  readonly value: Vec3;
  toParams(value: Vec3): Patch;
}
export type Handle = LinearHandle | AngularHandle | PlanarHandle | PointHandle;

/** M19: režim manipulátoru; label je klíč překladu (ADR 0014), icon jméno ikony (Tabler) pro ui. */
export interface ManipulatorMode {
  readonly id: string; readonly label: string; readonly icon: string;
  readonly picksPoint?: boolean;                   // v režimu bere controller klik na model a volá pickPoint (výchozí false)
}
/** M19: výsledek deskriptoru – bod, u kterého stojí lišta, a úchyty. */
export interface ManipulatorFrame { readonly center: Vec3; readonly handles: readonly Handle[] }

export interface ManipulatorDescriptor<P = unknown, A extends FeatureAnchors = FeatureAnchors> {
  readonly type: string;                           // typ featury
  /** M19: režimy; první je výchozí. Bez režimů je mode ''. Lišta jen při dvou a více režimech. */
  readonly modes?: readonly ManipulatorMode[];
  /** Čistá funkce; volá se jen s platnými params (issues = []) a s kotvami featury; null = žádné úchyty. */
  frame(params: P, anchors: A, mode: string): ManipulatorFrame | null;
  /** M19: klik na model (plocha, hrana) v režimu → změna params, null = klik se ignoruje. */
  pickPoint?(params: P, anchors: A, mode: string, point: Vec3): Patch | null;
}

export type ManipulatorRegistry = Registry<ManipulatorDescriptor>;   // klíč = type
export function createManipulatorRegistry(): ManipulatorRegistry;
```

- `frame` a `pickPoint` jsou zapsané jako **metody** (bivariance, jako `FeatureBuilder.build`), aby šel `ManipulatorDescriptor<TransformParams>` předat jako `ManipulatorDescriptor`. M19 přejmenovává `handles()` na `frame()`, protože vrací i `center`.
- Id úchytů jedné featury jsou unikátní napříč režimy (`tx` v režimu Volný a `px` v režimu pivotu jsou různé úchyty).
- Úchyt nesmí záviset na kotvě odvozené z parametru, který sám táhne (invariant kotev, [[07-regenerace#Kotvy manipulátorů (M18)]]).

### Port (`viewport-port.ts`)

```ts
export type HandleState = 'idle' | 'hover' | 'active';
interface ViewBase { id: string; tint: HandleTint; state: HandleState; dashed: boolean }
export type HandleView =
  | ViewBase & { kind: 'linear'; position: Vec3; direction: Vec3 }
  | ViewBase & { kind: 'angular'; center: Vec3; axis: Vec3; zero: Vec3; extent: 'quarter' | 'full' }   // zero od M19 (čtvrtkruh)
  | ViewBase & { kind: 'planar'; origin: Vec3; u: Vec3; v: Vec3 }                                      // M19
  | ViewBase & { kind: 'point'; position: Vec3 };                                                      // M19

export interface ManipulatorPort {
  set(handles: readonly HandleView[]): void;       // vždy celý stav, [] = nic
  pick(x: number, y: number): string | null;       // id úchytu pod kurzorem (podle posledního set)
}
```

- Pro HUD přidává M19 do `ViewportPort` `project(world)` a událost `viewChanged` ([[#Port viewportu]]).

- Port je zrcadlo jako `HighlightPort`: stav drží controller a předává ho vždy celý. Pohled nenese funkce ani `value`.
- M19 ruší `setLabel`: text u úchytu kreslí `ui` jako pole HUD.
- `FakeViewport` zaznamená `manipulatorViews`, umí připravit výsledek `pick` (`prepareHandlePick((x, y) => id | null)`, výchozí `null`) a `project` (`prepareProject(fn)`, výchozí `null`) a vyslat `viewChanged`.

### Matematika tažení (`manipulator-drag.ts`, čisté funkce)

```ts
export const SNAP_STEP: Readonly<Record<HandleUnit, number>> = { length: 1, angle: Math.PI / 36 };   // 1 mm, 5°
export const PARALLEL_LIMIT = 0.999;   // |direction · ray| nad touto mezí → lineární tah neurčitý
export const EDGE_ON_LIMIT = 0.02;     // |axis · ray| pod touto mezí → rovina kružnice z hrany, úhel neurčitý
export interface Ray { readonly origin: Vec3; readonly direction: Vec3 }

/** Parametr t bodu přímky position + t·direction nejbližšího k paprsku; null pro téměř rovnoběžný paprsek. */
export function linearParam(position: Vec3, direction: Vec3, ray: Ray): number | null;
/** Úhel průsečíku paprsku s rovinou (center, axis) od zero v (−π, π], kladný podle axis; null z hrany. */
export function angularParam(center: Vec3, axis: Vec3, zero: Vec3, ray: Ray): number | null;
/** M19: souřadnice (a, b) průsečíku paprsku s rovinou (origin, u × v) v bázi u, v; null z hrany (|n · ray| < EDGE_ON_LIMIT). */
export function planarParam(origin: Vec3, u: Vec3, v: Vec3, ray: Ray): readonly [number, number] | null;
/** M19: průsečík paprsku s rovinou kolmou na paprsek, která prochází position (bod na paprsku nejbližší k position). */
export function pointParam(position: Vec3, ray: Ray): Vec3;
/** next − prev převedené do (−π, π] (rozbalení přes ±π). */
export function unwrapDelta(prev: number, next: number): number;
/** Přichytí na násobek SNAP_STEP[unit] (fine = bez přichycení), pak ořízne na [min, max]. */
export function snapValue(value: number, h: { unit: HandleUnit; min?: number; max?: number }, fine: boolean): number;
```

- **Lineární tah:** při stisku `t₀ = linearParam(…)`, při pohybu `raw = value₀ + (t − t₀)`. `t = null` → pohyb se ignoruje (hodnota zůstane).
- **Úhlový tah:** při stisku `a₀`, při každém pohybu `acc += unwrapDelta(aPrev, a)`, `aPrev = a`, `raw = value₀ + acc`. Tah tak umí víc než jednu otáčku. `a = null` → pohyb se ignoruje.
- **Rovinný tah** (M19): při stisku `(a₀, b₀)`, při pohybu `raw = value₀ + (a − a₀, b − b₀)`; `null` → pohyb se ignoruje. Přichycení po složkách (`snapValue` s `unit: 'length'`).
- **Bodový tah** (M19): při stisku `q₀ = pointParam(position, ray)`; rovina tahu je kolmá na paprsek **při stisku** a během tahu se nemění (orbit kamery během tahu nejde, pravé tlačítko se ignoruje). Při pohybu průsečík s touto rovinou `q`, `raw = value₀ + (q − q₀)`, přichycení po složkách.
- Paprsek se ve všech funkcích bere jako celá přímka (záporné `s` u průsečíku se nezahazuje). V ortografické kameře leží úchyt vždy před počátkem paprsku na blízké rovině, takže to nevadí. Směry se normalizují uvnitř, `linearParam` vrací `t` v jednotkách zadaného `direction`. `u` a `v` rovinného úchytu se nenormalizují: kontrakt úchytu je chce jednotkové a kolmé, souřadnice jsou pak prosté průměty.
- Přichycení je na **absolutní** hodnotu (`Math.round(raw / step) * step`), ne na přírůstek. Ořez až po přichycení. `snapValue` vrací `−0` jako `0`.

### `ManipulatorController` (`manipulator-controller.ts`)

```ts
export interface ManipulatorController extends Disposable {
  /** Vrstva událostí pro ToolManager; true = událost zpracovaná, dál nejde. */
  onPointer(e: ViewPointerEvent): boolean;
  onKey(e: ViewKeyEvent): boolean;
  /** M19: HUD pro ui; null = žádný manipulátor. */
  readonly hud: Observable<ManipulatorHud | null>;
  /** M19: přepne režim (id z hud.modes); neznámé id nebo bez manipulátoru → nic. */
  setMode(id: string): void;
  /** M19: zapíše zobrazenou hodnotu skalárního úchytu z pole HUD (value = shown / displayScale, přichycení ne, ořez ano). */
  setValue(handleId: string, shown: number): void;
}

export function createManipulatorController(deps: {
  features: Pick<FeatureEditor, 'current'>;
  regen: RegenStatusPort;
  registry: RegistryReader<ManipulatorDescriptor>;
  viewport: Pick<ViewportPort, 'manipulators' | 'screenToRay' | 'pick'>;   // pick od M19 (pickPoint)
}): ManipulatorController;   // formatValue zaniká (M19): hodnotu formátuje ui
```

**Úchyty.** Controller sleduje `features.current`, `state` otevřené session a `regen.state`. Po každé změně spočítá rámec:

- `frame = descriptor.frame(params, anchors, mode)`, když je session otevřená, v registru je deskriptor pro `session.schema.type`, `evaluateParams` nad živými params vrátí parametry (controller ho volá sám, `EditState` vyhodnocené parametry nenese) a jsou známé kotvy pro `session.featureId`. Jinak žádný rámec (`[]`, `hud` `null`). Každý builder kotvy vrací vždy ([[07-regenerace#Kotvy manipulátorů (M18)]]).
- **Poslední známé kotvy:** controller si pro otevřenou session pamatuje poslední kotvy, které snapshot pro editovanou featuru nesl, a novější je přepíšou. Když snapshot kotvy nemá (featura po tahu spadla do chyby), úchyty se počítají z posledních známých, takže tahem jde chybu vrátit. Paměť se maže se zavřením session, změnou editované featury a v `dispose`. Nová featura bez první úspěšné regenerace úchyty nemá.
- Výsledek pošle `viewport.manipulators.set(...)` jako pohledy se stavem (`active` pro tažený úchyt, `hover` pro úchyt pod kurzorem, jinak `idle`). Stejný seznam pohledů jako minule se znovu neposílá (porovnání po polích).
- **Během tažení** se místo kotev ze snapshotu používají kotvy zmrazené při stisku a režim se nemění (`setMode` během tahu nic). Když `issues` během tažení neprázdné, zůstanou poslední pohledy.

**Události:**

| Událost | Bez tažení | Při tažení |
|---|---|---|
| `move` | `id = manipulators.pick(x, y)` → hover úchytu; vrátí `id !== null`; v režimu s `picksPoint` vrátí `true` i nad modelem (spodní vrstva nedostane hover) | spočítá hodnotu (výše), přichycení (`fine = mods.shift`); liší-li se od poslední → `session.setParams(handle.toParams(v))`; skalární úchyt aktualizuje pole HUD; `true` |
| levé `down` | `manipulators.pick(x, y)` vrátí id úchytu: začne tažení (paprsek z `screenToRay`, počáteční parametr, zmrazí úchyt, kotvy a režim, uloží původní hodnoty klíčů `toParams(value)` z params, stav `active`; skalární úchyt se stane úchytem pole HUD), `true`; je-li počáteční parametr `null` → `false`. Mimo úchyt v režimu s `picksPoint`: zapamatuje si pozici, `true` | `true` (ignoruje) |
| levé `up` | po `down` mimo úchyt v režimu s `picksPoint` a do `CLICK_TOLERANCE_PX` od něj: `hit = viewport.pick(x, y, ['face', 'edge'])`, `patch = pickPoint(…, hit.point)`, není-li `null` → `session.setParams(patch)`; `true`. Jinak `false` | konec tažení, hover znovu z `pick`; `true` |
| pravé, prostřední | `false` (kamera) | `true` (ignoruje) |
| `leave` | zruší hover; `false` | `true` (ukazatel je zachycený, tah pokračuje) |
| `Escape` | `false` | `session.setParams(původní hodnoty)`, konec tažení; `true` |

- Přerušený tah: `pointercancel` přichází z viewportu jako levé `up` (spec 09, Události), takže tah skončí s posledním zapsaným stavem.
- Matematika tažení (`manipulator-drag.ts`) není veřejné API modulu, používá ji jen controller.
- `Escape` ruší tah s jakýmikoli modifikátory (ne `isPlainEscape`): uživatel může kvůli jemnému tahu ještě držet Shift.
- Původní hodnoty jsou hodnoty params pro klíče, které vrací `toParams`. U úchytu, který mění víc klíčů (pivot: `pivot`, `pivotPoint`, `translate`), Esc vrátí všechny.
- Session zavřená během tažení (Zrušit nebo OK z dialogu) → tažení skončí bez zápisu, pohledy `[]`, `hud` `null`.
- `dispose`: odhlásí se, pošle `set([])` a `hud` `null`. Druhé `dispose` nic.
- Tažení otevírá transakci jen dialog. Controller nikdy nevolá `ops`, jen session (Q069).
- V režimu s `picksPoint` bere controller levé klikání nad modelem sám, takže referenční parametr dialogu (`refPick`) a nástroj v tu chvíli klik nedostanou. Přepnutím do jiného režimu se chování vrátí.

### Režimy a HUD (M19)

[[HUD manipulátoru]] je prezentační model ([[0010-prezentacni-model|ADR 0010]]) lišty režimů a pole hodnoty, které `ui` kreslí nad viewportem ([[0022-rezimy-a-hud-manipulatoru|ADR 0022]]).

```ts
export interface ManipulatorHud {
  readonly modes: readonly { readonly id: string; readonly label: string; readonly icon: string; readonly active: boolean }[];   // [] = bez lišty (žádný nebo jeden režim)
  readonly center: Vec3;                   // frame.center: lišta stojí vpravo nahoře od jeho průmětu
  readonly field: HudField | null;
}
export interface HudField {
  readonly handleId: string;
  readonly kind: 'linear' | 'angular';   // ui podle něj volí odsazení pole (revize M19)
  readonly at: Vec3;                       // linear: position, angular: center
  readonly direction: Vec3;                // jednotkový směr ve světě, podél kterého ui pole odsune: linear = direction, angular = zero otočené o 45° kolem axis (střed čtvrtkruhu)
  readonly value: number;                  // zobrazená hodnota (value · displayScale)
  readonly unit: HandleUnit;
  readonly tint: HandleTint;               // ui ukáže X/Y/Z
  readonly dragging: boolean;              // true během tahu (pole jen ukazuje), false = editovatelné
}
```

- **Režim** je stav UI, ne dokumentu. Při otevření session (nové `features.current`) je výchozí první režim deskriptoru. `setMode(id)` přepne, přepočítá rámec, zruší hover a pole HUD (`field: null`). Stejné id nic.
- **Umístění pole:** `ui` promítne `at` a `at + direction`, ze dvou bodů vezme směr na obrazovce a pole postaví `FIELD_OFFSET_PX` od průmětu `at` (lineární 96 px = šipka 80 + 16, úhlový 88 px = poloměr 72 + 16). Délky glyfů tak `interaction` znát nemusí.
- **Pole HUD** patří poslednímu použitému skalárnímu úchytu: úchyt, za který se táhlo, nebo na který se jen kliklo (levé `down` + `up` bez pohybu, hodnota se nezmění). Pole drží hodnotu z aktuálního rámce (po změně params z dialogu se aktualizuje). Zmizí, když úchyt v rámci není (jiný režim, jiný typ konce u Extrude). Rovinný a bodový úchyt pole nemají.
- `setValue(handleId, shown)`: během tahu nic; úchyt musí být v aktuálním rámci a skalární, jinak nic. Hodnota, která není konečné číslo (`NaN`, ±`Infinity`), → nic (M19.1). `v = shown / (displayScale ?? 1)`, ořez na `[min, max]` bez přichycení; liší-li se od `value` → `session.setParams(toParams(v))`.
- `hud` je nový objekt jen při změně obsahu (porovnání po polích, vektory po složkách), aby se Vue nepřekreslovalo při každém snapshotu.

### Směrování v `ToolManager`

`ToolManager` nezná konkrétní vrstvy ([[M20-zpevneni-struktury|M20]], A4). `app` skládá `layers: [manipulátory, refPick]`, takže pořadí je **manipulátory → `refPick` → aktivní nástroj**. `ManipulatorController` tvarem splňuje `InputLayer` beze změny.

- `pointer` jde vrstvám shora dolů. Když vrstva vrátí `true`, dál nejde. Když vrátí `true` pro `move` a spodní vrstva naposledy dostala něco jiného než `leave`, dostane spodní vrstva jednou syntetický `{ ...e, type: 'leave' }` (na začátku se bere, že `leave` ještě nedostala), aby po ní nezůstal hover pod úchytem.
- Syntetický `leave` (výše) platí pro každou vrstvu s `leaveBelow !== false` a každá úroveň si pamatuje, jestli už `leave` dostala. `refPick` má `leaveBelow: false`: kreslí hover do stejného `HighlightPort` jako nástroj, takže `leave` doručený nástroji by jeho hover hned smazal, a zakrytý nástroj nemá dostat nic.
- Klávesa jde vrstvám shora dolů, pak `tool.onKey`, Escape, `unhandledKey`. `refPick` bere při aktivním parametru všechny klávesy; co sám nezpracuje, pošle do `unhandledKey`, který proto dostane i on.
- Bez vrstev se `ToolManager` chová jako samotný nástroj.

### Testy

- `manipulator-drag`: `linearParam` (kolmý paprsek, šikmý paprsek, rovnoběžný → `null`), `angularParam` (čtyři kvadranty, znaménko podle `axis`, z hrany → `null`), `unwrapDelta` přes ±π, `snapValue` (krok, `fine`, ořez, `−0`), tah přes 400° dá 400° (součet `unwrapDelta`). M19: `planarParam` (rovina XY shora i šikmo, báze u, v jiná než osy, z hrany → `null`), `pointParam` (bod na paprsku nejbližší k position).
- `manipulator-controller` s `FakeViewport`, `FakeRegenStatus`, `anOpsSession` a testovacím deskriptorem: bez session, bez kotev, s `issues` → `[]`; hover; tah lineárního úchytu zapíše params (se Shift bez přichycení); `setParams` jen při změně hodnoty; Esc vrátí původní params včetně klíče, který úchyt přepíná; po commitu je v logu jedna položka; zmrazené kotvy (snapshot bez kotev během tahu tah nepřeruší); zavření session během tahu. M19: rovinný a bodový tah (bodový s rovinou ze stisku i po `viewChanged`); režimy (výchozí první, `setMode` přepne rámec a zruší pole, během tahu nic, nová session vrátí výchozí); `pickPoint` (klik na model zapíše patch, tah po modelu ne, klik mimo model nic, v režimu bez `picksPoint` jde klik dál); pole HUD (po tahu, po kliku bez pohybu, zmizí s úchytem, `dragging`, `displayScale`); `setValue` (ořez, bez přichycení, neznámý nebo neskalární úchyt nic).
- `tool-manager`: s úchytem pod kurzorem nástroj nedostane `move`, dostane jednou `leave`; levé `down` na úchytu nedojde k nástroji ani k `refPick`; Escape při tažení nedojde k nástroji; bez vrstev (`layers: []`) beze změny; vrstva, která událost zpracuje, ji nepustí dál; `leaveBelow: false` nepošle syntetický `leave`.

## Strom featur: `FeatureTreeModel`

```ts
export type TreeStatus = 'ok' | 'warning' | 'error' | 'suppressed' | 'rolledBack' | 'pending' | 'draft';   // draft: M19.2 D6

export interface TreeRow {
  readonly id: FeatureId;
  readonly name: string;
  readonly type: string;
  readonly typeLabel: string;          // schema.label (klíč); neznámý typ → type
  readonly icon: string | null;        // schema.icon (název ikony Tabler); neznámý typ → null
  readonly issues: readonly ParamIssue[] | null;  // z FeatureHealth error (neplatné parametry), jinak null
  readonly status: TreeStatus;
  readonly message: string | null;     // u warning/error; null u chyby s neprázdnými issues (UI ukáže přeložená issues, M19.1)
  readonly detail: string | null;      // M19.2 D9: technická zpráva chyby, jejímž hlavním textem jsou přeložená issues; jinak null
  readonly selected: boolean;          // výběr obsahuje { kind: 'feature', feature: id }
  readonly editing: boolean;           // featura otevřené session
  readonly dependents: number;         // počet featur, které na featuře závisí (dependentsOf, M11) – tooltip
}

export interface FeatureTreeModel {
  readonly rows: Observable<readonly TreeRow[]>;
  readonly rollbackIndex: Observable<number>;
  readonly errorCount: Observable<number>;                     // M19.2: počet řádků se stavem 'error' (draft se nepočítá)
  edit(id: FeatureId): void;                                   // → FeatureEditor.edit (skica → sketchEdit); při locked nic
  rename(id: FeatureId, name: string): void;                   // → dispatch feature.rename; ukončí přejmenování; při locked jinak nic
  moveRollbackBar(index: number): void;                        // → dispatch studio.setRollback; při locked nic
  readonly renaming: Observable<FeatureId | null>;             // featura v režimu přejmenování (inline pole v Timeline)
  beginRename(id: FeatureId): void;                            // akce feature.rename; při locked nic
  cancelRename(): void;                                        // rename() režim také ukončí; beginRename neznámé featury → výjimka; zmizelá featura → id nesedí na žádný řádek
  select(id: FeatureId, opts?: { additive?: boolean }): void;  // → selection.set / toggle
  /** Featury mimo ids, které závisí na kterékoli z ids; v pořadí studia, bez duplicit (M11). */
  dependentsOf(ids: readonly FeatureId[]): readonly FeatureId[];
  /** Přesun featury; prázdné = přesunuto (feature.move) nebo locked a nic se nestalo, jinak nová porušení pořadí a nic se nestalo (M11, M19.1). */
  move(id: FeatureId, toIndex: number): readonly OrderViolation[];
  dispose(): void;
}

export function createFeatureTreeModel(deps: {
  doc: DocumentReader; ops: OperationDispatcher; schemas: RegistryReader<FeatureSchema>;
  regen: RegenStatusPort; editor: Pick<FeatureEditor, 'current' | 'edit'>; selection: SelectionCommands;
  locked: Observable<boolean>;            // týž objekt jako session.locked z createEditLock (Ú16a)
  sketchEdit?: (id: FeatureId) => void;   // M12: edit featury typu SKETCH_FEATURE_TYPE jde sem místo FeatureEditor.edit
}): FeatureTreeModel;
```

- `edit` při `locked` (otevřený dialog nebo skicář, dokument jen pro čtení) nic neudělá. Zábrana je v presenteru, ne v komponentě (oprava revize M12, Ú16a, [[0010-prezentacni-model|ADR 0010]]).
- **Zámek u všech příkazů** ([[M19.1-opravy-z-revize|M19.1]], stejně jako `BrowserModel`): `rename`, `beginRename`, `moveRollbackBar` a `move` jsou při `locked` tiše bez účinku. Zámek se kontroluje dřív než argumenty, takže ani neznámé id při zámku nevyhodí. `rename` při zámku jen ukončí přejmenování. Zapnutí zámku (otevření dialogu) rozpracované přejmenování ukončí bez změny (`renaming` = `null`). `Timeline.vue` vlastní kontroly zámku nemá.

- `typeLabel` a `message` jsou od [[0014-preklady-vue-i18n-a-klice|ADR 0014]] klíče překladu (případně s parametry), překládá je `ui`. Zprávy z jádra (`KernelError.message`) zůstávají technický text a UI je ukáže pod přeloženým nadpisem chyby.
- Řádky v pořadí featur dokumentu. Stav: `suppressed` (z dokumentu) > `rolledBack` (index `>= rollbackIndex`) > `health` z portu (`ok`/`warning`/`error`) > `pending` (featura v `health` chybí, např. ještě neproběhla regenerace).
- **Rozpracovaná featura** (`draft`, M19.2 D6): řádek je `draft`, když otevřená session editoru má `mode === 'create'` a `featureId` řádku, její `state.open` platí, zdraví je `error` s neprázdnými `issues` a **všechna** issues mají kód `param.tooFewRefs`. `message`, `issues` i `detail` jsou pak `null`. Dialog nové featury tak bez vybrané reference neukáže v timeline chybu, hlášky u polí zůstávají. Jiná chyba nové featury (jádro, neplatná hodnota) zůstává `error`, editace existující featury `draft` nikdy nedá a po skončení session je tatáž chyba `error`.
- **`detail`** (M19.2 D9): u stavu `error` s přeloženými issues nese technickou zprávu zdraví (`health.message`), kterou issues v hlavním textu nahradila. Jinak `null` (i u `warning`, která issues nemá). Ukazuje ho jen dialog v „Podrobnostech“ ([[11-ui#Komponenty]]), tooltip timeline ne.
- **`errorCount`** (M19.2) = počet řádků se stavem `error`, přepočítá se s `rows`. Čte ho stavový řádek Timeline. Rozpracovaná featura „Chyby: 1“ neukáže.
- Model se přepočítá při `doc.events.changed`, změně `regen.state`, `selection.items` a `editor.current`. Nezměněný řádek je týž objekt, nezměněný seznam týž snapshot.
- `rows` a `rollbackIndex` se přepočítají v jednom kroku, ale vyšlou se postupně (nejdřív `rows`). Odběratel jednoho proto nemá v callbacku číst druhé; Vue překresluje dávkově v mikroúloze, takže v UI nekonzistence nevznikne. Kdyby to vadilo jinde, sloučí se do jednoho `Observable<TreeSnapshot>`.
- Nezměněný řádek se pozná porovnáním s řádkem na stejné pozici; po přesunu featury proto dostanou nový objekt i řádky, které se jen posunuly.
- `rename` neznámé featury → výjimka. `rename`: jméno se ořízne, prázdné nebo stejné → nic. `moveRollbackBar`: stejný index → nic, mimo `0..features.length` → výjimka.
- `rename` a `moveRollbackBar` během otevřené transakce **mimo zámek** (transakce, kterou neotevřel `FeatureEditor`) hodí výjimku z dispečera. Transakci dialogu kryje zámek výše.
- **Závislosti** (M11, nález 3 z [[Revize architektury 2026-10-13]]): strom při každém přepočtu po změně dokumentu spočítá `dependenciesOf(doc.studio, schemas)` z [[03-dokument#Id těles a závislosti|document]]; `dependents` je součástí porovnání nezměněného řádku. Pravidla závislostí jsou prezentační logika, proto tady a ne v handleru (`ops` by jinak potřeboval schémata).
- `move(id, toIndex)`: neznámé id nebo `toIndex` mimo `0..features.length − 1` → výjimka; stejný index → `[]` a nic. Odmítne přesun, po kterém by v `orderViolations` byla dvojice, která tam teď není, a vrátí právě tato nová porušení (dokument ani log se nezmění). Porušení, která už v dokumentu jsou (data zvenku), jiný přesun neblokují. Jinak `dispatch(feature.move)`. Tažení featur v Timeline v M11 nevzniká, příkaz je připravený pro ně ([[Rozhodnutí noční rychloakce#M11 – Další entity|R17]] ⚠).

## Prohlížeč: `BrowserModel` a viditelnost těles

[[Prohlížeč]] v UI ([[11-ui#Rozvržení]]) ukazuje *výsledek* modelování: tělesa z poslední regenerace. [[Timeline]] je jen jiné vykreslení `FeatureTreeModel` výše. Jméno a viditelnost tělesa jsou od M11 [[03-dokument#Metadata těles|metadata v dokumentu]] ([[Q071 Viditelnost těles|Q071]]):

```ts
export interface BrowserBodyRow {
  readonly body: BodyId;
  readonly name: { readonly key: 'browser.body'; readonly n: number };  // automatické „Těleso n“, n od 1 podle pořadí; překládá ui
  readonly userName: string | null;   // jméno z metadat (body.rename); ui ho má přednostně
  readonly feature: FeatureId;        // featura původu (origin)
  readonly visible: boolean;          // !doc.bodyMeta(body).hidden
  readonly color: string | null;      // M15: doc.bodyMeta(body).color ?? null
  readonly material: BodyMaterial;    // M24: doc.bodyMeta(body).material ?? DEFAULT_BODY_MATERIAL
  readonly selected: boolean;         // výběr obsahuje { kind: 'body', body }
}

export interface BrowserModel {
  readonly bodies: Observable<readonly BrowserBodyRow[]>;
  readonly hidden: Observable<ReadonlySet<BodyId>>;   // tělesa poslední regenerace se skrytím v metadatech; app → viewport.setBodyVisible
  select(body: BodyId, opts?: { additive?: boolean }): void;
  readonly canEdit: Observable<boolean>;              // !locked: žádný dialog a dokument není jen pro čtení (R14)
  setVisible(body: BodyId, visible: boolean): void;   // → dispatch body.setVisible
  readonly colors: Observable<ReadonlyMap<BodyId, string>>;   // M15: tělesa poslední regenerace s barvou v metadatech; app → viewport.setBodyColor
  setColor(body: BodyId, color: string | null): void; // M15: → dispatch body.setColor; neplatná barva (isBodyColor) → výjimka
  readonly materials: Observable<ReadonlyMap<BodyId, BodyMaterial>>;   // M24: tělesa poslední regenerace s materiálem v metadatech (bez výchozího); app → viewport.setBodyMaterial
  setMaterial(body: BodyId, material: BodyMaterial): void;              // M24: → dispatch body.setMaterial; neplatný materiál (isBodyMaterial) → výjimka
  readonly renaming: Observable<BodyId | null>;       // těleso v režimu přejmenování (vložené pole v Prohlížeči)
  beginRename(body: BodyId): void;
  cancelRename(): void;
  rename(body: BodyId, name: string | null): void;    // ukončí přejmenování → dispatch body.rename; null = text nezměněn, jen ukončí
  // M12
  readonly planes: Observable<readonly BrowserPlaneRow[]>;        // ORIGIN_PLANES v pořadí
  readonly visiblePlanes: Observable<ReadonlySet<PlaneId>>;        // stav pohledu, výchozí prázdné; app → kresba roviny
  readonly sketches: Observable<readonly BrowserSketchRow[]>;     // skici poslední regenerace
  selectPlane(plane: PlaneId, opts?: { additive?: boolean }): void;  // → selection.set / toggle položky plane; s aktivním parametrem, který bere 'plane' (planes), nahradí rovinu v parametru (M21)
  setPlaneVisible(plane: PlaneId, visible: boolean): void;
  selectSketch(feature: FeatureId, opts?: { additive?: boolean }): void;   // → výběr featury
  editSketch(feature: FeatureId): void;                            // → deps.sketchEdit; bez canEdit nebo v transakci nic (Ú16a)
  // M13
  readonly axes: Observable<readonly BrowserAxisRow[]>;            // ORIGIN_AXES v pořadí
  readonly visibleAxes: Observable<ReadonlySet<AxisId>>;           // stav pohledu, výchozí prázdné; app → axisDrawing
  setAxisVisible(axis: AxisId, visible: boolean): void;
  selectAxis(axis: AxisId): void;                                  // aktivní parametr 'axis' → setParam(toggleAxisRef); jinak nic
  selectRegion(feature: FeatureId, region: string): void;          // aktivní parametr 'region' → setParam(toggleRegionRef); jinak nic
  dispose(): void;
}

export interface BrowserAxisRow { readonly axis: AxisId; readonly label: string; readonly visible: boolean; readonly active: boolean }   // M13; label 'origin.axis.x'; active = je hodnotou aktivního parametru 'axis'
export interface BrowserRegionRow { readonly region: string; readonly n: number; readonly selected: boolean }   // M13; n od 1 v pořadí RegenSketch.regions; selected = v hodnotě aktivního parametru

export interface BrowserPlaneRow { readonly plane: PlaneId; readonly label: string; readonly visible: boolean; readonly selected: boolean }   // label = klíč 'origin.plane.xy'
export interface BrowserSketchRow { readonly sketch: SketchId; readonly feature: FeatureId; readonly name: string; readonly selected: boolean; readonly regions: readonly BrowserRegionRow[] }  // name = jméno featury z dokumentu; regions jen při aktivním parametru 'region' (M13), jinak []

export function createBrowserModel(deps: {
  doc: DocumentReader; ops: OperationDispatcher; regen: RegenStatusPort;
  selection: SelectionCommands; editor: Pick<FeatureEditor, 'current'>;
  locked: Observable<boolean>;                 // týž objekt jako session.locked z createEditLock
  sketchEdit?: (feature: FeatureId) => void;   // M12
}): BrowserModel;
```

- Model se přepočítá při změně regenerace, výběru i dokumentu. Při změně se nejdřív vyšle `hidden`, pak `bodies`. Těleso, které po regeneraci zmizí, ze `hidden` vypadne (jeho metadata v dokumentu zůstávají).
- `setVisible`, `beginRename` a `rename` tělesa, které poslední regenerace nezná (zastaralý řádek v UI), nic neudělají; během otevřené transakce (dialog) také nic a shodná hodnota také nic. `rename` jméno ořízne, prázdné jméno smaže (vrátí automatické). `canEdit = !locked`; UI ovládací prvky (oko, přejmenování) zakáže podle `canEdit`; při `false` `setVisible`, `beginRename`, `rename`, od M15 `setColor` a od M24 `setMaterial` nic ([[Rozhodnutí noční rychloakce#M11 – Další entity|R14]] ⚠ – v M10 šlo skrývat i během dialogu).
- Přejmenování (M11, [[Rozhodnutí noční rychloakce#M11 – Další entity|R28]]): stav režimu je v modelu, ne v komponentě (ADR 0010). `beginRename` → `renaming = body`; `cancelRename` a `rename` (vždy, i když nic nedispatchne) → `null`. Ztráta `canEdit` (otevření dialogu, režim jen pro čtení) přejmenování ukončí bez změny.
- `select(body)`: je-li otevřená session s `activeRefParam` druhu `bodies`, přidá nebo odebere těleso v tomto parametru (`setParam`, stejné přepínání jako `refPick`) a výběr nemění; jinak `selection.set`/`toggle` (M11, [[Rozhodnutí noční rychloakce#M11 – Další entity|R19]]).
- Roviny a skici (M12): viditelnost rovin je jen stav pohledu, neukládá se ([[Rozhodnutí noční rychloakce#M12 – Skicář|R48]] ⚠); skici oko nemají. `planes` a `sketches` se přepočítají se stejnými zdroji jako tělesa; nezměněný řádek zůstává týž objekt. Pořadí vyslání: `hidden`, `visiblePlanes`, `bodies`, `planes`, `sketches`.
- Osy a oblasti (M13, [[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R72, R75]]): viditelnost os je stav pohledu jako u rovin; klik na osu nebo oblast jde jen do aktivního referenčního parametru dialogu (oblast ani osa nejsou položkou `SelectionModel`), jinak nic. Řádky oblastí jsou jen u skic a jen během aktivního parametru `region`, aby Prohlížeč nebyl zahlcený. Model sleduje `editor.current` i `state` otevřené session (aktivní parametr `region`/`axis` a jeho hodnota) a přepočítá se při jejich změně. Hodnoty parametrů čte jen přes `regionRefsOf`/`axisRefOf` z `ref-values`. `ui` označuje stav řádků os (`active`) a oblastí (`selected`) přes `aria-selected` ([[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R86]]). Pořadí vyslání: `hidden`, `visiblePlanes`, `visibleAxes`, `bodies`, `planes`, `axes`, `sketches`.
- Barva (M15, [[Q073 Průhlednost a barva těles|Q073]]): `setColor` má stejné zákazy jako `setVisible` (neznámé těleso, otevřená transakce, `canEdit: false`, shodná hodnota → nic); neplatná barva je chyba volajícího (výjimka) – kontroluje se **před** zákazy, takže vyhodí vždy, i když by se volání jinak zahodilo. `colors` se počítá se stejnými zdroji jako `hidden`, nová mapa jen při změně obsahu. Pořadí vyslání: `hidden`, `colors`, `materials` (M24), `visiblePlanes`, `visibleAxes`, `bodies`, `planes`, `axes`, `sketches`. Toto je **platné úplné pořadí** a starší dílčí výčty u M12 a M13 výše ho jen předcházejí.
- Materiál (M24, [[Q078 Sada materiálů těles|Q078]]): `setMaterial` a `materials` přesně po vzoru barvy (stejné zákazy, neplatná hodnota vyhodí před zákazy, nová mapa jen při změně obsahu). `interaction` reexportuje z `document` typ `BodyMaterial` a hodnoty `BODY_MATERIALS`, `DEFAULT_BODY_MATERIAL` a `isBodyMaterial`, aby je `render` (jen typ) a `app` nemusely brát z `document`.
- Jména čipů v dialogu Prohlížeč nepočítá (od Ú9a, dřív `refLabel`): jsou ve `FieldState.refs` z interní `bodyRefLabel` ([[#Dialog featury: `FeatureEditor`]]).

## Ladění jmen: `TopoInspector`

Vývojářská pomůcka M14 ([[08-topologicke-pojmenovani#Ladění]], [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R111]]): ukáže jméno plochy nebo hrany pod kurzorem.

```ts
export interface TopoHover { readonly body: BodyId; readonly kind: 'face' | 'edge'; readonly index: number; readonly name: TopoName | null }
export interface TopoInspector {
  readonly enabled: Observable<boolean>;          // výchozí false
  readonly hovered: Observable<TopoHover | null>;
  setEnabled(on: boolean): void;
  toggle(): void;                                 // setEnabled(!enabled), přepínač ladicího panelu (spec 11)
  dispose(): void;                                // odhlásí se od událostí viewportu a portu
}
export function createTopoInspector(deps: { viewport: Pick<ViewportPort, 'pick' | 'events'>; regen: RegenStatusPort }): TopoInspector;
```

- Zapnutý: `move` → `viewport.pick(x, y)` s výchozím filtrem; zásah plochy nebo hrany → `TopoHover` se jménem z `RegenBody.names` (bez jména `null`), jinak `null`; `leave` → `null`; ostatní události (`down`, `up`…) nic. Vypnutý: `pick` nevolá a `hovered` je `null`. Po `dispose` zůstane `hovered` na poslední hodnotě. Nová generace → `hovered` `null` (index už neplatí). Snapshot jen při změně, zmrazený.
- Je mimo nástroje (vlastní posluchač událostí), aby nic neměnil na výběru ani hoveru; při zapnutí pickuje navíc ke `SelectTool`, proto je výchozí vypnutý.

## Historie úprav: `HistoryModel`

Panel historie (M15, [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R127, R128]]) ukazuje [[Operační log|operační log]] jako časovou osu, jen ke čtení. Log je append-only a undo připisuje inverzi ([[04-operace-a-historie#Undo / redo]]), takže v panelu je vidět i „Zpět“ a „Znovu“ a změny, které nové `do` po undo zahodilo.

```ts
export interface HistoryRow {
  readonly seq: number;
  readonly kind: 'do' | 'undo' | 'redo';
  readonly label: string;            // LogEntry.label: klíč překladu nebo typ operace (ADR 0014); ui přeloží
  readonly time: number;             // ms od epochy
  readonly target: number | null;    // u undo/redo seq původního 'do', jinak null
  readonly status: 'active' | 'undone' | 'abandoned' | null;   // jen u 'do': na undo zásobníku / na redo zásobníku / ani jedno; u undo/redo null
}
export interface HistoryState {
  readonly rows: readonly HistoryRow[];
  readonly total: number;            // počet záznamů logu bez document.rename (M19.2)
  readonly older: number;            // záznamy mimo rows (starší než nejnovějších HISTORY_LIMIT): total - rows.length
}
export const HISTORY_LIMIT = 200;

export interface HistoryModel extends Disposable { readonly state: Observable<HistoryState> }
export function createHistoryModel(deps: { log: OperationLogReader }): HistoryModel;
```

- `rows`: nejnovější první, nejvýš `HISTORY_LIMIT` (DOM s tisíci řádky by byl pomalý); `total` = počet záznamů logu kromě `document.rename`; `older` = `total − rows.length` (ui ho jen ukáže, nepočítá – oprava revize M15).
- `status` se počítá z `rebuildUndoStacks(log.entries())` (`ops`), stejného pravidla jako `UndoManager`; model na `UndoManager` nezávisí (pořadí odběratelů `appended` by nebylo jisté). Přepočet je O(n) na záznam – pro naše logy zanedbatelné.
- Přepočet po `log.events.appended`; nový snapshot jen při změně, řádek, jehož hodnoty se nezměnily, je **tentýž objekt** (pravidla snapshotů výše). Zmrazené. `dispose` odhlásí odběr.
- **Přejmenování dokumentu** (M19.2, [[M19.2-ux-backlog|D5]]): záznamy s operací `document.rename` (na nejvyšší úrovni) model vynechá z `rows` i z počtů (`total`, `older`). Panel ukazuje kroky undo a přejmenování mezi ně nepatří ([[04-operace-a-historie#Operace dokumentu]]); jinak by se ukázalo jako `abandoned`. `status` ostatních řádků se dál počítá z celého logu.
- Klik na řádek nic nedělá: návrat k dřívějšímu záznamu by byl větvení logu ([[Q006 Větvení operačního logu|Q006]], R127 ⚠).

## Jméno dokumentu: `DocumentNameModel`

M19.2 ([[M19.2-ux-backlog|D5]]). Prezentační model jména dokumentu pro titulek (`document-name.ts`). Přejmenování je operace `document.rename`, takže jméno se uloží, přežije reload a jde s exportem souboru, ale zůstává mimo undo ([[04-operace-a-historie#Operace dokumentu]]).

```ts
export interface DocumentNameModel {
  readonly name: Observable<string>;        // DocumentMeta.name; sleduje doc.events.changed (stejné jméno odběratele nebudí)
  readonly canRename: Observable<boolean>;  // = !locked (jen pro čtení, nebo otevřený dialog drží transakci a dispatch by vyhodil)
  rename(name: string): boolean;            // ořízne mezery → dispatch document.rename; prázdné jméno nebo zámek → false a nic; stejné jméno → true bez operace
  dispose(): void;
}

export function createDocumentNameModel(deps: {
  doc: Pick<DocumentReader, 'meta' | 'events'>;
  ops: Pick<OperationDispatcher, 'dispatch'>;
  locked: Observable<boolean>;              // zámek editace (createEditLock)
}): DocumentNameModel;
```

- `canRename` nemá vlastní stav, odvozuje se ze zámku a mění se přesně s ním.
- Záznam `document.rename` jde bez `label`, takže popisek v logu je typ operace (klíč přeloží `ui`).
- `app` ho vystaví jako `AppSession.documentName` bez `dispose` ([[11-ui#Kompoziční kořen (app)]]).

## Export: akce Soubor

Akce „Exportovat STEP“ a „Exportovat dokument“ (M15, [[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R122, R124]]). Pravidla povolení a stav běhu jsou prezentační logika (`interaction`); co se exportuje a jak se soubor stáhne, dělá `app` za portem `FileExporter` ([[11-ui#Kompoziční kořen (app)]]). `interaction` tak nezná jádro ani DOM.

```ts
export const FILE_ACTION_IDS = { exportStep: 'file.exportStep', exportDocument: 'file.exportDocument' } as const;

/** Port: app exportuje a soubor stáhne; odmítnutí = export se nepovedl. */
export interface FileExporter {
  exportStep(bodies: readonly BodyId[]): Promise<void>;
  exportDocument(): Promise<{ readonly withHistory: boolean }>;   // M19.1: false = živý dokument bez historie (úložiště nefunguje)
}

export type FileTask = 'step' | 'document';
export type FileStatus =
  | { readonly kind: 'idle'; readonly warning: 'file.exportedWithoutHistory' | null }   // warning: M19.1
  | { readonly kind: 'running'; readonly task: FileTask }
  | { readonly kind: 'failed'; readonly task: FileTask; readonly message: string };   // message technická, ui ukáže v tooltipu

export interface FileActions extends Disposable {
  readonly status: Observable<FileStatus>;
  dismiss(): void;                    // 'failed' → 'idle'; 'idle' s upozorněním → bez upozornění (M19.1); jinak nic
}

export function createFileActions(deps: {
  registry: ActionRegistry; exporter: FileExporter; regen: RegenStatusPort;
  browser: Pick<BrowserModel, 'hidden'>; editor: Pick<FeatureEditor, 'current'>; mode: Observable<Mode>;
}): FileActions;
```

- Obě akce: `group: 'file'` (menu Soubor v `TitleBar`), `label` = id (klíč překladu), bez zkratky, režim `model`. Registrují se při vytvoření; `dispose` odhlásí odběry.
- `exportStep` je povolená, když nic neběží, není otevřený dialog (`editor.current === null`; jinak by šel ven náhled), je režim `model` a poslední `RegenSnapshot` má aspoň jedno těleso, které není v `browser.hidden`. Spustí `exporter.exportStep(tělesa)` s viditelnými tělesy v pořadí snapshotu (pořadí Prohlížeče, R122 ⚠: výběr těles k exportu není). Režim jen pro čtení export nezakazuje.
- `exportDocument` je povolená, když nic neběží (i s otevřeným dialogem – exportuje se uložený stav, [[05-persistence#Export a import souboru]]).
- Běh: `status` `running` (obě akce zakázané) → po vyřízení `idle`, po odmítnutí `failed` se zprávou (`Error.message`, jinak `String(e)`). Další spuštění `failed` přepíše.

## Skicář

Režim skicáře je prezentační logika, proto není v pluginu. Leží ve vlastním modulu `sketcher` v prstenci 2, který závisí na `interaction`, ne naopak ([[0024-modul-sketcher|ADR 0024]], [[0017-modul-sketch-a-skicar|ADR 0017]], [[12-skicar#Režim skicáře (sketcher)]]). `interaction` poskytuje nástroje, `FeatureEditor`, `ViewportPort`, `Mode` a pomocníky kláves (`isPlainEscape`, `CLICK_TOLERANCE_PX`). Sekce níže popisují API `sketcher/index.ts`. Datový model, oblasti a port řešiče bere z modulu `sketch`.

### Režim

```ts
// interaction/mode.ts
export type Mode = 'model' | 'sketch';
export const ALL_MODES: readonly Mode[];          // ['model', 'sketch']
```

Režim je `'sketch'`, právě když je otevřená `SketchSession` (`SketchEditor.mode`). Nemá vlastní stav ani příkazy: vstup a odchod jsou `SketchEditor.create`/`edit` a `SketchSession.finish`/`cancel`.

- **Nástroje** (`ToolDescriptor.modes`, výchozí `['model']`): `ToolManager` dostane `mode?: Observable<Mode>` a `defaultToolIds?: Partial<Record<Mode, string>>` (výchozí nástroj režimu `model` je dál `defaultToolId`; s `mode` musí být `defaultToolIds.sketch` v registru, jinak výjimka při vytvoření). Změna režimu deaktivuje aktivní nástroj a aktivuje výchozí nástroj nového režimu. `activate(id)` nástroje, který v aktuálním režimu není, hodí výjimku a aktivní nástroj zůstane. `finish()` i `Escape` vrací na výchozí nástroj **aktuálního** režimu.
- **Akce** (`Action.modes`, výchozí `ALL_MODES`): `createActionRegistry(deps?: { mode?: Observable<Mode> })`. Dvě akce smí mít stejnou zkratku, jen když mají disjunktní `modes` (jinak výjimka v `register`). `handleKey` hledá jen mezi akcemi aktuálního režimu. `ActionState` nese `modes` a jeho `enabled` = `action.enabled` **a** režim je v `modes`; změna režimu vytvoří nový snapshot jen se změněnými stavy. `run` akce mimo režim vrátí `false`.
- **Vestavěné akce** (`createBuiltInActions`, deps `mode?: Observable<Mode>`): `feature.*` a `timeline.*` mají `modes: ['model']`, `undo`, `redo`, `view.fitAll` a od M19.2 standardní pohledy `view.*` všechny režimy. Akce nástroje má `modes` nástroje a `enabled` = v režimu `sketch` „nástroj je pro `sketch`“, v režimu `model` „`!locked` a nástroj je pro `model`“ (skicář je otevřená editace featury, takže `locked` je v něm `true`).

### `SketchEditor` a `SketchSession`

```ts
export interface SketchEditor {
  readonly current: Observable<SketchSession | null>;
  readonly mode: Observable<Mode>;                       // 'sketch' ⇔ current !== null
  /** Nová skica na rovině: FeatureEditor.create(SKETCH_FEATURE_TYPE), u jiné než výchozí roviny setParam('plane'). */
  create(plane: PlaneRef | TopoRef): SketchSession;          // M14: i rovinná plocha tělesa
  /** Rovina pro referenci (deps.resolvePlane); nástroj skici podle ní pozná, jestli plocha z výběru jde použít (M14). */
  planeOf(ref: PlaneRef | TopoRef): Plane | undefined;
  /** Úprava existující skici (FeatureEditor.edit). */
  edit(featureId: FeatureId): SketchSession;
  /** M19.2 D4: nové body kreslicích nástrojů se přichytí k mřížce; výchozí true, stav editoru (přežije zavření a otevření skici), neukládá se. */
  readonly gridSnap: Observable<boolean>;
  setGridSnap(on: boolean): void;
  /** M25: glyfy všech vazeb skici, nejen u vybraných a najetých entit (přepínač „Zobrazit vazby“); výchozí false, stav editoru jako gridSnap, neukládá se. */
  readonly showAllConstraints: Observable<boolean>;
  setShowAllConstraints(on: boolean): void;
  /** M19.2: aktuální krok mřížky v mm (deps.gridStep); nástroje ho čtou při každém přichycení. */
  gridStep(): number;
}

export function createSketchEditor(deps: {
  features: FeatureEditor;
  solver: ConstraintSolver;
  viewport: Pick<ViewportPort, 'sketches' | 'screenToRay' | 'overlay'>; // kresba 'sketch-edit' (Ú16a, ADR 0011); od M28 screenToRay pro tah popisku kóty; od M26 overlay pro vodítka snapperu ('sketch-guides'); ids skicář nepotřebuje
  resolvePlane: (ref: PlaneRef | TopoRef) => Plane | undefined;   // app: planeOfRef nad posledním stavem regenerace (M14), viz spec 07
  planeOfSketch: (featureId: FeatureId) => Plane | undefined;     // M21: SketchArtifact.plane skici z posledního stavu (ADR 0025); edit ji použije před resolvePlane
  gridStep?: () => number;                                 // M19.2: krok mřížky v mm, čte se při každém pohybu a kliku; výchozí () => 1
}): SketchEditor;

export interface SketchSession {
  readonly featureId: FeatureId;
  readonly plane: Observable<Plane>;                       // M21: mění se se změnou parametru plane (pole Rovina)
  pickPlane(): void;                                       // M21: fokus parametru roviny (výběr přes refPick); bez viditelného parametru nic
  cancelPlanePick(): boolean;                              // M21: true = výběr běžel a skončil
  readonly state: Observable<SketchState>;
  addGeometry(add: SketchData, opts?: { readonly required?: ReadonlySet<SketchConstraintId> }): Promise<boolean>; // nové entity a automatické vazby (nástroje); true = zapsáno; M26: required = vazby, které se při konfliktu nevynechají
  /** M26: náhled vazeb, které by klik kreslicího nástroje zapsal (SketchState.inference), a vodítka snapperu v overlay 'sketch-guides'; null = smazat. */
  setInferencePreview(p: { readonly at: Vec2; readonly kinds: readonly GlyphKind[]; readonly guides: readonly SnapGuide[] } | null): void;
  addConstraint(c: SketchConstraint): Promise<boolean>;    // akce vazeb, kóta
  setDimension(id: SketchConstraintId, value: number): Promise<boolean>;
  remove(ids: readonly SketchItemId[]): Promise<boolean>;  // removeItems ze sketch
  toggleConstruction(ids: readonly SketchItemId[]): void;  // bez řešiče
  drag(point: SketchEntityId, to: Vec2): void;             // tažení bodu (výběrový nástroj)
  endDrag(): Promise<void>;                                // počká na dořešení posledního cíle
  previewDimension(draft: SketchConstraintDraft | null): void;   // M28: kóta na myši nástroje Kóta (pohled '__preview'), bez řešiče a zápisu
  moveDimension(id: SketchConstraintId, x: number, y: number): void; // M28: tah popisku, px plochy pohledu → movePlacement; drží se jen v session
  endMoveDimension(): void;                                // M28: zapíše polohu jedním setParams bez řešiče; bez pohybu nic
  setHover(id: SketchItemId | null): void;
  select(id: SketchItemId, opts?: { additive?: boolean }): void;   // bez additive = jen toto; additive = přepnout
  clearSelection(): void;
  clearEditingDimension(): void;
  finish(): void;                                          // FeatureEditSession.commit → jeden záznam v logu
  cancel(): void;                                          // FeatureEditSession.cancel → nic
}

export interface SketchState {
  readonly open: boolean;
  readonly planeMissing: boolean;                          // M21 (Q079): rovinu nešlo spočítat, skica je otevřená na XY a čeká na výběr roviny
  readonly planeField: SketchPlaneField | null;            // M21: pole Rovina pro panel (label, text, active, invalid)
  readonly name: string;                                   // jméno featury
  readonly entities: readonly SketchEntity[];              // z parametrů featury (parseSketchData; neplatná data → [])
  readonly constraints: readonly SketchConstraint[];
  readonly status: 'solving' | SolveStatus;                // poslední řešení; 'solving' jen před prvním výsledkem
  readonly dof: number | null;
  readonly fullyDefined: boolean;                          // status 'ok' && dof === 0
  readonly selection: readonly SketchItemId[];             // v pořadí výběru, jen existující položky
  readonly hover: SketchItemId | null;
  readonly message: { readonly key: SketchMessageKey } | null;
  readonly statusKey: string;                              // klíč stavového řádku panelu, viz níže (Ú16a)
  readonly statusParams: Readonly<Record<string, number>>; // parametry statusKey
  readonly constraintRows: readonly SketchConstraintRow[]; // pro panel
  readonly editingDimension: SketchConstraintId | null;    // právě vytvořená kóta (ui dá jejímu poli fokus)
  readonly busy: boolean;                                  // M19.1 D8: běží nebo čeká job, který může zapsat
  readonly dimensions: readonly SketchDimensionView[];     // M19.2 D4: kóty pro viewport (dimensionViews)
  readonly glyphs: readonly SketchGlyphView[];             // M25: glyfy vazeb pro viewport (glyphViews, spec 12)
  readonly inference: { readonly anchor: Vec3; readonly kinds: readonly GlyphKind[] } | null; // M26: náhled automatických vazeb (prázdný → null)
}
export type SketchMessageKey = 'sketch.conflict' | 'sketch.redundant' | 'sketch.solverFailed';
export interface SketchConstraintRow {
  readonly id: SketchConstraintId;
  readonly kind: SketchConstraint['kind'];
  readonly n: number;                                      // pořadí v rámci druhu od 1 („Vodorovná 2“)
  readonly value: number | null;                           // jen kóty (všech 7 druhů, M28); úhel v radiánech
  readonly selected: boolean;
}
export interface SketchDimensionView {                      // M19.2, M28; sketch-dimensions.ts
  readonly id: SketchConstraintId;                         // náhled nástroje Kóta: '__preview'
  readonly kind: DimensionKind;                            // M28: všech 7 druhů
  readonly value: number;                                  // přesná hodnota vazby; zaokrouhluje až ui
  readonly placement: DimensionPlacement;                  // M28: uložená, jinak defaultPlacement
  readonly geometry: DimensionGeometry;                    // M28: světové body kresby (12-skicar, Kóty (M28)); nahradilo from/to
  readonly preview?: true;                                 // M28: kóta visící na myši
  readonly n: number;                                      // pořadí v rámci druhu jako SketchConstraintRow.n; náhled 0
  readonly selected: boolean;
}
export function dimensionViews(plane: Plane, entities: readonly SketchEntity[], constraints: readonly SketchConstraint[],
  selection: readonly SketchItemId[], prev: readonly SketchDimensionView[],
  preview?: SketchConstraintDraft | null): readonly SketchDimensionView[];   // M28: náhled na konec seznamu
export const EDIT_SKETCH_DRAWING_ID = 'sketch-edit';
export const ORIGIN_POINT_ID = '__origin';                 // bod počátku v kresbě (snap)
```

**Glyfy vazeb** (`SketchState.glyphs`, M25): `buildState` volá čistou `glyphViews` (`sketch-glyphs.ts`, z `index.ts` se exportují typy `SketchGlyphView` a `GlyphKind`); množinu viditelnosti skládá session z výběru a hoveru (vybraná nebo najetá křivka přidá své definiční body, vybraná nebo najetá geometrická vazba své entity), při `showAllConstraints` je `'all'`. Najetá nebo vybraná geometrická vazba zvýrazní své entity v kresbě (`hover`/`selected`), výběr entity má přednost. Kontrakt, kotvy a skládání v [[12-skicar#Glyfy vazeb (M25)]].

**Kóty pro viewport** (`SketchState.dimensions`, M19.2 D4): `buildState` volá čistou `dimensionViews` (`sketch-dimensions.ts`, z `index.ts` se exportuje jen typ `SketchDimensionView`). Všechny kóty v pořadí vazeb (od M28 všech 7 druhů, [[12-skicar#Kóty (M28)]]), náhled nástroje Kóta na konci; z `index.ts` se exportuje i typ `DimensionGeometry`. `n` se počítá jako `SketchConstraintRow.n`: počítá se každá vazba druhu, i vynechaná. Kóta, které chybí entita (nebo poloměr na něčem jiném než kružnici či oblouku, úhel rovnoběžných úseček, `pointLineDistance` k úsečce nulové délky), se vynechá. Nezměněná položka zůstává týmž objektem z `prev` a nezměněný výsledek týmž polem (společná pravidla snapshotů výše).

**`create` / `edit`:** předpoklady jako u `FeatureEditor` (žádná otevřená session, dispečer mimo transakci; jinak výjimka a nic se nezmění); `create` s rovinou, kterou `resolvePlane` nezná, → výjimka před vytvořením featury; `edit` featury jiného typu než `SKETCH_FEATURE_TYPE` → výjimka; `edit` čte rovinu z první položky parametru `plane` (`readRefOf(['plane', 'topo'], …)`, tedy i `TopoRef`, M14); skica s nevyřešitelnou rovinou → session featury se zruší a výjimka. Session hned spustí řešení aktuálních dat **bez zápisu** (jen `status` a `dof`; zápis by do logu dostal šum výpočtu). Když se `FeatureEditSession` zavře jinak (dispose session aplikace), `SketchSession` se zavře také.

**Zápis změny** (`addGeometry`, `addConstraint`, `setDimension`, `remove`): příkazy běží **sériově** ve frontě; každý vezme aktuální data z dokumentu, sestaví nová, zavolá `solver.solve` a podle výsledku:

- `'ok'` → `FeatureEditSession.setParams({ entities: result.entities, constraints })`, `status`, `dof`, `message: null`, vrátí `true`. Výjimka: `addConstraint` (a kóta) vazby, která je v `redundant`, → nic, `message 'sketch.redundant'`, `false`. U `addGeometry` se nové vazby, které jsou v `redundant` (automatické vodorovné na snapu…), z dat vynechají a zbytek se zapíše. Od M26 jsou všechny vazby `addGeometry` automatické: při `'conflict'` se zkusí znovu bez sporných přidaných vazeb, pak jen s `fix` a `required`, nejvýš tři řešení na zápis ([[12-skicar#Snapper a auto-vazby (M26)]]).
- `'conflict'` → nic, `message 'sketch.conflict'`, `false`; `'failed'` nebo odmítnutí řešiče → nic, `message 'sketch.solverFailed'`, `false`.
- Data beze změny (stejné hodnoty) se nezapisují.
- Výsledek, který dorazí po zavření session, se zahodí (`false`). Po zavření hodí každý příkaz výjimku hned (ne odmítnutý slib).
- `remove` a `toggleConstruction` z výběru odeberou zmizelé položky; `toggleConstruction` zapíše hned (konstrukce řešení nemění).
- **Fronta a výjimky** ([[M19.1-opravy-z-revize|M19.1]]):
  - Job, který vyhodí synchronně, odmítne svůj slib a fronta pokračuje dalším. Dřív zůstala fronta navždy obsazená (revize C9).
  - Prázdná fronta dál spouští job synchronně.
  - Slib příkazu se splní až po uvolnění fronty, takže po `await` je `busy` už aktuální.
  - Chyba odloženého `toggleConstruction` (za rozpracovaným řešením) nemá volajícího a končí jako neošetřené odmítnutí.
- **`busy` (D8):** `open` a ve frontě běží nebo čeká job, který může zapsat do skici: výsledek řešení (`addGeometry`, `addConstraint`, `setDimension`, `remove`), tažení a odložený `toggleConstruction`. Úvodní řešení po otevření nic nezapisuje, a proto se nepočítá. Zavřená session má `false`. Akce `sketch.finish` a tlačítko „Hotovo“ jsou při `busy` zakázané, takže geometrie nakreslená těsně před „Hotovo“ se neztratí. `finish()` sám zůstává synchronní a rozpracované výsledky zahodí.
- **Úklid při zavření** je odolný vůči výjimce odběratele: kresba zmizí, `onClose` proběhne a `SketchEditor.mode` se vrátí na `'model'` vždy (`try/finally`). Výjimka pak letí dál. Totéž platí pro `FeatureEditor` (`current` = `null` vždy).

**Tažení:** `drag(point, to)` je nejvýš jeden rozpracovaný `solve` s `drag` a jeden čekající cíl (další `drag` čekající cíl přepíše). Výsledek `'ok'` se zapíše jako výše; `'conflict'`/`'failed'` se tiše zahodí. Tažení se řadí do stejné fronty jako ostatní příkazy. `endDrag` se splní, až je fronta tažení prázdná.

**Stavový řádek** (Ú16a; dřív `sketchStatusText` v `ui`): `statusKey` je `'sketch.status.solving'` (status `'solving'`), `'sketch.conflict'`, `'sketch.solverFailed'` (status `'failed'`), u statusu `'ok'` `'sketch.status.defined'` (`fullyDefined`), jinak `'sketch.status.dof'`; `ui` ho jen přeloží. `statusParams` je `{ n: dof }` jen u `'sketch.status.dof'` (`dof` `null` → 0), jinak `{}`; zůstává týž objekt, dokud se klíč a DoF nezmění, aby se snapshot `state` zbytečně neměnil. Session vzniká interní `openSketchSession(deps)` (`sketch-session.ts`, mimo `index.ts`), která dostává také jen `viewport: Pick<ViewportPort, 'sketches' | 'screenToRay'>` (`screenToRay` od M28 pro `moveDimension`).

**Kresba:** při každé změně `state` session pošle `viewport.sketches.set(EDIT_SKETCH_DRAWING_ID, toSketchDrawing(plane, data, styleOf, { origin: true, editing: true }))`; po zavření `remove`. Styl křivky: vybraná → `selected`, jinak pod kurzorem → `hover`, jinak konstrukční → `construction`, jinak `fullyDefined ? 'defined' : 'normal'`; body stejně bez konstrukce.

**Kóty a výběr:** kóta vytvořená přes `addConstraint` (kterýkoli druh kóty) a zapsaná nastaví `editingDimension`; volání `addConstraint` s kótou zruší náhled (`previewDimension`). `setDimension` odmítne (`false`, bez řešiče) hodnotu ≤ 0, nekonečnou a u úhlu ≥ π (data by neprošla `parseSketchData`). **Tah popisku** (M28): `moveDimension` přepočítá `placement` (`movePlacement`) a drží ho jen v session (`SketchState.constraints` i `dimensions` ho ukazují, řešič se nevolá); `endMoveDimension` ho zapíše jedním `setParams` – běží-li zápis řešiče, zařadí se za něj jako `toggleConstruction`. `select`/`clearSelection`/`setHover` mění jen stav session (výběr v režimu skicáře je oddělený od `SelectionModel`). Neznámé id u `select` nic.

### Kresba skici

```ts
// sketcher/sketch-drawing.ts (čisté funkce, export z index.ts – používá je i app)
export function toSketchDrawing(plane: Plane, data: SketchData, styleOf: (id: SketchItemId) => SketchStyle,
  opts?: { readonly origin?: boolean; readonly editing?: boolean }): SketchDrawing;   // všechny křivky a body; origin → bod ORIGIN_POINT_ID v [0, 0] stylu 'normal'; editing → SketchDrawing.editing (M19.2)
export function artifactDrawing(plane: Plane, entities: readonly SketchEntity[]): SketchDrawing;   // křivky (nekonstrukční 'normal', od M13 konstrukční 'construction'), bez bodů; od M13 regions z computeRegions
export function planeDrawing(plane: Plane, size?: number): SketchDrawing;   // čtverec size × size (výchozí 100) se středem v počátku roviny, 4 úsečky stylem 'plane'
export function axisDrawing(axis: { readonly origin: Vec3; readonly direction: Vec3 }, size?: number): SketchDrawing;   // M13: úsečka 'axis' délky size (výchozí 100) se středem v origin, stylem 'plane'
```

Oblouk → `startAngle = atan2(start − center)`, `endAngle = atan2(end − center)` (+2π, dokud není větší); kružnice `0 … 2π`.

- `artifactDrawing` (M13): konstrukční křivky se kreslí (stylem `construction`), aby šla konstrukční úsečka vybrat jako osa Rotace ([[Rozhodnutí noční rychloakce#M13 – Extrude a Revolve|R74]] ⚠); `regions` = `computeRegions({ entities, constraints: [] })` ze `sketch`, `id` = jméno oblasti (shodné s klíči `SketchArtifact.regions`), oblouky a kružnice lomenou čarou s krokem nejvýš π/36.
- `axisDrawing` (M13): rovina kresby s `xDir = d̂`, `normal = unit(d̂ × (|d̂_z| < 0.9 ? +Z : +X))` a počátkem `axis.origin`, jedna úsečka id `'axis'` od `−size/2` do `size/2`; bez bodů a oblastí. Id kresby je id osy, takže zásah osy ve viewportu převede `refPick` na `AxisRef`.

### Nástroje a akce skicáře

```ts
export function createSketchTools(deps: { sketches: SketchEditor }): readonly ToolDescriptor[];
export const SKETCH_ACTION_IDS: {
  readonly finish: 'sketch.finish'; readonly cancel: 'sketch.cancel';
  readonly delete: 'sketch.delete'; readonly construction: 'sketch.construction';
};
export function sketchConstraintActionId(kind: string): string;   // 'sketch.constraint.<kind>'; SKETCH_ACTION_IDS a tahle funkce jsou v datovém vstupním bodě sketcher/constants.ts
export function createSketchActions(deps: { registry: ActionRegistry; sketches: SketchEditor; ids: IdGenerator }): Disposable;
```

| Nástroj (`id`) | Režim, skupina, zkratka | Chování |
|---|---|---|
| `sketch` | `model`, `sketch`, `Shift+S` | je-li zavřený dialog i skicář: `sketches.create(rovina)` – rovina z výběru – první položka `plane` (`PlaneRef`), nebo `face` se jménem, pro kterou `planeOf({ kind: 'topo', body, name })` vrátí rovinu (M14, [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R107]] ⚠), jinak `ORIGIN_PLANE_IDS.xy`; skončí |
| `sketch.select` | `sketch`, `select` | výchozí v režimu skici; `move` → `setHover` z `pick(x, y, ['sketchEntity'])` (jen entity session, ne počátek); klik (do 4 px) → `select` (Shift = `additive`), do prázdna `clearSelection`; stisk na bodu a pohyb nad 4 px → `drag` při každém pohybu, uvolnění → `endDrag`; `Escape` s výběrem → `clearSelection` (`true`) |
| `sketch.line` | `sketch`, `draw`, `L` | polyline: první klik začne řetěz, každý další přidá úsečku z posledního bodu (`addGeometry`); klik na první bod řetězu ho uzavře a ukončí; M26: body přes snapper, každá úsečka dostane vazby z `inferLine` (osa do 3°, rovnoběžka, kolmice, tečna k navazujícímu oblouku, `equal` s předchozí úsečkou řetězu do 2 %), Ctrl/Cmd je vypne; úsečka mezi body už spojenými existující úsečkou nevznikne; `Escape` s rozpracovaným řetězem ho ukončí (`true`), jinak nástroj skončí |
| `sketch.rectangle` | `sketch`, `draw`, `R` | dva rohy → 4 body (rohy ze snapu znovu použité, M26 i dopočítané), 4 úsečky, 2× `horizontal`, 2× `vertical` (`required`); strana na existující úsečce se sdílí; rohy se stejnou x nebo y nic |
| `sketch.circle` | `sketch`, `draw`, `C` | střed, bod na obvodu → kružnice (poloměr > 0); M26: střed přes snapper s vazbami, bod na obvodu jen polohou, `equal` s poslední kružnicí/obloukem do 2 % (`inferRadius`) |
| `sketch.circle2p`, `sketch.circle3p`, `sketch.circle2t`, `sketch.circle3t` | `sketch`, `draw`, rodina `circle`, bez zkratky | M27: kružnice 2 body, 3 body, 2 a 3 tečny; gesta, vazby a degenerované případy v [[12-skicar#Oblouky a kružnice (M27)]] |
| `sketch.arc` | `sketch`, `draw`, `A` | střed, začátek, konec (promítnutý na kružnici) → oblouk proti směru hodinových ručiček; M26: body přes snapper (konec vždy nový bod, bez `fix`), `inferRadius` |
| `sketch.arc3p`, `sketch.arcTangent` | `sketch`, `draw`, rodina `arc`, bez zkratky | M27: oblouk 3 body (začátek, konec, bod na oblouku) a tečný oblouk z konce úsečky nebo oblouku; [[12-skicar#Oblouky a kružnice (M27)]]. Od M27 má `sketch.circle` rodinu `circle` a `sketch.arc` rodinu `arc` (popisek „Oblouk středem“). Nástroj úsečka: stisk a tah z posledního bodu řetězu kreslí tečný oblouk (`clickTool` s volitelným tahem `onDragStart`/`onDrag`/`onDragEnd`/`onDragCancel`). |
| `sketch.dimension` | `sketch`, `constrain`, `D` | M28: klik na entitu nebo dvě entity určí cíl (`dimensionTarget`), kóta pak visí na myši a druh i polohu volí kurzor (`placeDimension`, náhled přes `previewDimension`); klik ji zapíše (`addConstraint` s `placement`), Esc náhled zruší. Průběh výběru v [[12-skicar#Kóty (M28)]] |

- **Bod pod kurzorem od M26** ([[12-skicar#Snapper a auto-vazby (M26)]]): `snapAt` už nepickuje, volá čistou `snap` ze `sketch` nad daty session (i s nezapsanými entitami rozpracovaného řetězu) s prahem 6 px převedeným na mm v místě kurzoru, mřížkou podle `snapGrid` a `infer: !mods.mod`; `placePoint` z `inferred` vytvoří vazby s novými id. Klik i náhled počítá jedna funkce kroku nástroje (`lineStep`, `rectangleStep`, `circleStep`, `arcStep`). Náhled vazeb a vodítek (`setInferencePreview`) smaže klik, Esc, `leave`, deaktivace a zavření session. Odstavce níže popisují stav M12–M19.2.
- **Bod pod kurzorem do M25** (pomocník `snapAt(ctx, session, x, y, grid: number | null)` v `sketch-tools/snap.ts`): `pick(x, y, ['sketchEntity'])`; zásah bodu session → jeho id a souřadnice; zásah `ORIGIN_POINT_ID` → nový bod `[0, 0]` a vazba `fix`; jinak (křivka, jiná kresba, nic) nový bod v průsečíku paprsku `screenToRay` s rovinou (`plane.intersectRay`, `toLocal`; rovnoběžný paprsek → klik se ignoruje). Nové id z `ids.next()`.
  - **Přichycení k mřížce** (M19.2 D4): pořadí je existující bod → počátek → volný bod. Jen volný bod se zaokrouhlí na násobek `grid` v souřadnicích roviny (`Math.round(v / grid) * grid`, `−0` → `0`). `grid === null` = bez mřížky.
  - Kreslicí nástroje (úsečka, obdélník, kružnice, oblouk) volají `snapAt` s `snapGrid(sketches, mods)` = `gridSnap && !mods.alt ? gridStep() : null` (`common.ts`) při pohybu (náhled) i při kliku. `ClickHandlers.onMove(ctx, session, x, y, mods)` proto dostává i `mods: KeyMods`. Automatické `horizontal` a `vertical` úsečky se počítají z přichycených bodů. Výběrový nástroj (tažení bodu) a nástroj kóty se nepřichytávají.
- **Náhled:** kreslicí nástroje kreslí rozpracovaný tvar přes `viewport.overlay.set('sketch-tool', …)` ve světových souřadnicích stylem `preview` (kružnice a oblouk lomenou čarou, 64 úseků na kruh); při deaktivaci `overlay.remove('sketch-tool')`.
- Nástroje bez otevřené session nic nedělají.
- **Akce** (`createSketchActions`, všechny `modes: ['sketch']`): `sketch.finish` a `sketch.cancel` (skupina `sketch`, bez zkratky, povolené s otevřenou session); `sketch.delete` (`Delete`, `Backspace`; povolená s neprázdným výběrem) → `remove(výběr)`; `sketch.construction` (`Q`; výběr obsahuje křivku) → `toggleConstruction`; pro každý druh z `GEOMETRIC_CONSTRAINT_KINDS` akce `sketch.constraint.<kind>` (skupina `sketch.constraint`, popisek `sketch.constraint.<kind>`, zkratky `H` vodorovná, `V` svislá, `I` shoda, ostatní bez; povolená, když `constraintFor(kind, vybrané entity) !== null`) → `addConstraint({ ...návrh, id: ids.next() })`.

## Vestavěné akce

Pravidla vestavěných akcí jsou prezentační logika, proto patří do `interaction` (revize M10, [[0010-prezentacni-model|ADR 0010]]); `app` je jen zaregistruje.

```ts
// SELECT_TOOL.label je klíč překladu 'tool.select' (ADR 0014).
export const ACTION_IDS = {
  undo: 'undo', redo: 'redo', fitAll: 'view.fitAll',
  viewFront: 'view.front', viewBack: 'view.back', viewRight: 'view.right', viewLeft: 'view.left',   // M19.2 D8
  viewTop: 'view.top', viewBottom: 'view.bottom', viewIso: 'view.iso',
  featureEdit: 'feature.edit', featureRename: 'feature.rename', featureSuppress: 'feature.suppress',
  featureDelete: 'feature.delete', rollHere: 'timeline.rollHere',
  toStart: 'timeline.toStart', stepBack: 'timeline.stepBack', stepForward: 'timeline.stepForward', toEnd: 'timeline.toEnd',
} as const;
export function toolActionId(toolId: string): string;   // 'tool.<id>'

/** M19.2: standardní pohled kamery; stejné hodnoty jako StandardView v render, takže CameraController sedí strukturálně. Jen v builtin-actions.ts, index.ts typ nevyváží. */
export type StandardViewId = 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom' | 'iso';

/** Stav „zamčeno“: dokument jen pro čtení nebo otevřený dialog. Jediné místo pravidla. */
export function createEditLock(deps: { readOnly: boolean; editor: FeatureEditor }): Observable<boolean>;

export function createBuiltInActions(deps: {
  registry: ActionRegistry; doc: DocumentReader; ops: OperationDispatcher; undo: UndoManager;
  selection: SelectionModel; featureTree: FeatureTreeModel; tools: ToolManager;
  toolList: readonly ToolDescriptor[]; locked: Observable<boolean>;
  camera: { fitAll(): void; setView(view: StandardViewId): void };   // úzké rozhraní, render interaction nezná; setView od M19.2
}): Disposable;
```

- `createBuiltInActions` dostane od M11 i `confirm: (request: ConfirmRequest) => boolean` s `ConfirmRequest = { key: string; params: Readonly<Record<string, string | number>> }` (klíč překladu a hodnoty; `interaction` nezná DOM, dialog dodá `ui` přes `app`). `feature.delete` spočítá `featureTree.dependentsOf(odstraňované)`; je-li jich `n > 0`, zeptá se `confirm({ key: 'feature.delete.confirm', params: { n } })` a při `false` nic nesmaže ani nezmění výběr (jako Fusion: „N featur ztratí referenci“, [[Rozhodnutí noční rychloakce#M11 – Další entity|R16]]). Bez závislých se neptá; maže-li se featura spolu se všemi svými závislými, je `n = 0` (`dependentsOf` počítá jen featury mimo odstraňované) a také se neptá.
- Skupina `feature` (kontextové menu) v pořadí: `feature.edit` (→ `featureTree.edit`, takže skica se otevře ve skicáři; [[M19.1-opravy-z-revize|M19.1]], dřív `FeatureEditor.edit` a skica dostala obecný dialog), `feature.rename` (→ `featureTree.beginRename`), `feature.suppress`, `timeline.rollHere`, `feature.delete`. Menu v [[Timeline]] je jen vykreslený snapshot akcí této skupiny.
- **Standardní pohledy** (M19.2, [[M19.2-ux-backlog|D8]]): sedm akcí `view.front`, `view.back`, `view.right`, `view.left`, `view.top`, `view.bottom`, `view.iso` (v tomto pořadí registrace) volá `camera.setView(pohled)`. Dokument nemění, takže jsou jako `view.fitAll` povolené vždy (i jen pro čtení a s otevřeným dialogem), bez zkratek a bez `modes` (všechny režimy). Popisek = id akce (klíč překladu). V liště jsou jen v menu skupiny „Zobrazit“ ([[11-ui#Komponenty]], Toolbar). `session.ts` se nemění: `viewport.camera` závislost splní strukturálně.
- `ui` id akcí nezná natvrdo: bere `ACTION_IDS`, `FILE_ACTION_IDS`, `toolActionId` a `toolModes` z datového vstupního bodu `@/interaction/constants` ([[01-architektura#Vrstvy a moduly]], [[M20-zpevneni-struktury|M20]] D6). `toolModes(tool: { modes?: readonly Mode[] })` má strukturální parametr, protože `constants.ts` nesmí importovat `tools.ts`.

## Akce a klávesové zkratky

```ts
export interface Action {
  readonly id: string;              // 'undo', 'feature.delete'
  readonly label: string;           // klíč překladu (ADR 0014)
  readonly shortcut?: string | readonly string[];  // 'Mod+Z'; víc zkratek = alternativy ('Delete', 'Backspace')
  readonly group?: string;          // 'feature' = kontextové menu featury (M10)
  readonly enabled: Observable<boolean>;
  run(): void;
}

export interface ActionState {
  readonly id: string;
  readonly label: string;
  readonly shortcut: string | null;   // první zkratka (pro zobrazení)
  readonly group: string | null;
  readonly enabled: boolean;
}

export interface ActionRegistry {
  readonly actions: Observable<readonly ActionState[]>;   // v pořadí registrace
  register(a: Action): void;
  run(id: string): boolean;                  // false = akce zakázaná
  handleKey(e: ViewKeyEvent): boolean;       // najde akci podle zkratky
  dispose(): void;                           // odhlásí se od enabled všech akcí
}

export function createActionRegistry(): ActionRegistry;
```

- Víc zkratek: `handleKey` spustí akci na kteroukoli z nich; duplicita se hlídá mezi všemi zkratkami všech akcí. Kontextové menu featury v [[Timeline]] tvoří akce s `group: 'feature'` v pořadí registrace; pravé tlačítko featuru nejdřív vybere (jako Fusion), takže akce pracují s výběrem (rozhodnutí 2026-10-13).
- `enabled` je `Observable` ([[Q067 Změna enabled u akcí|Q067]]): registr se k němu přihlásí při `register` a při změně vytvoří nový snapshot, ve kterém je nový jen `ActionState` změněné akce.
- Zkratka: tokeny oddělené `+`, nejdřív modifikátory `Mod`, `Shift`, `Alt` (libovolné pořadí, každý nejvýš jednou), poslední je klávesa podle `KeyboardEvent.key` (`Z`, `Delete`, `Escape`, `F2`…). Písmena se porovnávají bez ohledu na velikost (Shift mění `key` na velké písmeno). Modifikátory musí sedět přesně: `Mod+Z` se nespustí na `Mod+Shift+Z`. Neplatná zkratka (neznámý modifikátor, chybí klávesa, opakovaný modifikátor) → výjimka v `register`.
- `register`: duplicitní `id` nebo duplicitní zkratka (po normalizaci) → výjimka.
- `run(id)`: neznámé id → výjimka. Zakázaná akce se nespustí a vrátí `false`.
- `handleKey(e)`: `e.inTextField` → `false`. Akce se zkratkou nalezena → spustí ji, je-li povolená, a vrátí `true` i u zakázané (zkratka je „naše“, prohlížeč s ní nemá dělat výchozí akci). Nenalezena → `false`.
- Názvy modifikátorů a pojmenované klávesy (`Delete`, `F2`) se porovnávají přesně, bez ohledu na velikost se porovnávají jen jednoznakové klávesy. Klávesa `+` zapsat nejde (prázdný token je chyba); až bude potřeba, přibude alias `Plus`.
- Interně se zkratka i `ViewKeyEvent` převedou na kanonický řetězec (`Mod+Shift+z`), hledání je pak vyhledání v mapě.
- Po `dispose` registr dál spouští akce, jen snapshot `actions` už nesleduje `enabled`. `dispose` patří ke konci session aplikace.
- Formátování zkratky pro zobrazení (⌘ na macOS) je věc `ui`.

Akce registruje `createBuiltInActions` volané z `app` (undo, redo, smazat výběr, potlačit featuru, aktivovat nástroj X, fit all). UI z nich staví menu a toolbar; zkratky fungují globálně, pokud fokus není v textovém poli.

## Testy

- `FakeViewport`, `FakeRegenStatus`: zaznamenaný stav a ruční emit.
- `SelectionModel`: `set` s duplicitami, `toggle` přidá/odebere, `clear`, žádná emise beze změny, vyčištění `face`/`edge` při nové generaci (`feature`/`body` zůstávají); `bindSelectionHighlight`.
- `ToolManager`: výchozí nástroj po vytvoření, přepínání a deaktivace předchozího, neznámé id, `finish` (i uvnitř `activate`, i starý `ctx`), `Escape`, `unhandledKey`, přeposílání událostí jen aktivnímu nástroji, zakrytí nástrojem `refPick` podle `activeRefParam`.
- `SelectTool` s `FakeViewport`: hover, `leave`, klik → `set`, Shift+klik → `toggle`, klik do prázdna → `clear`, tažení nad toleranci nic nevybere, pravé tlačítko ignoruje, `Escape`.
- `FeatureEditSession` se skutečným dokumentem a dispečerem (jádro ani regenerace nejsou potřeba; `interaction` na `kernel` nesmí ani v testech). Integrační test v `tests/` s `FakeKernel` a regenerací ověří živý náhled. Případy: create → `setParam` ×20 → commit = **jeden** záznam v logu; cancel = dokument i log beze změny; jméno `Box 2`; vložení na bar; edit featury před i za barem posune bar dočasně a po commit/cancel ho vrátí, v logu není `studio.setRollback`; neplatná hodnota → `issues`; druhá session → výjimka; příkazy po zavření → výjimka; undo zakázané během session.
- `ActionRegistry`: zkratky včetně `Mod` a `Shift`, přesná shoda modifikátorů, velikost písmen, ignorování v textovém poli, zakázaná akce, neplatná a duplicitní zkratka, nový snapshot jen pro změněnou akci.
- `FeatureTreeModel`: snapshot řádků po přidání featury, chybě regenerace, potlačení a posunu rollback baru; nový snapshot je nový objekt, nezměněný řádek zůstává identický; `selected`, `editing`; `rename` s mezerami a prázdné; `dependents`, `dependentsOf`, `move` (platný, odmítnutý, existující porušení) – M11.
- `feature.delete` s potvrzením: bez závislých bez dotazu, se závislými dotaz s `n`, zamítnutí nic nesmaže (M11).
- `BrowserModel`: jméno a viditelnost z metadat, operace přes dispečer a undo, neznámé těleso a otevřená transakce nic, `select` do aktivního parametru `bodies`, `canEdit` a přejmenování (`renaming`, `rename(null)`, ukončení ztrátou `canEdit`) (M11). `FeatureEditSession`: `refs` (jména, chybějící těleso, neplatná položka, přepočet po změně dokumentu) a `removeRef` (M11).
- Režimy (M12): `ToolManager` přepne výchozí nástroj při změně režimu, odmítne nástroj mimo režim, `finish`/`Escape` vrací na výchozí nástroj režimu; `ActionRegistry` – stejná zkratka v disjunktních režimech, `handleKey` podle režimu, `enabled` ve snapshotu podle režimu; vestavěné akce nástrojů v obou režimech.
- Skicář (M12, `FakeSolver`, `FakeViewport`): `create` (rovina, výchozí XY, neznámá rovina), `edit` (jiný typ → výjimka), první řešení bez zápisu, `addGeometry`/`addConstraint`/`setDimension`/`remove` pro `'ok'`, `'conflict'`, `'failed'`, redundantní vazba, vynechání redundantních automatických vazeb, sériová fronta, tažení (jeden rozpracovaný a jeden čekající cíl přes `hold`/`release`), výsledek po zavření zahozen, kresba a styly (`defined` u plně určené), `finish` = jeden záznam v logu, `cancel` = log beze změny; akce skicáře (povolení podle výběru); nástroje s `FakeViewport` (polyline s uzavřením, automatická vodorovná, snap na bod a na počátek, obdélník, kružnice, oblouk, kóta, tažení ve výběrovém nástroji); `toSketchDrawing`, `artifactDrawing`, `planeDrawing`; `FeatureEditSession.setParams`; `BrowserModel` roviny a skici; `FeatureTreeModel.edit` skici.
- M13: `FieldState.hidden`, `group`, `heading`, `refText`; `regionRefsOf`/`axisRefOf` (vnitřní v `interaction`: jediné čtení referencí oblastí a os, odmítnou prázdný `sketch` nebo `sketch` s `/`); `activeRefParam` a `focusRefParam` se skrytými parametry; `create` aktivuje první viditelný referenční parametr; `pickFilter` tabulky druhů pro `region` a `axis`; `refPick` – oblast (přidat, odebrat, `'sketch-edit'` ignorovat), osa počátku, úsečka skici, kružnice ignorovaná; `artifactDrawing` s konstrukčními čarami a oblastmi (díra), `axisDrawing`; `bindSelectionHighlight` s oblastmi dialogu; `BrowserModel` osy a oblasti; `ToolContext` bez `ops`, viewport nástroje bez `manipulators`, `events`, `sketches`, `project` a `setSelection` (typově, M20).
- M15: `HistoryModel` (prázdný log; tři `do` v obráceném pořadí; undo → řádek `undo` s `target` a `do` `undone`; redo; undo + nové `do` → `abandoned`; prázdný log → `older` 0; 250 záznamů → 200 řádků, `total` 250 a `older` 50; nezměněné řádky `===`; log obnovený ze záznamů dá stejné řádky); `createFileActions` s `FakeFileExporter` (zákazy bez těles, se skrytými, s dialogem, v režimu skici; jen viditelná tělesa v pořadí; `running` zakáže obě akce; `idle`, `failed` a `dismiss`; `dispose`); `BrowserModel` barva (řádek, `setColor` a undo, `colors` jen pro tělesa poslední regenerace, zákazy, neplatná barva). M24: `BrowserModel` materiál stejnými případy jako barva (řádek s výchozím `'plastic'`, `setMaterial` a undo, `materials` bez výchozího, zákazy, neplatná hodnota, pořadí vyslání).
- M19.2 (vlna 2): `HistoryModel` vynechá `document.rename` (žádný řádek, nezapočítá se, žádná nová emise); každá akce standardního pohledu zavolá `camera.setView` se svou hodnotou a zůstává povolená i s otevřeným dialogem.
- Architektura: `interaction` projde `tsconfig.domain.json` a nezávisí na `regen`, `kernel`, `render`, `ui` (`npm run check`).

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
