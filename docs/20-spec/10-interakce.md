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
tags:
  - spec
created: 2026-10-12
updated: 2026-10-13
---
# 10 – `interaction`: výběr, nástroje, akce

> **Pojmy:** [[Výběr]], [[Nástroj]], [[Akce]], [[Transakce]], [[Rollback bar]], [[Prezentační model]]  
> **Rozhodnutí:** [[0009-platformove-nezavisla-domena]], [[0010-prezentacni-model]], [[0011-programovani-proti-rozhranim]]  
> **Milník:** [[M09-interakce]]

Převádí vstupy uživatele (myš, klávesnice, UI) na operace. **Nikdy nemění dokument přímo** – jen vytváří operace a posílá je dispečerovi nebo transakci. Závisí jen na `core`, `document` a `ops`.

`interaction` je **prstenec 2** ([[0009-platformove-nezavisla-domena|ADR 0009]]): obsahuje logiku obrazovek jako [[Prezentační model|prezentační modely]] ([[0010-prezentacni-model|ADR 0010]]), ale nezná DOM, Vue ani Three.js. Viewport zná jen přes vlastní port `ViewportPort`.

## Port viewportu

```ts
export interface ViewportPort {
  pick(x: number, y: number): PickResult | null;   // souřadnice v px vůči ploše pohledu
  screenToRay(x: number, y: number): { origin: Vec3; direction: Vec3 };
  readonly highlight: HighlightPort;                // hover a výběr
  readonly overlay: OverlayPort;                    // dočasná geometrie nástrojů
  readonly events: Subscribable<{ pointer: ViewPointerEvent; key: ViewKeyEvent }>;
}

/** Co jde zvýraznit: plocha nebo hrana tělesa, bez bodu a normály (Q065). */
export type HighlightTarget =
  | { kind: 'face'; body: BodyId; faceIndex: number }
  | { kind: 'edge'; body: BodyId; edgeIndex: number };

/** Výsledek pickingu je HighlightTarget doplněný o místo zásahu, lze ho předat přímo do setHover. */
export type PickResult =
  | { kind: 'face'; body: BodyId; faceIndex: number; point: Vec3; normal: Vec3 }  // normal = jednotková normála ve světě, směrem ven z tělesa
  | { kind: 'edge'; body: BodyId; edgeIndex: number; point: Vec3 };

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
- `PickResult` je definovaný jen tady, [[09-vykreslovani]] na něj odkazuje. Varianta `vertex` přibude, až bude výběr vrcholů potřeba ([[Q057 Tvar PickResult|Q057]]).
- `HighlightPort` je zrcadlo: stav hoveru a výběru drží `interaction` a vždy ho předá celý. Bere `HighlightTarget`, protože výběr bod zásahu nezná ([[Q065 Cíl zvýraznění bez bodu a normály|Q065]]); `PickResult` je jeho podtyp, takže výsledek `pick` jde předat beze změny. `OverlayPort` nese jen platformově nezávislé tvary ve světových souřadnicích, žádné typy Three.js. Další druhy (síť pro náhled tělesa) přibudou s potřebou ([[Q058 Kontrakt HighlightPort a OverlayPort|Q058]]).
- `ViewPointerEvent` chodí pro všechna tlačítka. Pravé a prostřední tlačítko zároveň ovládá kameru, nástroje je mají ignorovat. Kolečko se do `interaction` neposílá, patří jen kameře.
- Převod DOM událostí na `ViewPointerEvent`/`ViewKeyEvent` dělají adaptéry (`render` pro canvas, `ui` pro globální klávesnici). Adaptér také převádí Cmd (macOS) / Ctrl (jinde) na `mods.mod`, takže `interaction` platformu nezná. Do `interaction` se DOM typ nikdy nedostane.
- V testech nahrazuje viewport `FakeViewport` (předpřipravené výsledky `pick`, ruční emit událostí, zaznamenaný stav `highlight` a `overlay`).

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
}

export interface RegenStatusPort {
  readonly state: Observable<RegenSnapshot>;
}
```

- `health` je `ReadonlyMap`, ale `Map` zmrazit nejde: adaptér v `app` posílá v každém snapshotu **novou** mapu a už ji nemění. `interaction` ji jen čte.
- Potlačení a pozice za barem port nenese: `interaction` je čte přímo z dokumentu, takže se projeví hned, ne až po regeneraci.
- V testech port nahrazuje `FakeRegenStatus` (`testing.ts`) s metodou `publish(health, bodies?)`, která zvýší `generation` (bez `bodies` prázdný seznam). `RegenBody` se exportuje, potřebuje ho adaptér v `app`.

