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
tags:
  - spec
created: 2026-10-12
updated: 2026-10-14
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
  readonly events: Subscribable<{ pointer: ViewPointerEvent; key: ViewKeyEvent }>;
}

export type PickKind = 'face' | 'edge' | 'sketchEntity';   // 'sketchEntity' od M12, M14 přidá 'vertex'
export type PickFilter = readonly PickKind[];   // prázdné = nic nejde vybrat

/** Co jde zvýraznit: plocha nebo hrana tělesa, bez bodu a normály (Q065). */
export type HighlightTarget =
  | { kind: 'face'; body: BodyId; faceIndex: number }
  | { kind: 'edge'; body: BodyId; edgeIndex: number }
  | { kind: 'sketchEntity'; sketch: string; entity: string };   // M12; HighlightPort ho zatím ignoruje (zvýraznění nese styl kresby)

/** Výsledek pickingu je HighlightTarget doplněný o místo zásahu, lze ho předat přímo do setHover. */
export type PickResult =
  | { kind: 'face'; body: BodyId; faceIndex: number; point: Vec3; normal: Vec3 }  // normal = jednotková normála ve světě, směrem ven z tělesa
  | { kind: 'edge'; body: BodyId; edgeIndex: number; point: Vec3 }
  | { kind: 'sketchEntity'; sketch: string; entity: string; point: Vec3 };   // sketch = id kresby, entity = id bodu nebo křivky (M12)

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
export interface SketchDrawing { plane: Plane; curves: readonly SketchDrawingCurve[]; points: readonly SketchDrawingPoint[] }

export interface SketchPort {
  set(id: string, drawing: SketchDrawing): void;   // nahradí kresbu pod id
  remove(id: string): void;                        // neznámé id = nic
}

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

export interface KeyMods { readonly shift: boolean; readonly alt: boolean; readonly mod: boolean } // mod = Cmd/Ctrl
```

- Port definuje `interaction`, protože ho potřebuje. `render` ho implementuje (`Viewport`) a z `interaction` importuje jen tyto typy.
- `interaction/index.ts` re-exportuje typ `BodyId` z `document` jako součást slovníku portu. `render` ho bere odtud a na `document` nesahá ([[Q056 Odkud render bere BodyId|Q056]]).
- V kódu mají všechna pole typů portu `readonly` ([[Neměnná data]]), ve výpisu výše jsou kvůli čitelnosti vynechaná. Mapa událostí `{ pointer, key }` má v kódu jméno `ViewportEvents`.
- `pick` s filtrem (M10.1): pořadí druhů ve filtru nemá význam, hrana má přednost před plochou jako dosud; prázdný filtr → `null` bez dotazu na scénu. Nástroj nebo parametr dialogu tak určí, co jde vybrat, a hover nezvýrazňuje nic jiného.
- `sketches` (M12): stejné zrcadlo jako overlay, ale s id entit a pickovatelné (`'sketchEntity'` ve filtru; výchozí filtr ho neobsahuje, `SelectTool` o něm neví). Editovanou skicu kreslí `SketchEditor`, skici z regenerace a roviny `app` ([[#Skicář]]). `FakeViewport` kresby zaznamenává (`sketchDrawings: ReadonlyMap<string, SketchDrawing>`).
- `PickResult` je definovaný jen tady, [[09-vykreslovani]] na něj odkazuje. Varianta `vertex` přibude, až bude výběr vrcholů potřeba ([[Q057 Tvar PickResult|Q057]]).
- `HighlightPort` je zrcadlo: stav hoveru a výběru drží `interaction` a vždy ho předá celý. Bere `HighlightTarget`, protože výběr bod zásahu nezná ([[Q065 Cíl zvýraznění bez bodu a normály|Q065]]); `PickResult` je jeho podtyp, takže výsledek `pick` jde předat beze změny. `OverlayPort` nese jen platformově nezávislé tvary ve světových souřadnicích, žádné typy Three.js. Další druhy (síť pro náhled tělesa) přibudou s potřebou ([[Q058 Kontrakt HighlightPort a OverlayPort|Q058]]).
- `ViewPointerEvent` chodí pro všechna tlačítka. Pravé a prostřední tlačítko zároveň ovládá kameru, nástroje je mají ignorovat. Kolečko se do `interaction` neposílá, patří jen kameře.
- Převod DOM událostí na `ViewPointerEvent`/`ViewKeyEvent` dělají adaptéry (`render` pro canvas, `ui` pro globální klávesnici). Adaptér také převádí Cmd (macOS) / Ctrl (jinde) na `mods.mod`, takže `interaction` platformu nezná. Do `interaction` se DOM typ nikdy nedostane.
- V testech nahrazuje viewport `FakeViewport` (předpřipravené výsledky `pick`, ruční emit událostí, zaznamenaný stav `highlight` a `overlay`). `pick` si zapamatuje poslední filtr (`lastFilter`; `undefined` před prvním voláním i po volání bez filtru) a připravený výsledek vrátí jen tehdy, když jeho `kind` je ve filtru (bez filtru platí výchozí `['edge', 'face']`); připravenou funkci volá vždy, i s prázdným filtrem, aby test poznal, že `refPick` s prázdným filtrem `pick` nevolá.

## Port stavu regenerace

`interaction` nesmí znát `regen`, ale strom featur ukazuje chyby regenerace a výběr podtvarů se po regeneraci čistí. Proto si `interaction` definuje vlastní port a `app` ho plní z [[Stav regenerace|RegenState]] ([[Q063 Stav regenerace v interaction|Q063]], [[Q064 Výběr po regeneraci|Q064]]).

```ts
export type FeatureHealth =
  | { kind: 'ok' }
  | { kind: 'warning'; message: string }
  | { kind: 'error'; message: string; issues?: readonly ParamIssue[] };   // issues = neplatné parametry (INVALID_PARAMS), překládá ui

export interface RegenBody { readonly body: BodyId; readonly feature: FeatureId }

export interface RegenSnapshot {
  /** Roste o 1 s každou dokončenou regenerací; 0 = ještě žádná. */
  readonly generation: number;
  /** Featury, které poslední regenerace vyhodnotila (ne potlačené, ne za barem). */
  readonly health: ReadonlyMap<FeatureId, FeatureHealth>;
  /** Tělesa poslední regenerace v pořadí, v jakém je ukazuje Prohlížeč (M10). */
  readonly bodies: readonly RegenBody[];
  /** Skici poslední regenerace v jejím pořadí (M12): Prohlížeč, skupina Skici. */
  readonly sketches: readonly RegenSketch[];
}

