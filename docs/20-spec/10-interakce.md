---
type: spec
status: draft
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
> **Rozhodnutí:** [[0009-platformove-nezavisla-domena]], [[0010-prezentacni-model]]  
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
  readonly events: Emitter<{ pointer: ViewPointerEvent; key: ViewKeyEvent }>;
}

export type PickResult =
  | { kind: 'face'; body: BodyId; faceIndex: number; point: Vec3 }
  | { kind: 'edge'; body: BodyId; edgeIndex: number; point: Vec3 };

export interface ViewPointerEvent {
  readonly type: 'down' | 'move' | 'up';
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
- Převod DOM událostí na `ViewPointerEvent`/`ViewKeyEvent` dělají adaptéry (`render` pro canvas, `ui` pro globální klávesnici). Do `interaction` se DOM typ nikdy nedostane.
- V testech nahrazuje viewport `FakeViewport` (předpřipravené výsledky `pick`, ruční emit událostí).

## Prezentační modely a `Observable`

Stav, který UI zobrazuje, vystavují prezentační modely jako `Observable<T>` z `core` (neměnný snapshot + `subscribe`). Pohled volá jen příkazy. Prezentační modely v `interaction`:

| Model | Stav pro UI | Příkazy |
|---|---|---|
| `FeatureTreeModel` | `rows: Observable<readonly TreeRow[]>` (název, typ, stav ok/chyba/potlačeno, za rollback barem) | `edit`, `rename`, `moveRollbackBar`, `select` |
| `FeatureEditSession` | `fields: Observable<readonly FieldState[]>` (hodnota, chyba, aktivní referenční parametr) | `setParam`, `focusRefParam`, `commit`, `cancel` |
| `ToolManager` | `active: Observable<string>` | `activate` |
| `ActionRegistry` | `actions: Observable<readonly ActionState[]>` (id, label, shortcut, enabled) | `run` |
| `SelectionModel` | `items: Observable<readonly SelectionItem[]>` | `set`, `toggle`, `clear` |

Přesné tvary `TreeRow`, `FieldState` a `ActionState` se upřesní v [[M09-interakce]].

## Výběr

```ts
export type SelectionItem =
  | { kind: 'feature'; feature: FeatureId }
  | { kind: 'body'; body: BodyId }
  | { kind: 'face'; body: BodyId; faceIndex: number }
  | { kind: 'edge'; body: BodyId; edgeIndex: number };

export class SelectionModel {
  readonly items: readonly SelectionItem[];
  set(items: readonly SelectionItem[]): void;
  toggle(item: SelectionItem): void;
  clear(): void;
  readonly events: Emitter<{ changed: { items: readonly SelectionItem[] } }>;
}
```

- Výběr je **dočasný stav session**, neukládá se do dokumentu ani do logu.
- Indexy ploch/hran platí jen pro aktuální regeneraci. Po regeneraci se výběr přemapuje přes topologická jména (od M14), do té doby se výběr podtvarů po regeneraci vyčistí.
- Filtr výběru (jen plochy, jen hrany…) nastavuje aktivní nástroj nebo parametr dialogu.

## Nástroje

```ts
export interface Tool {
  readonly id: string;
  activate(ctx: ToolContext): void;
  deactivate(): void;
  onPointer?(e: ViewPointerEvent): void;
  onKey?(e: ViewKeyEvent): boolean;      // true = událost zpracována
}

export interface ToolContext {
  readonly viewport: ViewportPort;       // pick, overlay, screenToRay
  readonly selection: SelectionModel;
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
  readonly shortcut?: string;
  create(): Tool;
}

export class ToolRegistry { register(d: ToolDescriptor): void; all(): readonly ToolDescriptor[]; get(id: string): ToolDescriptor }

export class ToolManager {
  constructor(registry: ToolRegistry, ctx: Omit<ToolContext, 'finish'>, defaultToolId: string);
  activate(id: string): void;            // deaktivuje předchozí
  readonly active: ToolDescriptor;
  readonly events: Emitter<{ changed: { active: string } }>;
}
```

- Vždy je aktivní právě jeden nástroj. Výchozí je `SelectTool` (hover zvýraznění, klik = výběr, Shift = přidat).
- `Esc` ukončí aktivní nástroj → návrat k výchozímu.
- `ToolManager` přeposílá události z `ViewportPort.events` aktivnímu nástroji.

## Dialog featury: `FeatureEditor`

Většina featur se v Onshape vytváří stejně: klik na nástroj → otevře se dialog s výchozími parametry → živý náhled → OK nebo Zrušit. Tenhle tok je obecný a nemusí ho psát každý plugin.

```ts
export interface FeatureEditor {
  /** Vytvoří novou featuru daného typu na pozici rollback baru a otevře pro ni editační session. */
  create(type: string): FeatureEditSession;
  /** Otevře existující featuru k úpravě (dvojklik ve stromu). */
  edit(featureId: FeatureId): FeatureEditSession;
  readonly current: FeatureEditSession | null;
  readonly events: Emitter<{ changed: { session: FeatureEditSession | null } }>;
}

export class FeatureEditSession {
  readonly featureId: FeatureId;
  readonly schema: FeatureSchema;
  readonly params: unknown;                              // aktuální hodnoty
  readonly issues: readonly ParamIssue[];
  setParam(name: string, value: unknown): void;          // → tx.apply(feature.setParams)
  readonly activeRefParam: string | null;                // parametr typu bodies/topo, který právě přijímá výběr
  focusRefParam(name: string): void;
  commit(): void;                                        // → tx.commit()
  cancel(): void;                                        // → tx.abort()
  readonly events: Emitter<{ changed: void }>;
}
```

- `create` otevře transakci, aplikuje `feature.add` s `schema.defaults()` a novým ID z `IdGenerator`.
- Každá změna parametru je `feature.setParams` v transakci → dokument se změní → regenerace → živý náhled. Celý dialog je v logu jeden záznam.
- Je-li aktivní referenční parametr (`bodies`, `topo`), kliknutí ve viewportu plní tento parametr místo běžného výběru.
- Během otevřené session jsou undo/redo zakázané (pravidlo transakcí).

Díky tomu je nástroj pro většinu featur triviální – `ToolDescriptor`, jehož `create()` vrací nástroj, který při aktivaci zavolá `ctx.features.create('box')` a skončí. Interaktivní tvorbu tažením myší (nakreslit kvádr ve viewportu) si plugin může dopsat jako vlastní `Tool`, který mezivýsledky posílá přes `FeatureEditSession.setParam`.

## Akce a klávesové zkratky

```ts
export interface Action {
  readonly id: string;              // 'edit.undo'
  readonly label: string;
  readonly shortcut?: string;       // 'Mod+Z' (Mod = Cmd na macOS, Ctrl jinde)
  enabled(): boolean;
  run(): void;
}

export class ActionRegistry {
  register(a: Action): void;
  run(id: string): void;
  handleKey(e: ViewKeyEvent): boolean;      // najde akci podle zkratky
  readonly events: Emitter<{ changed: void }>; // změna enabled stavů (pro UI)
}
```

Akce registruje `app` (undo, redo, smazat výběr, potlačit featuru, aktivovat nástroj X, fit all). UI z nich staví menu a toolbar; zkratky fungují globálně, pokud fokus není v textovém poli.

## Testy

- `SelectionModel`: toggle, události.
- `ToolManager`: přepínání, Esc, deaktivace předchozího.
- `FeatureEditSession` s `FakeKernel`: create → setParam ×N → commit = jeden záznam v logu; cancel = dokument i log beze změny.
- `ActionRegistry`: zkratky včetně `Mod`, ignorování v textovém poli.
- Nástroje a výběr s `FakeViewport`: klik → `pick` → změna výběru.
- `FeatureTreeModel`: snapshot řádků po přidání featury, chybě regenerace a posunu rollback baru; nový snapshot je nový objekt, nezměněný zůstává identický.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