## Prezentační modely a `Observable`

Stav, který UI zobrazuje, vystavují prezentační modely jako `Observable<T>` z `core` (neměnný snapshot + `subscribe`). Pohled volá jen příkazy. **Prezentační modely nemají vlastní `events`, jediný kanál změn je `Observable`** ([[0010-prezentacni-model|ADR 0010]]).

| Model | Stav pro UI | Příkazy |
|---|---|---|
| `FeatureTreeModel` | `rows: Observable<readonly TreeRow[]>`, `rollbackIndex: Observable<number>` | `edit`, `rename`, `moveRollbackBar`, `select` |
| `FeatureEditor` | `current: Observable<FeatureEditSession \| null>` | `create`, `edit` |
| `FeatureEditSession` | `state: Observable<EditState>` (parametry, chyby, pole formuláře, aktivní referenční parametr) | `setParam`, `focusRefParam`, `commit`, `cancel` |
| `ToolManager` | `active: Observable<string>` | `activate` |
| `ActionRegistry` | `actions: Observable<readonly ActionState[]>` | `run` |
| `SelectionModel` | `items: Observable<readonly SelectionItem[]>` | `set`, `toggle`, `clear` |

Společná pravidla snapshotů:
- Model vystavuje `ObservableValue.asObservable()`, nikdy samotnou `ObservableValue` (přetypováním by šlo zapisovat, revize M9). Závislosti dostává v nejužší potřebné podobě: `RegistryReader` místo registru, `SelectionCommands` místo `SelectionModel` ([[0011-programovani-proti-rozhranim|ADR 0011]]).
- Snapshot je zmrazený ([[Neměnná data]]). Nový snapshot vzniká jen při skutečné změně obsahu; beze změny `subscribe` nic nedostane.
- Položky pole, které se nezměnily, jsou v novém snapshotu **tytéž objekty** (`===`). UI tak překreslí jen změněné řádky.

## Výběr

```ts
export type SelectionItem =
  | { kind: 'feature'; feature: FeatureId }
  | { kind: 'body'; body: BodyId }
  | { kind: 'face'; body: BodyId; faceIndex: number }
  | { kind: 'edge'; body: BodyId; edgeIndex: number };

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
- Indexy ploch/hran platí jen pro aktuální regeneraci. Když `RegenStatusPort` ohlásí novou `generation`, výběr odebere položky `face` a `edge` (od M14 je přemapuje přes topologická jména). Položky `feature` a `body` zůstávají.
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
  readonly group: 'select' | 'primitive' | 'sketch' | 'feature' | 'modify';
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
- **Referenční parametr dialogu** ([[Q066 Klik do referenčního parametru|Q066]]): `ToolManager` sleduje `ctx.features.current` a `state` aktuální session. Dokud má session `activeRefParam !== null`, posílá události vnitřnímu nástroji `refPick` místo aktivního nástroje (ten zůstává aktivní, `active` se nemění, jen je dočasně „zakrytý“). `refPick`: `move` → hover z `pick`; levý klik na cíl povoleného druhu → přidá/odebere referenci v parametru přes `setParam`; `Escape` → `focusRefParam(null)`. Když `activeRefParam` zmizí, `refPick` zruší hover a události jdou znovu aktivnímu nástroji. `FeatureEditor` o nástrojích neví, takže nevznikne cyklus. Převod pick → reference (`BodyRef`, `TopoRef`) je v M9 jen pro `bodies`: zásah plochy i hrany dá `{ kind: 'body', body }`, nové pole je zmrazené, pořadí se drží, hodnota, která není pole, se bere jako prázdné pole. `topo` se doplní s topologickým pojmenováním (M14). `refPick` není `Tool` z registru (nepotřebuje `ToolContext` ani `finish`); zakrytý nástroj nedostane `deactivate` ani jiný signál a jeho hover obnoví až další `move`.

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
}

export interface FieldState {
  readonly name: string;
  readonly spec: ParamSpec;            // kind, label, min/max… – UI podle něj zvolí ovládací prvek
  readonly value: unknown;
  readonly issue: ParamIssue | null;   // první ParamIssue s param === name (kód, překládá ui – ADR 0014)
  readonly active: boolean;            // name === activeRefParam
}
```

**`create(type)`**
1. Předpoklady (jinak výjimka, nic se nezmění): žádná otevřená session, dispečer není v transakci, typ je v `schemas`.
2. `ops.begin(schema.label)`, pak `tx.apply(feature.add)` s `id = ids.next()`, `typeVersion = schema.version`, `params = schema.defaults()`, `suppressed: false`, `index = rollbackIndex`.
3. Jméno: `"<schema.label> <n>"`, kde `n` je nejmenší kladné číslo, pro které takové jméno ve studiu ještě není.
4. Vložení na pozici baru posune bar za novou featuru samo (pravidlo mutátoru v [[03-dokument]]), takže nová featura je aktivní ([[Q068 Kam se vloží nová featura|Q068]]).