export interface RegenSketch { readonly sketch: SketchId; readonly feature: FeatureId }   // M12

export interface RegenStatusPort {
  readonly state: Observable<RegenSnapshot>;
}
```

- `health` je `ReadonlyMap`, ale `Map` zmrazit nejde: adaptér v `app` posílá v každém snapshotu **novou** mapu a už ji nemění. `interaction` ji jen čte.
- Potlačení a pozice za barem port nenese: `interaction` je čte přímo z dokumentu, takže se projeví hned, ne až po regeneraci.
- V testech port nahrazuje `FakeRegenStatus` (`testing.ts`) s metodou `publish(health, bodies?, sketches?)`, která zvýší `generation` (chybějící seznamy prázdné). Port nese `sketches` vedle `bodies` místo sjednocení `artifacts` z revize – stejná informace s menší změnou ([[Rozhodnutí noční rychloakce#M12 – Skicář|R38]] ⚠). `RegenBody` se exportuje, potřebuje ho adaptér v `app`.

## Prezentační modely a `Observable`

Stav, který UI zobrazuje, vystavují prezentační modely jako `Observable<T>` z `core` (neměnný snapshot + `subscribe`). Pohled volá jen příkazy. **Prezentační modely nemají vlastní `events`, jediný kanál změn je `Observable`** ([[0010-prezentacni-model|ADR 0010]]).

| Model | Stav pro UI | Příkazy |
|---|---|---|
| `FeatureTreeModel` | `rows: Observable<readonly TreeRow[]>`, `rollbackIndex: Observable<number>` | `edit`, `rename`, `moveRollbackBar`, `select` |
| `FeatureEditor` | `current: Observable<FeatureEditSession \| null>` | `create`, `edit` |
| `FeatureEditSession` | `state: Observable<EditState>` (parametry, chyby, pole formuláře, aktivní referenční parametr) | `setParam`, `removeRef`, `focusRefParam`, `commit`, `cancel` |
| `ToolManager` | `active: Observable<string>` | `activate` |
| `ActionRegistry` | `actions: Observable<readonly ActionState[]>` | `run` |
| `SelectionModel` | `items: Observable<readonly SelectionItem[]>` | `set`, `toggle`, `clear` |
| `SketchEditor` (M12) | `current: Observable<SketchSession \| null>`, `mode: Observable<Mode>` | `create`, `edit` |
| `SketchSession` (M12) | `state: Observable<SketchState>` (entity, vazby, stupně volnosti, výběr, řádky vazeb) | `addGeometry`, `addConstraint`, `setDimension`, `remove`, `drag`, `select`, `finish`, `cancel` |

Společná pravidla snapshotů:
- Model vystavuje `ObservableValue.asObservable()`, nikdy samotnou `ObservableValue` (přetypováním by šlo zapisovat, revize M9). Závislosti dostává v nejužší potřebné podobě: `RegistryReader` místo registru, `SelectionCommands` místo `SelectionModel`, `Pick<FeatureEditor, …>` místo celého editoru ([[0011-programovani-proti-rozhranim|ADR 0011]]).
- Snapshot je zmrazený ([[Neměnná data]]). Nový snapshot vzniká jen při skutečné změně obsahu; beze změny `subscribe` nic nedostane.
- Položky pole, které se nezměnily, jsou v novém snapshotu **tytéž objekty** (`===`). UI tak překreslí jen změněné řádky.

## Výběr

```ts
export type SelectionItem =
  | { kind: 'feature'; feature: FeatureId }
  | { kind: 'body'; body: BodyId }
  | { kind: 'face'; body: BodyId; faceIndex: number }
  | { kind: 'edge'; body: BodyId; edgeIndex: number }
  | { kind: 'plane'; plane: PlaneId };   // M12: rovina z Prohlížeče (vstup do skici)

export interface SelectionModel {
  readonly items: Observable<readonly SelectionItem[]>;
  set(items: readonly SelectionItem[]): void;
  toggle(item: SelectionItem): void;
  clear(): void;
  dispose(): void;              // odhlásí se od RegenStatusPort; výběr dál funguje, jen se po regeneraci nečistí
}

/** Co dostávají spotřebitelé výběru (nástroje, strom): bez dispose, ten patří app (revize M9). */
export type SelectionCommands = Omit<SelectionModel, 'dispose'>;

export function createSelectionModel(deps: { regen: RegenStatusPort }): SelectionModel;
export function sameSelectionItem(a: SelectionItem, b: SelectionItem): boolean;

/** Zrcadlí položky face/edge výběru do HighlightPort.setSelection; vrací odhlášení. */
export function bindSelectionHighlight(selection: SelectionModel, highlight: HighlightPort): Unsubscribe;
```

- Výběr je **dočasný stav session**, neukládá se do dokumentu ani do logu.
- Položky se porovnávají hodnotou (`sameSelectionItem`: druh + id + index). Výběr neobsahuje duplicity a drží pořadí, v jakém položky přibyly.
- `set` odstraní duplicity (první výskyt vyhrává). `set` se stejným obsahem nic nevyšle.
- `toggle`: položka ve výběru → odebere ji; jinak ji přidá na konec.
- Model ukládá zmrazené kopie položek jen s poli jejich druhu, nikdy objekt volajícího (předaný `PickResult` tak do výběru nezanese `point` a `normal`). Položka, která už ve výběru je, zůstává v novém snapshotu týmž objektem.
- `clear` na prázdném výběru nic nevyšle.
- Indexy ploch/hran platí jen pro aktuální regeneraci. Když `RegenStatusPort` ohlásí novou `generation`, výběr odebere položky `face` a `edge` (od M14 je přemapuje přes topologická jména). Položky `feature`, `body` a `plane` zůstávají.
- `bindSelectionHighlight` při každé změně předá `HighlightPort.setSelection` položky `face`/`edge` v pořadí výběru (ihned při navázání i jednou). Zvýraznění `feature`/`body` přibude s potřebou.
- Filtr výběru (jen plochy, jen hrany…) nastavuje aktivní nástroj nebo parametr dialogu.

## Nástroje

```ts
export interface Tool {
  activate(ctx: ToolContext): void;
  deactivate(): void;
  onPointer?(e: ViewPointerEvent): void;
  onKey?(e: ViewKeyEvent): boolean;      // true = událost zpracována
}

export interface ToolContext {
  readonly viewport: ViewportPort;       // pick, overlay, screenToRay
  readonly selection: SelectionCommands;
  readonly doc: DocumentReader;
  readonly ops: OperationDispatcher;
  readonly ids: IdGenerator;
  readonly features: FeatureEditor;      // vytvoření/úprava featury přes dialog (níže)
  finish(): void;                        // nástroj skončil → ToolManager přepne na výchozí
}

export interface ToolDescriptor {
  readonly id: string;
  readonly label: string;
  readonly icon: string;                 // název ikony, UI si ji přeloží
  readonly group: 'select' | 'primitive' | 'sketch' | 'feature' | 'modify' | 'draw' | 'constrain';   // 'draw', 'constrain' od M12 (lišta skicáře)
  readonly modes?: readonly Mode[];      // režimy, ve kterých nástroj je; výchozí ['model'] (M12)
  readonly shortcut?: string;            // jen informace pro UI; zkratku registruje app jako akci
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
  defaultToolId: string;
  /** Klávesy z viewportu, které nástroj nezpracoval (app sem napojí ActionRegistry.handleKey). */
  unhandledKey?: (e: ViewKeyEvent) => boolean;
}): ToolManager;

export const SELECT_TOOL: ToolDescriptor;   // id 'select', group 'select'
```

- `Tool` nemá `id`: identitu nese `ToolDescriptor`, instanci vytváří `create()` při každé aktivaci (nástroj začíná vždy s čistým stavem).
- Vždy je aktivní právě jeden nástroj. `createToolManager` hned aktivuje výchozí (`defaultToolId` musí být v registru, jinak výjimka).
- `activate(id)`: neznámé id → výjimka a aktivní nástroj zůstává. Stejné id jako aktivní → nic. Jinak `deactivate()` předchozího, `create()` + `activate(ctx)` nového, `active` vyšle nové id.
- Každá aktivace dostane vlastní `ctx` s `finish` svázaným s touto instancí. `finish()` neaktivního (starého) nástroje nedělá nic, `finish()` výchozího nástroje také ne.
- `finish()` volaný **uvnitř** `activate` (nástroj typu „otevři dialog a skonči“) se provede až po návratu z `activate`: `active` vyšle id nástroje a hned potom výchozí.
- Výjimka z `descriptor.create()` nebo `tool.activate()`: manager nástroj zahodí (bez `deactivate`), aktivuje výchozí nástroj a výjimku pošle dál; `active` pak ukazuje výchozí. Selže-li sám výchozí nástroj, manager zůstane bez aktivního nástroje (události zahazuje) a výjimka letí dál – chyba programátora; selhal-li předtím jiný nástroj, letí `AggregateError` s oběma chybami. `createToolManager` spouští výchozí nástroj před přihlášením k událostem, takže při jeho selhání nic nezůstane přihlášené.
- Po `dispose` hodí `activate` výjimku, druhé `dispose` nic nedělá.
- `ToolManager` přeposílá `pointer` a `key` z `ViewportPort.events` aktivnímu nástroji. Klávesa: nejdřív `tool.onKey`; když vrátí `false` nebo ho nemá, `Escape` bez modifikátorů mimo textové pole ukončí nevýchozí nástroj (návrat k výchozímu). Ostatní nezpracované klávesy jdou do `unhandledKey`.
- **Referenční parametr dialogu** ([[Q066 Klik do referenčního parametru|Q066]]): `ToolManager` sleduje `ctx.features.current` a `state` aktuální session. Dokud má session `activeRefParam !== null`, posílá události vnitřnímu nástroji `refPick` místo aktivního nástroje (ten zůstává aktivní, `active` se nemění, jen je dočasně „zakrytý“). `refPick`: `move` → hover z `pick`; levý klik na cíl povoleného druhu → přidá/odebere referenci v parametru přes `setParam`; `Escape` → `focusRefParam(null)`. Když `activeRefParam` zmizí, `refPick` zruší hover a události jdou znovu aktivnímu nástroji. `FeatureEditor` o nástrojích neví, takže nevznikne cyklus. Filtr pickingu odvodí `refPick` z `ParamSpec` aktivního parametru čistou funkcí `pickFilterFor(spec): PickFilter` (M10.1): `bodies` → `['face', 'edge']` (zásah čehokoli je těleso), `topo` s `entity: 'face'` → `['face']`, `'edge'` → `['edge']`, `'vertex'` → `[]` (do M14), `region` a ostatní → `[]`; stejný filtr platí pro hover; `refPick` filtr odvozuje při každé události (`ToolManager` ho při přepnutí z jednoho referenčního parametru na jiný znovu nevytváří) a při změně `activeRefParam` zruší hover (`setHover(null)`), aby nezůstal zvýrazněný cíl, který nový filtr nepovoluje (rozhodnutí 2026-10-14). Převod pick → reference (`BodyRef`, `TopoRef`) je v M9 jen pro `bodies`: zásah plochy i hrany dá `{ kind: 'body', body }`, nové pole je zmrazené, pořadí se drží, hodnota, která není pole, se bere jako prázdné pole. `topo` se doplní s topologickým pojmenováním (M14). `refPick` není `Tool` z registru (nepotřebuje `ToolContext` ani `finish`); zakrytý nástroj nedostane `deactivate` ani jiný signál a jeho hover obnoví až další `move`.

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
  readonly issues: readonly ParamIssue[];                // schema.validate(params)
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
}

export interface FieldRef {
  readonly index: number;              // pozice položky v hodnotě
  readonly body: BodyId | null;        // null = položka není odkaz na těleso správného tvaru
  readonly label: string | null;       // bodyRefLabel(doc, body); null = chybějící těleso („Chybí těleso“)
}
```