**`edit(featureId)`**
1. Předpoklady jako u `create`; neznámá featura → výjimka.
2. `ops.begin('feature.edit')` – popisek transakce je klíč překladu ([[0014-preklady-vue-i18n-a-klice|ADR 0014]]), jméno featury do něj nepatří. Je-li `rollbackIndex !== index + 1`, `tx.applyTransient(studio.setRollback(index + 1))`: bar je během editace těsně za editovanou featurou, ať byla před barem, nebo za ním. Pozdější featury se nepřehrávají a náhled ukazuje model ve stavu editované featury ([[Q018 Rollback bar při editaci starší featury|Q018]]). Přechodná operace se při `commit` i `cancel` vrátí sama a do logu se nedostane ([[04-operace-a-historie]]).

**Session**
- `setParam(name, value)`: `name` musí být klíč `schema.params`, jinak výjimka. Nové `params = { ...params, [name]: value }` → `tx.apply(feature.setParams)`. Hodnota se **nekontroluje** před aplikací: neplatné parametry dokument unese, regenerace featuru označí chybou a `issues` je ukážou. `setParam` se stejnou hodnotou (`Object.is` u primitiv) nic neaplikuje. Selže-li handler, výjimka letí dál a session zůstává otevřená beze změny.
- `params` čte session vždy z dokumentu (jediný zdroj pravdy), `issues = schema.validate(params)` se přepočítá po každé změně.
- `focusRefParam(name)`: `name` musí být parametr druhu `bodies`, `topo` nebo `region`, jinak výjimka (i pro neznámé jméno). `null` zruší fokus. Stejné jméno znovu nevytvoří nový snapshot.
- `commit()`: `tx.commit()` → session zavřená (`open: false`), `editor.current` → `null`. Celý dialog je v logu **jeden** záznam. `commit` je povolený i s `issues` (featura s chybou je v Onshape také platný stav).
- `cancel()`: `tx.abort()` → dokument i log beze změny, session zavřená, `current` → `null`.
- Po zavření hodí každý příkaz výjimku. Poslední snapshot má `open: false` a `activeRefParam: null`; `params` drží poslední známé hodnoty (po zrušeném `create` featura v dokumentu už není).
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
}

export interface FeatureTreeModel {
  readonly rows: Observable<readonly TreeRow[]>;
  readonly rollbackIndex: Observable<number>;
  edit(id: FeatureId): void;                                   // → FeatureEditor.edit
  rename(id: FeatureId, name: string): void;                   // → dispatch feature.rename
  moveRollbackBar(index: number): void;                        // → dispatch studio.setRollback
  select(id: FeatureId, opts?: { additive?: boolean }): void;  // → selection.set / toggle
  dispose(): void;
}

export function createFeatureTreeModel(deps: {
  doc: DocumentReader; ops: OperationDispatcher; schemas: RegistryReader<FeatureSchema>;
  regen: RegenStatusPort; editor: FeatureEditor; selection: SelectionCommands;
}): FeatureTreeModel;
```

- `typeLabel` a `message` jsou od [[0014-preklady-vue-i18n-a-klice|ADR 0014]] klíče překladu (případně s parametry), překládá je `ui`. Zprávy z jádra (`KernelError.message`) zůstávají technický text a UI je ukáže pod přeloženým nadpisem chyby.
- Řádky v pořadí featur dokumentu. Stav: `suppressed` (z dokumentu) > `rolledBack` (index `>= rollbackIndex`) > `health` z portu (`ok`/`warning`/`error`) > `pending` (featura v `health` chybí, např. ještě neproběhla regenerace).
- Model se přepočítá při `doc.events.changed`, změně `regen.state`, `selection.items` a `editor.current`. Nezměněný řádek je týž objekt, nezměněný seznam týž snapshot.
- `rows` a `rollbackIndex` se přepočítají v jednom kroku, ale vyšlou se postupně (nejdřív `rows`). Odběratel jednoho proto nemá v callbacku číst druhé; Vue překresluje dávkově v mikroúloze, takže v UI nekonzistence nevznikne. Kdyby to vadilo jinde, sloučí se do jednoho `Observable<TreeSnapshot>`.
- Nezměněný řádek se pozná porovnáním s řádkem na stejné pozici; po přesunu featury proto dostanou nový objekt i řádky, které se jen posunuly.
- `rename` neznámé featury → výjimka. `rename`: jméno se ořízne, prázdné nebo stejné → nic. `moveRollbackBar`: stejný index → nic, mimo `0..features.length` → výjimka.
- `rename` a `moveRollbackBar` během otevřené transakce hodí výjimku (z dispečera); UI je má v tu chvíli zakázat podle `editing`.

## Prohlížeč: `BrowserModel` a viditelnost těles

[[Prohlížeč]] v UI ([[11-ui#Rozvržení]]) ukazuje *výsledek* modelování: tělesa z poslední regenerace. [[Timeline]] je jen jiné vykreslení `FeatureTreeModel` výše. Návrh (kontrakt upřesní Implementační plán [[M10-ui]]):

```ts
export interface BrowserBodyRow {
  readonly body: BodyId;
  readonly name: { readonly key: 'browser.body'; readonly n: number };  // „Těleso n“, n od 1 podle pořadí; překládá ui
  readonly feature: FeatureId;  // featura, která těleso vytvořila
  readonly visible: boolean;
  readonly selected: boolean;   // výběr obsahuje { kind: 'body', body }
}