**`create(type)`**
1. Předpoklady (jinak výjimka, nic se nezmění): žádná otevřená session, dispečer není v transakci, typ je v `schemas`.
2. `ops.begin(schema.label)`, pak `tx.apply(feature.add)` s `id = ids.next()`, `typeVersion = schema.version`, `params = schema.defaults()`, `suppressed: false`, `index = rollbackIndex`.
3. Jméno: `"<schema.label> <n>"`, kde `n` je nejmenší kladné číslo, pro které takové jméno ve studiu ještě není.
4. Vložení na pozici baru posune bar za novou featuru samo (pravidlo mutátoru v [[03-dokument]]), takže nová featura je aktivní ([[Q068 Kam se vloží nová featura|Q068]]).
5. `activeRefParam` nové session = první parametr schématu druhu `bodies`, `topo` nebo `region` (v pořadí schématu), jinak `null` – výběr ve viewportu a v Prohlížeči jde rovnou do něj, jako v Onshape (M11, [[Rozhodnutí noční rychloakce#M11 – Další entity|R19]]). `edit` začíná s `null`.

**`edit(featureId)`**
1. Předpoklady jako u `create`; neznámá featura → výjimka.
2. `ops.begin('feature.edit')` – popisek transakce je klíč překladu ([[0014-preklady-vue-i18n-a-klice|ADR 0014]]), jméno featury do něj nepatří. Je-li `rollbackIndex !== index + 1`, `tx.applyTransient(studio.setRollback(index + 1))`: bar je během editace těsně za editovanou featurou, ať byla před barem, nebo za ním. Pozdější featury se nepřehrávají a náhled ukazuje model ve stavu editované featury ([[Q018 Rollback bar při editaci starší featury|Q018]]). Přechodná operace se při `commit` i `cancel` vrátí sama a do logu se nedostane ([[04-operace-a-historie]]).

**Session**
- `setParam(name, value)`: `name` musí být klíč `schema.params`, jinak výjimka. Nové `params = { ...params, [name]: value }` → `tx.apply(feature.setParams)` s `typeVersion: schema.version` ([[04-operace-a-historie#Migrace dat featur]]). Hodnota se **nekontroluje** před aplikací: neplatné parametry dokument unese, regenerace featuru označí chybou a `issues` je ukážou. `setParam` se stejnou hodnotou (`Object.is` u primitiv) nic neaplikuje. Selže-li handler, výjimka letí dál a session zůstává otevřená beze změny.
- `setParams(patch)` (M12): každý klíč musí být v `schema.params`, jinak výjimka a nic se neaplikuje; nové `params = { ...params, ...patch }` → **jedna** `feature.setParams`; když jsou všechny hodnoty `Object.is` shodné s aktuálními, nic. Jinak pravidla jako `setParam`.
- `removeRef(name, index)` (M11): neznámý parametr → výjimka. Hodnota, která není pole, `index` mimo rozsah (nebo neceločíselný) a zavřená session → nic. Jinak `setParam(name, hodnota bez položky na index)`.
- `params` čte session vždy z dokumentu (jediný zdroj pravdy), `issues = schema.validate(params)` se přepočítá po každé změně.
- `refs` (M11): pro každou položku hodnoty parametru druhu `bodies` jeden `FieldRef`; `body` z `bodyOfRef` (ověří tvar id přes `parseBodyId`, hodnota parametru smí být neplatná), `label` z `bodyRefLabel` v `ref-values` (interní, pravidla níže a [[Rozhodnutí noční rychloakce#M11 – Další entity|R25]]). Jména jsou z dokumentu, proto se otevřená session přepočítá i při `doc.events.changed`; nezměněné `refs` zůstávají týž objekt.
- `bodyRefLabel(doc, body)`: featura původu v dokumentu chybí → `null`, i když těleso má jméno v metadatech (metadata smazané featury v dokumentu zůstávají, čip má ukázat „Chybí těleso“); jinak `userName` z metadat, jinak jméno featury původu (u `bodyId(f, n)` s příponou ` (n)`). Nečte poslední regeneraci: náhled booleanu nástroj z mapy těles odebere, ale čip v dialogu ho musí pojmenovat dál.
- `focusRefParam(name)`: `name` musí být parametr druhu `bodies`, `topo`, `region` nebo (M12) `planes`, jinak výjimka (i pro neznámé jméno). `null` zruší fokus. Stejné jméno znovu nevytvoří nový snapshot.
- `commit()`: `tx.commit()` → session zavřená (`open: false`), `editor.current` → `null`. Celý dialog je v logu **jeden** záznam. `commit` je povolený i s `issues` (featura s chybou je v Onshape také platný stav).
- `cancel()`: `tx.abort()` → dokument i log beze změny, session zavřená, `current` → `null`.
- Po zavření hodí každý příkaz výjimku – kromě `removeRef`, který nic neudělá (× u čipu může přijít z doznívajícího UI). Poslední snapshot má `open: false` a `activeRefParam: null`; `params` drží poslední známé hodnoty (po zrušeném `create` featura v dokumentu už není).
- Session se zavře, až transakce opravdu skončí (`!ops.inTransaction`), i když odběratel při `commit`/`abort` vyhodí.
- Selže-li hned po `begin` `feature.add` nebo přechodný posun baru, `FeatureEditor` transakci zruší a výjimku pošle dál; session nevznikne.
- Během otevřené session jsou undo/redo zakázané (pravidlo transakcí, `UndoManager.canUndo()` vrací `false`).

Díky tomu je nástroj pro většinu featur triviální – `ToolDescriptor`, jehož `create()` vrací nástroj, který při aktivaci zavolá `ctx.features.create('box')` a skončí (je-li už otevřená jiná session, jen skončí). Interaktivní tvorbu tažením myší si plugin může dopsat jako vlastní `Tool`, který mezivýsledky posílá přes `FeatureEditSession.setParam` (odloženo do [[M13-extrude-revolve]]).

## Strom featur: `FeatureTreeModel`

```ts
export type TreeStatus = 'ok' | 'warning' | 'error' | 'suppressed' | 'rolledBack' | 'pending';

export interface TreeRow {
  readonly id: FeatureId;
  readonly name: string;
  readonly type: string;
  readonly typeLabel: string;          // schema.label (klíč); neznámý typ → type
  readonly icon: string | null;        // schema.icon (název ikony Tabler); neznámý typ → null
  readonly issues: readonly ParamIssue[] | null;  // z FeatureHealth error (neplatné parametry), jinak null
  readonly status: TreeStatus;
  readonly message: string | null;     // u warning/error
  readonly selected: boolean;          // výběr obsahuje { kind: 'feature', feature: id }
  readonly editing: boolean;           // featura otevřené session
  readonly dependents: number;         // počet featur, které na featuře závisí (dependentsOf, M11) – tooltip
}

export interface FeatureTreeModel {
  readonly rows: Observable<readonly TreeRow[]>;
  readonly rollbackIndex: Observable<number>;
  edit(id: FeatureId): void;                                   // → FeatureEditor.edit
  rename(id: FeatureId, name: string): void;                   // → dispatch feature.rename
  moveRollbackBar(index: number): void;                        // → dispatch studio.setRollback
  readonly renaming: Observable<FeatureId | null>;             // featura v režimu přejmenování (inline pole v Timeline)
  beginRename(id: FeatureId): void;                            // akce feature.rename
  cancelRename(): void;                                        // rename() režim také ukončí; beginRename neznámé featury → výjimka; zmizelá featura → id nesedí na žádný řádek
  select(id: FeatureId, opts?: { additive?: boolean }): void;  // → selection.set / toggle
  /** Featury mimo ids, které závisí na kterékoli z ids; v pořadí studia, bez duplicit (M11). */
  dependentsOf(ids: readonly FeatureId[]): readonly FeatureId[];
  /** Přesun featury; prázdné = přesunuto (feature.move), jinak nová porušení pořadí a nic se nestalo (M11). */
  move(id: FeatureId, toIndex: number): readonly OrderViolation[];
  dispose(): void;
}

export function createFeatureTreeModel(deps: {
  doc: DocumentReader; ops: OperationDispatcher; schemas: RegistryReader<FeatureSchema>;
  regen: RegenStatusPort; editor: Pick<FeatureEditor, 'current' | 'edit'>; selection: SelectionCommands;
  sketchEdit?: (id: FeatureId) => void;   // M12: edit featury typu SKETCH_FEATURE_TYPE jde sem místo FeatureEditor.edit
}): FeatureTreeModel;
```

- `typeLabel` a `message` jsou od [[0014-preklady-vue-i18n-a-klice|ADR 0014]] klíče překladu (případně s parametry), překládá je `ui`. Zprávy z jádra (`KernelError.message`) zůstávají technický text a UI je ukáže pod přeloženým nadpisem chyby.
- Řádky v pořadí featur dokumentu. Stav: `suppressed` (z dokumentu) > `rolledBack` (index `>= rollbackIndex`) > `health` z portu (`ok`/`warning`/`error`) > `pending` (featura v `health` chybí, např. ještě neproběhla regenerace).
- Model se přepočítá při `doc.events.changed`, změně `regen.state`, `selection.items` a `editor.current`. Nezměněný řádek je týž objekt, nezměněný seznam týž snapshot.
- `rows` a `rollbackIndex` se přepočítají v jednom kroku, ale vyšlou se postupně (nejdřív `rows`). Odběratel jednoho proto nemá v callbacku číst druhé; Vue překresluje dávkově v mikroúloze, takže v UI nekonzistence nevznikne. Kdyby to vadilo jinde, sloučí se do jednoho `Observable<TreeSnapshot>`.
- Nezměněný řádek se pozná porovnáním s řádkem na stejné pozici; po přesunu featury proto dostanou nový objekt i řádky, které se jen posunuly.
- `rename` neznámé featury → výjimka. `rename`: jméno se ořízne, prázdné nebo stejné → nic. `moveRollbackBar`: stejný index → nic, mimo `0..features.length` → výjimka.
- `rename` a `moveRollbackBar` během otevřené transakce hodí výjimku (z dispečera); UI je má v tu chvíli zakázat podle `editing`.
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
  readonly selected: boolean;         // výběr obsahuje { kind: 'body', body }
}

export interface BrowserModel {
  readonly bodies: Observable<readonly BrowserBodyRow[]>;
  readonly hidden: Observable<ReadonlySet<BodyId>>;   // tělesa poslední regenerace se skrytím v metadatech; app → viewport.setBodyVisible
  select(body: BodyId, opts?: { additive?: boolean }): void;
  readonly canEdit: Observable<boolean>;              // !locked: žádný dialog a dokument není jen pro čtení (R14)
  setVisible(body: BodyId, visible: boolean): void;   // → dispatch body.setVisible
  readonly renaming: Observable<BodyId | null>;       // těleso v režimu přejmenování (vložené pole v Prohlížeči)
  beginRename(body: BodyId): void;
  cancelRename(): void;
  rename(body: BodyId, name: string | null): void;    // ukončí přejmenování → dispatch body.rename; null = text nezměněn, jen ukončí
  // M12
  readonly planes: Observable<readonly BrowserPlaneRow[]>;        // ORIGIN_PLANES v pořadí
  readonly visiblePlanes: Observable<ReadonlySet<PlaneId>>;        // stav pohledu, výchozí prázdné; app → kresba roviny
  readonly sketches: Observable<readonly BrowserSketchRow[]>;     // skici poslední regenerace
  selectPlane(plane: PlaneId, opts?: { additive?: boolean }): void;  // → selection.set / toggle položky plane
  setPlaneVisible(plane: PlaneId, visible: boolean): void;
  selectSketch(feature: FeatureId, opts?: { additive?: boolean }): void;   // → výběr featury
  editSketch(feature: FeatureId): void;                            // → deps.sketchEdit
  dispose(): void;
}

export interface BrowserPlaneRow { readonly plane: PlaneId; readonly label: string; readonly visible: boolean; readonly selected: boolean }   // label = klíč 'origin.plane.xy'
export interface BrowserSketchRow { readonly sketch: SketchId; readonly feature: FeatureId; readonly name: string; readonly selected: boolean }  // name = jméno featury z dokumentu

export function createBrowserModel(deps: {
  doc: DocumentReader; ops: OperationDispatcher; regen: RegenStatusPort;
  selection: SelectionCommands; editor: Pick<FeatureEditor, 'current'>;
  locked: Observable<boolean>;                 // týž objekt jako session.locked z createEditLock
  sketchEdit?: (feature: FeatureId) => void;   // M12
}): BrowserModel;
```

- Model se přepočítá při změně regenerace, výběru i dokumentu. Při změně se nejdřív vyšle `hidden`, pak `bodies`. Těleso, které po regeneraci zmizí, ze `hidden` vypadne (jeho metadata v dokumentu zůstávají).
- `setVisible`, `beginRename` a `rename` tělesa, které poslední regenerace nezná (zastaralý řádek v UI), nic neudělají; během otevřené transakce (dialog) také nic a shodná hodnota také nic. `rename` jméno ořízne, prázdné jméno smaže (vrátí automatické). `canEdit = !locked`; UI ovládací prvky (oko, přejmenování) zakáže podle `canEdit`; při `false` `setVisible`, `beginRename` i `rename` nic ([[Rozhodnutí noční rychloakce#M11 – Další entity|R14]] ⚠ – v M10 šlo skrývat i během dialogu).
- Přejmenování (M11, [[Rozhodnutí noční rychloakce#M11 – Další entity|R28]]): stav režimu je v modelu, ne v komponentě (ADR 0010). `beginRename` → `renaming = body`; `cancelRename` a `rename` (vždy, i když nic nedispatchne) → `null`. Ztráta `canEdit` (otevření dialogu, režim jen pro čtení) přejmenování ukončí bez změny.
- `select(body)`: je-li otevřená session s `activeRefParam` druhu `bodies`, přidá nebo odebere těleso v tomto parametru (`setParam`, stejné přepínání jako `refPick`) a výběr nemění; jinak `selection.set`/`toggle` (M11, [[Rozhodnutí noční rychloakce#M11 – Další entity|R19]]).
- Roviny a skici (M12): viditelnost rovin je jen stav pohledu, neukládá se ([[Rozhodnutí noční rychloakce#M12 – Skicář|R48]] ⚠); skici oko nemají. `planes` a `sketches` se přepočítají se stejnými zdroji jako tělesa; nezměněný řádek zůstává týž objekt. Pořadí vyslání: `hidden`, `visiblePlanes`, `bodies`, `planes`, `sketches`.
- Jména čipů v dialogu Prohlížeč nepočítá (od Ú9a, dřív `refLabel`): jsou ve `FieldState.refs` z interní `bodyRefLabel` ([[#Dialog featury: `FeatureEditor`]]).

## Skicář

Režim skicáře je prezentační logika, proto je v `interaction` a ne v pluginu ([[0017-modul-sketch-a-skicar|ADR 0017]], [[12-skicar#Režim skicáře (interaction)]]). Datový model, oblasti a port řešiče bere z modulu `sketch`.

### Režim

```ts
// interaction/mode.ts
export type Mode = 'model' | 'sketch';
export const ALL_MODES: readonly Mode[];          // ['model', 'sketch']
```

Režim je `'sketch'`, právě když je otevřená `SketchSession` (`SketchEditor.mode`). Nemá vlastní stav ani příkazy: vstup a odchod jsou `SketchEditor.create`/`edit` a `SketchSession.finish`/`cancel`.

- **Nástroje** (`ToolDescriptor.modes`, výchozí `['model']`): `ToolManager` dostane `mode?: Observable<Mode>` a `defaultToolIds?: Partial<Record<Mode, string>>` (výchozí nástroj režimu `model` je dál `defaultToolId`; s `mode` musí být `defaultToolIds.sketch` v registru, jinak výjimka při vytvoření). Změna režimu deaktivuje aktivní nástroj a aktivuje výchozí nástroj nového režimu. `activate(id)` nástroje, který v aktuálním režimu není, hodí výjimku a aktivní nástroj zůstane. `finish()` i `Escape` vrací na výchozí nástroj **aktuálního** režimu.
- **Akce** (`Action.modes`, výchozí `ALL_MODES`): `createActionRegistry(deps?: { mode?: Observable<Mode> })`. Dvě akce smí mít stejnou zkratku, jen když mají disjunktní `modes` (jinak výjimka v `register`). `handleKey` hledá jen mezi akcemi aktuálního režimu. `ActionState` nese `modes` a jeho `enabled` = `action.enabled` **a** režim je v `modes`; změna režimu vytvoří nový snapshot jen se změněnými stavy. `run` akce mimo režim vrátí `false`.
- **Vestavěné akce** (`createBuiltInActions`, deps `mode?: Observable<Mode>`): `feature.*` a `timeline.*` mají `modes: ['model']`, `undo`, `redo`, `view.fitAll` všechny režimy. Akce nástroje má `modes` nástroje a `enabled` = v režimu `sketch` „nástroj je pro `sketch`“, v režimu `model` „`!locked` a nástroj je pro `model`“ (skicář je otevřená editace featury, takže `locked` je v něm `true`).

### `SketchEditor` a `SketchSession`

```ts
export interface SketchEditor {
  readonly current: Observable<SketchSession | null>;
  readonly mode: Observable<Mode>;                       // 'sketch' ⇔ current !== null
  /** Nová skica na rovině: FeatureEditor.create(SKETCH_FEATURE_TYPE), u jiné než výchozí roviny setParam('plane'). */
  create(plane: PlaneId): SketchSession;
  /** Úprava existující skici (FeatureEditor.edit). */
  edit(featureId: FeatureId): SketchSession;
}

export function createSketchEditor(deps: {
  features: FeatureEditor;
  solver: ConstraintSolver;
  viewport: ViewportPort;                                 // kresba 'sketch-edit'
  ids: IdGenerator;
  resolvePlane: (id: PlaneId) => Plane | undefined;       // app: ORIGIN_PLANES (M14: i plochy z regenerace)
}): SketchEditor;

export interface SketchSession {
  readonly featureId: FeatureId;
  readonly plane: Plane;
  readonly state: Observable<SketchState>;
  addGeometry(add: SketchData): Promise<boolean>;          // nové entity a vazby (nástroje); true = zapsáno
  addConstraint(c: SketchConstraint): Promise<boolean>;    // akce vazeb, kóta
  setDimension(id: SketchConstraintId, value: number): Promise<boolean>;
  remove(ids: readonly SketchItemId[]): Promise<boolean>;  // removeItems ze sketch
  toggleConstruction(ids: readonly SketchItemId[]): void;  // bez řešiče
  drag(point: SketchEntityId, to: Vec2): void;             // tažení bodu (výběrový nástroj)
  endDrag(): Promise<void>;                                // počká na dořešení posledního cíle
  setHover(id: SketchItemId | null): void;
  select(id: SketchItemId, opts?: { additive?: boolean }): void;   // bez additive = jen toto; additive = přepnout
  clearSelection(): void;
  clearEditingDimension(): void;
  finish(): void;                                          // FeatureEditSession.commit → jeden záznam v logu
  cancel(): void;                                          // FeatureEditSession.cancel → nic
}

export interface SketchState {
  readonly open: boolean;
  readonly name: string;                                   // jméno featury
  readonly entities: readonly SketchEntity[];              // z parametrů featury (parseSketchData; neplatná data → [])
  readonly constraints: readonly SketchConstraint[];
  readonly status: 'solving' | SolveStatus;                // poslední řešení; 'solving' jen před prvním výsledkem
  readonly dof: number | null;
  readonly fullyDefined: boolean;                          // status 'ok' && dof === 0
  readonly selection: readonly SketchItemId[];             // v pořadí výběru, jen existující položky
  readonly hover: SketchItemId | null;
  readonly message: { readonly key: SketchMessageKey } | null;
  readonly constraintRows: readonly SketchConstraintRow[]; // pro panel
  readonly editingDimension: SketchConstraintId | null;    // právě vytvořená kóta (ui dá jejímu poli fokus)
}
export type SketchMessageKey = 'sketch.conflict' | 'sketch.redundant' | 'sketch.solverFailed';
export interface SketchConstraintRow {
  readonly id: SketchConstraintId;
  readonly kind: SketchConstraint['kind'];
  readonly n: number;                                      // pořadí v rámci druhu od 1 („Vodorovná 2“)
  readonly value: number | null;                           // jen distance a radius
  readonly selected: boolean;
}
export const EDIT_SKETCH_DRAWING_ID = 'sketch-edit';
export const ORIGIN_POINT_ID = '__origin';                 // bod počátku v kresbě (snap)
```

**`create` / `edit`:** předpoklady jako u `FeatureEditor` (žádná otevřená session, dispečer mimo transakci; jinak výjimka a nic se nezmění); `create` s rovinou, kterou `resolvePlane` nezná, → výjimka před vytvořením featury; `edit` featury jiného typu než `SKETCH_FEATURE_TYPE` → výjimka; `edit` skici s nevyřešitelnou rovinou → session featury se zruší a výjimka. Session hned spustí řešení aktuálních dat **bez zápisu** (jen `status` a `dof`; zápis by do logu dostal šum výpočtu). Když se `FeatureEditSession` zavře jinak (dispose session aplikace), `SketchSession` se zavře také.

**Zápis změny** (`addGeometry`, `addConstraint`, `setDimension`, `remove`): příkazy běží **sériově** ve frontě; každý vezme aktuální data z dokumentu, sestaví nová, zavolá `solver.solve` a podle výsledku:

- `'ok'` → `FeatureEditSession.setParams({ entities: result.entities, constraints })`, `status`, `dof`, `message: null`, vrátí `true`. Výjimka: `addConstraint` (a kóta) vazby, která je v `redundant`, → nic, `message 'sketch.redundant'`, `false`. U `addGeometry` se nové vazby, které jsou v `redundant` (automatické vodorovné na snapu…), z dat vynechají a zbytek se zapíše.
- `'conflict'` → nic, `message 'sketch.conflict'`, `false`; `'failed'` nebo odmítnutí řešiče → nic, `message 'sketch.solverFailed'`, `false`.
- Data beze změny (stejné hodnoty) se nezapisují.
- Výsledek, který dorazí po zavření session, se zahodí (`false`). Po zavření hodí každý příkaz výjimku hned (ne odmítnutý slib).
- `remove` a `toggleConstruction` z výběru odeberou zmizelé položky; `toggleConstruction` zapíše hned (konstrukce řešení nemění).

**Tažení:** `drag(point, to)` je nejvýš jeden rozpracovaný `solve` s `drag` a jeden čekající cíl (další `drag` čekající cíl přepíše). Výsledek `'ok'` se zapíše jako výše; `'conflict'`/`'failed'` se tiše zahodí. Tažení se řadí do stejné fronty jako ostatní příkazy. `endDrag` se splní, až je fronta tažení prázdná.

**Kresba:** při každé změně `state` session pošle `viewport.sketches.set(EDIT_SKETCH_DRAWING_ID, toSketchDrawing(plane, data, styleOf, { origin: true }))`; po zavření `remove`. Styl křivky: vybraná → `selected`, jinak pod kurzorem → `hover`, jinak konstrukční → `construction`, jinak `fullyDefined ? 'defined' : 'normal'`; body stejně bez konstrukce.

**Kóty a výběr:** kóta vytvořená přes `addConstraint` (`distance`, `radius`) a zapsaná nastaví `editingDimension`. `select`/`clearSelection`/`setHover` mění jen stav session (výběr v režimu skicáře je oddělený od `SelectionModel`). Neznámé id u `select` nic.

### Kresba skici

```ts
// interaction/sketch-drawing.ts (čisté funkce, export z index.ts – používá je i app)
export function toSketchDrawing(plane: Plane, data: SketchData, styleOf: (id: SketchItemId) => SketchStyle,
  opts?: { readonly origin?: boolean }): SketchDrawing;   // všechny křivky a body; origin → bod ORIGIN_POINT_ID v [0, 0] stylu 'normal'
export function artifactDrawing(plane: Plane, entities: readonly SketchEntity[]): SketchDrawing;   // nekonstrukční křivky stylem 'normal', bez bodů
export function planeDrawing(plane: Plane, size?: number): SketchDrawing;   // čtverec size × size (výchozí 100) se středem v počátku roviny, 4 úsečky stylem 'plane'
```

Oblouk → `startAngle = atan2(start − center)`, `endAngle = atan2(end − center)` (+2π, dokud není větší); kružnice `0 … 2π`.

### Nástroje a akce skicáře

```ts
export function createSketchTools(deps: { sketches: SketchEditor }): readonly ToolDescriptor[];
export const SKETCH_ACTION_IDS: {
  readonly finish: 'sketch.finish'; readonly cancel: 'sketch.cancel';
  readonly delete: 'sketch.delete'; readonly construction: 'sketch.construction';
};
export function sketchConstraintActionId(kind: GeometricConstraintKind): string;   // 'sketch.constraint.<kind>'
export function createSketchActions(deps: { registry: ActionRegistry; sketches: SketchEditor; ids: IdGenerator }): Disposable;
```

| Nástroj (`id`) | Režim, skupina, zkratka | Chování |
|---|---|---|
| `sketch` | `model`, `sketch`, `Shift+S` | je-li zavřený dialog i skicář: `sketches.create(rovina)` – rovina z výběru (první položka `plane`), jinak `ORIGIN_PLANE_IDS.xy`; skončí |
| `sketch.select` | `sketch`, `select` | výchozí v režimu skici; `move` → `setHover` z `pick(x, y, ['sketchEntity'])` (jen entity session, ne počátek); klik (do 4 px) → `select` (Shift = `additive`), do prázdna `clearSelection`; stisk na bodu a pohyb nad 4 px → `drag` při každém pohybu, uvolnění → `endDrag`; `Escape` s výběrem → `clearSelection` (`true`) |
| `sketch.line` | `sketch`, `draw`, `L` | polyline: první klik začne řetěz, každý další přidá úsečku z posledního bodu (`addGeometry`); klik na první bod řetězu ho uzavře a ukončí; úhel do 3° od osy → `horizontal`/`vertical`; `Escape` s rozpracovaným řetězem ho ukončí (`true`), jinak nástroj skončí |
| `sketch.rectangle` | `sketch`, `draw`, `R` | dva rohy → 4 body (rohy ze snapu znovu použité), 4 úsečky, 2× `horizontal`, 2× `vertical`; rohy se stejnou x nebo y nic |
| `sketch.circle` | `sketch`, `draw`, `C` | střed, bod na obvodu → kružnice (poloměr > 0) |
| `sketch.arc` | `sketch`, `draw`, `A` | střed, začátek, konec (promítnutý na kružnici) → oblouk proti směru hodinových ručiček |
| `sketch.dimension` | `sketch`, `constrain`, `D` | klik na úsečku → `distance(p1, p2)`, na kružnici/oblouk → `radius`, na bod a pak druhý bod → `distance`; hodnota změřená (`dimensionFor`), `addConstraint` |

- **Bod pod kurzorem** (pomocník `snapAt` v `sketch-tools/snap.ts`): `pick(x, y, ['sketchEntity'])`; zásah bodu session → jeho id a souřadnice; zásah `ORIGIN_POINT_ID` → nový bod `[0, 0]` a vazba `fix`; jinak nový bod v průsečíku paprsku `screenToRay` s rovinou (`plane.intersectRay`, `toLocal`; rovnoběžný paprsek → klik se ignoruje). Nové id z `ids.next()`.
- **Náhled:** kreslicí nástroje kreslí rozpracovaný tvar přes `viewport.overlay.set('sketch-tool', …)` ve světových souřadnicích stylem `preview` (kružnice a oblouk lomenou čarou, 64 úseků na kruh); při deaktivaci `overlay.remove('sketch-tool')`.
- Nástroje bez otevřené session nic nedělají.
- **Akce** (`createSketchActions`, všechny `modes: ['sketch']`): `sketch.finish` a `sketch.cancel` (skupina `sketch`, bez zkratky, povolené s otevřenou session); `sketch.delete` (`Delete`, `Backspace`; povolená s neprázdným výběrem) → `remove(výběr)`; `sketch.construction` (`Q`; výběr obsahuje křivku) → `toggleConstruction`; pro každý druh z `GEOMETRIC_CONSTRAINT_KINDS` akce `sketch.constraint.<kind>` (skupina `sketch.constraint`, popisek `sketch.constraint.<kind>`, zkratky `H` vodorovná, `V` svislá, `I` shoda, ostatní bez; povolená, když `constraintFor(kind, vybrané entity) !== null`) → `addConstraint({ ...návrh, id: ids.next() })`.

## Vestavěné akce

Pravidla vestavěných akcí jsou prezentační logika, proto patří do `interaction` (revize M10, [[0010-prezentacni-model|ADR 0010]]); `app` je jen zaregistruje.

```ts
// SELECT_TOOL.label je klíč překladu 'tool.select' (ADR 0014).
export const ACTION_IDS = {
  undo: 'undo', redo: 'redo', fitAll: 'view.fitAll',
  featureEdit: 'feature.edit', featureRename: 'feature.rename', featureSuppress: 'feature.suppress',
  featureDelete: 'feature.delete', rollHere: 'timeline.rollHere',
  toStart: 'timeline.toStart', stepBack: 'timeline.stepBack', stepForward: 'timeline.stepForward', toEnd: 'timeline.toEnd',
} as const;
export function toolActionId(toolId: string): string;   // 'tool.<id>'

/** Stav „zamčeno“: dokument jen pro čtení nebo otevřený dialog. Jediné místo pravidla. */
export function createEditLock(deps: { readOnly: boolean; editor: FeatureEditor }): Observable<boolean>;

export function createBuiltInActions(deps: {
  registry: ActionRegistry; doc: DocumentReader; ops: OperationDispatcher; undo: UndoManager;
  selection: SelectionModel; featureTree: FeatureTreeModel; editor: FeatureEditor; tools: ToolManager;
  toolList: readonly ToolDescriptor[]; locked: Observable<boolean>;
  camera: { fitAll(): void };                         // úzké rozhraní, render interaction nezná
}): Disposable;
```

- `createBuiltInActions` dostane od M11 i `confirm: (request: ConfirmRequest) => boolean` s `ConfirmRequest = { key: string; params: Readonly<Record<string, string | number>> }` (klíč překladu a hodnoty; `interaction` nezná DOM, dialog dodá `ui` přes `app`). `feature.delete` spočítá `featureTree.dependentsOf(odstraňované)`; je-li jich `n > 0`, zeptá se `confirm({ key: 'feature.delete.confirm', params: { n } })` a při `false` nic nesmaže ani nezmění výběr (jako Fusion: „N featur ztratí referenci“, [[Rozhodnutí noční rychloakce#M11 – Další entity|R16]]). Bez závislých se neptá; maže-li se featura spolu se všemi svými závislými, je `n = 0` (`dependentsOf` počítá jen featury mimo odstraňované) a také se neptá.
- Skupina `feature` (kontextové menu) v pořadí: `feature.edit`, `feature.rename` (→ `featureTree.beginRename`), `feature.suppress`, `timeline.rollHere`, `feature.delete`. Menu v [[Timeline]] je jen vykreslený snapshot akcí této skupiny.
- `ui` id akcí nezná natvrdo: bere je z `AppSession.actionIds` (reexport `ACTION_IDS`).

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
- Architektura: `interaction` projde `tsconfig.domain.json` a nezávisí na `regen`, `kernel`, `render`, `ui` (`npm run check`).

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