export interface BrowserModel {
  readonly bodies: Observable<readonly BrowserBodyRow[]>;
  readonly hidden: Observable<ReadonlySet<BodyId>>;   // app → viewport.setBodyVisible
  select(body: BodyId, opts?: { additive?: boolean }): void;
  setVisible(body: BodyId, visible: boolean): void;
  dispose(): void;
}
```

- `setVisible` tělesa, které poslední regenerace nezná (zastaralý řádek v UI), nic neudělá. Při změně se nejdřív vyšle `hidden`, pak `bodies`.
- Viditelnost je **stav pohledu** ([[Q071 Viditelnost těles|Q071]]): neukládá se, nejde přes dispečer ani do undo, po reloadu je vše vidět. Těleso, které po regeneraci zmizí, ze `hidden` vypadne.
- Do M14 nemají tělesa stabilní identitu, takže skrytí se po změně historie může přenést na jiné těleso se stejným `BodyId`. Vědomé omezení.

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

Akce registruje `app` (undo, redo, smazat výběr, potlačit featuru, aktivovat nástroj X, fit all). UI z nich staví menu a toolbar; zkratky fungují globálně, pokud fokus není v textovém poli.

## Testy

- `FakeViewport`, `FakeRegenStatus`: zaznamenaný stav a ruční emit.
- `SelectionModel`: `set` s duplicitami, `toggle` přidá/odebere, `clear`, žádná emise beze změny, vyčištění `face`/`edge` při nové generaci (`feature`/`body` zůstávají); `bindSelectionHighlight`.
- `ToolManager`: výchozí nástroj po vytvoření, přepínání a deaktivace předchozího, neznámé id, `finish` (i uvnitř `activate`, i starý `ctx`), `Escape`, `unhandledKey`, přeposílání událostí jen aktivnímu nástroji, zakrytí nástrojem `refPick` podle `activeRefParam`.
- `SelectTool` s `FakeViewport`: hover, `leave`, klik → `set`, Shift+klik → `toggle`, klik do prázdna → `clear`, tažení nad toleranci nic nevybere, pravé tlačítko ignoruje, `Escape`.
- `FeatureEditSession` se skutečným dokumentem a dispečerem (jádro ani regenerace nejsou potřeba; `interaction` na `kernel` nesmí ani v testech). Integrační test v `tests/` s `FakeKernel` a regenerací ověří živý náhled. Případy: create → `setParam` ×20 → commit = **jeden** záznam v logu; cancel = dokument i log beze změny; jméno `Box 2`; vložení na bar; edit featury před i za barem posune bar dočasně a po commit/cancel ho vrátí, v logu není `studio.setRollback`; neplatná hodnota → `issues`; druhá session → výjimka; příkazy po zavření → výjimka; undo zakázané během session.
- `ActionRegistry`: zkratky včetně `Mod` a `Shift`, přesná shoda modifikátorů, velikost písmen, ignorování v textovém poli, zakázaná akce, neplatná a duplicitní zkratka, nový snapshot jen pro změněnou akci.
- `FeatureTreeModel`: snapshot řádků po přidání featury, chybě regenerace, potlačení a posunu rollback baru; nový snapshot je nový objekt, nezměněný řádek zůstává identický; `selected`, `editing`; `rename` s mezerami a prázdné.
- Architektura: `interaction` projde `tsconfig.domain.json` a nezávisí na `regen`, `kernel`, `render`, `ui` (`npm run check`).

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
