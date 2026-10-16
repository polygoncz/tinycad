---
type: spec
status: accepted
order: 12
aliases:
  - Skicář
  - Spec 12
modules:
  - sketch
  - solver-planegcs
  - features
  - interaction
  - render
milestones:
  - "[[M12-skicar]]"
  - "[[M13-extrude-revolve]]"
  - "[[M14-topologicke-pojmenovani]]"
  - "[[M25-glyfy-vazeb]]"
  - "[[M26-snapper-a-auto-vazby]]"
  - "[[M27-oblouky-a-kruznice]]"
  - "[[M28-koty]]"
  - "[[M29-spliny]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-15
---
# 12 – Skicář

> **Pojmy:** [[Skica]], [[Řešič vazeb]], [[Featura]], [[Artefakt]], [[Transakce]], [[Determinismus operací]]  
> **Rozhodnutí:** [[0004-data-oddelene-od-chovani]], [[0016-planegcs-resic-vazeb]], [[0017-modul-sketch-a-skicar]], [[Q020 Planegcs v samostatném workeru|Q020]], [[Q074 Operace skicáře v logu|Q074]], [[Rozhodnutí noční rychloakce#M12 – Skicář|R31–R50]]  
> **Milník:** [[M12-skicar]]

[[Skica]] je featura (`type: 'sketch'`) – 2D geometrie s vazbami a kótami na rovině. Sama tělesa nevytváří; poskytuje **oblasti** (profily) jako plochy v jádře, na které se odkazuje Extrude a Revolve (M13). Data a chování jsou oddělené jako u ostatních featur ([[0004-data-oddelene-od-chovani|ADR 0004]]).

## Moduly a hranice

Rozhodnuto v [[0017-modul-sketch-a-skicar|ADR 0017]]:

| Modul | Prstenec | Obsah |
|---|---|---|
| `sketch` (nový) | 1 | datový model skici, kontrola dat, geometrie 2D, oblasti, pomůcky editace, port `ConstraintSolver`; `testing.ts`: `FakeSolver`, buildery |
| `solver-planegcs` (nový) | 3 | adaptér `ConstraintSolver` nad `@salusoft89/planegcs` ve workeru ([[0016-planegcs-resic-vazeb\|ADR 0016]]) |
| `features/sketch` | 1 | plugin: schéma (`plane`, `entities`, `constraints`), builder (oblasti → `makeFace`), slovník |
| `document` | 1 | `PlaneId`, `SketchId`, `PlaneRef`, druhy parametrů `planes` a `data`, počátek `ORIGIN_PLANES` ([[03-dokument#Reference na jiné entity]]) |
| `kernel` | 1 | `SketchOps.makeFace` ([[06-geometricke-jadro#Stav po M12]]) |
| `regen` | 1 | artefakty `plane` a `sketch`, `resolvePlanes` ([[07-regenerace#Princip]]) |
| `interaction` | 2 | režim (`Mode`), `SketchEditor`, `SketchSession`, nástroje a akce skicáře, kresba `SketchDrawing` ([[10-interakce#Skicář]]) |
| `render` | 3 | vrstva skic (kresba, picking `sketchEntity`), kamera kolmo na rovinu ([[09-vykreslovani#Skici]]) |
| `app`, `ui` | 3 | skládání, panel skici, lišta podle režimu ([[11-ui]]) |

`sketch` závisí jen na `core`; smí ho importovat `regen`, `interaction`, `features/*`, `solver-planegcs` a `app`.

## Data (`sketch`)

```ts
// sketch/model.ts
export type SketchEntityId = Brand<string, 'SketchEntityId'>;
export type SketchConstraintId = Brand<string, 'SketchConstraintId'>;
export type SketchItemId = SketchEntityId | SketchConstraintId;   // výběr v režimu skicáře

export interface SketchPoint  { readonly kind: 'point';  readonly id: SketchEntityId; readonly x: number; readonly y: number }
export interface SketchLine   { readonly kind: 'line';   readonly id: SketchEntityId; readonly p1: SketchEntityId; readonly p2: SketchEntityId; readonly construction?: true }
export interface SketchCircle { readonly kind: 'circle'; readonly id: SketchEntityId; readonly center: SketchEntityId; readonly radius: number; readonly construction?: true }
/** Oblouk proti směru hodinových ručiček od start do end kolem center; poloměr = |start − center| = |end − center|. */
export interface SketchArc    { readonly kind: 'arc';    readonly id: SketchEntityId; readonly center: SketchEntityId; readonly start: SketchEntityId; readonly end: SketchEntityId; readonly construction?: true }
export type SketchCurve = SketchLine | SketchCircle | SketchArc;
export type SketchEntity = SketchPoint | SketchCurve;

export type GeometricConstraintKind =
  'coincident' | 'horizontal' | 'vertical' | 'parallel' | 'perpendicular' | 'equal' | 'tangent' | 'fix';
export const GEOMETRIC_CONSTRAINT_KINDS: readonly GeometricConstraintKind[];   // v tomto pořadí (pořadí akcí v liště)
export type DimensionKind = 'distance' | 'radius';

export type SketchConstraint =
  | { readonly kind: 'coincident'; readonly id: SketchConstraintId; readonly a: SketchEntityId; readonly b: SketchEntityId }   // dva body
  | { readonly kind: 'horizontal' | 'vertical'; readonly id: SketchConstraintId; readonly line: SketchEntityId }
  | { readonly kind: 'parallel' | 'perpendicular'; readonly id: SketchConstraintId; readonly a: SketchEntityId; readonly b: SketchEntityId } // dvě úsečky
  | { readonly kind: 'equal'; readonly id: SketchConstraintId; readonly a: SketchEntityId; readonly b: SketchEntityId }          // dvě úsečky (délka) nebo dvě kružnice/oblouky (poloměr)
  | { readonly kind: 'tangent'; readonly id: SketchConstraintId; readonly a: SketchEntityId; readonly b: SketchEntityId }        // úsečka + kružnice/oblouk, nebo dvě kružnice/oblouky
  | { readonly kind: 'fix'; readonly id: SketchConstraintId; readonly point: SketchEntityId }                                   // bod zůstane na svých souřadnicích
  | { readonly kind: 'distance'; readonly id: SketchConstraintId; readonly a: SketchEntityId; readonly b: SketchEntityId; readonly value: number } // dva body, value > 0
  | { readonly kind: 'radius'; readonly id: SketchConstraintId; readonly curve: SketchEntityId; readonly value: number };        // kružnice nebo oblouk, value > 0

export interface SketchData {
  readonly entities: readonly SketchEntity[];
  readonly constraints: readonly SketchConstraint[];
}

export const SKETCH_FEATURE_TYPE = 'sketch';
```

- Souřadnice jsou v milimetrech v rovině skici (osa x = `plane.xDir`, osa y = `normal × xDir`, [[01-architektura#Souřadnice a jednotky]]).
- **Souřadnice v datech jsou už vyřešené.** Řešič běží jen při editaci a jeho výsledek se zapíše do parametrů. Přehrání logu tedy na řešiči nezávisí ([[Determinismus operací|determinismus]]) a regenerace řešič nevolá.
- Id entit a vazeb se generují před operací (`IdGenerator`, jako id featur) a jsou unikátní napříč entitami **i** vazbami jedné skici. Na id křivek stojí jména oblastí a v M14 jména bočních ploch extrude ([[08-topologicke-pojmenovani|08]]).
- Úsečky v polyline a obdélníku **sdílejí** body (stejné id bodu), místo aby měly každý svůj bod a vazbu `coincident`. Snap na existující bod také použije jeho id. Vazba `coincident` je pro dva různé body, které uživatel spojí výslovně.

### Kontrola dat

```ts
export interface SketchIssue {
  readonly path: 'entities' | 'constraints';
  readonly index: number;
  readonly code: 'sketch.invalidEntity' | 'sketch.invalidConstraint';
}
/** Ověří tvar a invarianty; ok = tytéž hodnoty typované (důvěryhodné místo přetypování id). Hlásí všechny problémy. */
export function parseSketchData(entities: unknown, constraints: unknown): Result<SketchData, readonly SketchIssue[]>;
```

`sketch.invalidEntity` u položky `entities[index]`, když: není objekt; neznámý `kind`; chybí nebo přebývá vlastnost; id není neprázdný řetězec nebo už bylo použito (i vazbou – pak se hlásí u pozdějšího výskytu; entity se procházejí před vazbami, takže sdílené id entity a vazby se hlásí u vazby); souřadnice nebo poloměr není konečné číslo; `radius ≤ 0`; `construction` je jiné než `true`; odkaz (`p1`, `p2`, `center`, `start`, `end`) nevede na existující **bod** (v celém poli, i pozdějším); `p1 === p2`; body oblouku nejsou tři různé; u oblouku `| |end − center| − |start − center| | > 1e-6 · max(1, |start − center|)` nebo poloměr ≤ 1e-9. Pole, které není pole → jedna issue s `index: -1`.

`sketch.invalidConstraint` u `constraints[index]` analogicky: tvar, unikátní id, odkazy na existující entity správného druhu podle tabulky výše (`a !== b`), `value` konečné > 0.

### Geometrie a pomůcky editace

```ts
// sketch/geometry.ts
/** 2D křivka pro oblasti a jádro. Stejný tvar jako ProfileCurve v kernel (strukturální typování, ADR 0017). */
export type Curve2 =
  | { readonly kind: 'line'; readonly from: Vec2; readonly to: Vec2 }
  | { readonly kind: 'arc'; readonly center: Vec2; readonly from: Vec2; readonly to: Vec2; readonly ccw: boolean }
  | { readonly kind: 'circle'; readonly center: Vec2; readonly radius: number };
export function pointsById(data: SketchData): ReadonlyMap<SketchEntityId, SketchPoint>;
export function curve2(curve: SketchCurve, points: ReadonlyMap<SketchEntityId, SketchPoint>): Curve2;   // arc → ccw: true; od M14 s id: curve.id
// M14: každá varianta Curve2 má readonly id?: string – id entity skici; computeRegions ho vyplní u všech křivek outer i holes (R98), jádro z něj dělá role face:side:<id>

// sketch/edit.ts
/** Vazba pro vybrané entity (v pořadí výběru), nebo null, když výběr nesedí. */
export function constraintFor(kind: GeometricConstraintKind, selected: readonly SketchEntity[]): SketchConstraintDraft | null;
/** Kóta pro vybrané entity: 1 úsečka → distance(p1, p2); 1 kružnice/oblouk → radius; 2 body → distance. value = změřená hodnota; ≤ 1e-9 → null. */
export function dimensionFor(selected: readonly SketchEntity[], data: SketchData): SketchConstraintDraft | null;
export function measure(data: SketchData, c: Extract<SketchConstraint, { kind: DimensionKind }>): number;
/** Smaže položky s kaskádou (níže); pořadí zbylých se nemění. Neznámá id se ignorují. */
export function removeItems(data: SketchData, ids: readonly SketchItemId[]): SketchData;
/** Přepne construction u vybraných křivek: všechny konstrukční → všechny normální, jinak všechny konstrukční. Body a vazby ignoruje. */
export function toggleConstruction(data: SketchData, ids: readonly SketchItemId[]): SketchData;
export type SketchConstraintDraft = DistributiveOmit<SketchConstraint, 'id'>;
/** M25: definiční body křivky – line → [p1, p2], circle → [center], arc → [center, start, end]. */
export function curvePoints(c: SketchCurve): readonly SketchEntityId[];
/** M25: entity, na které vazba odkazuje, v pořadí vazby – dvě entity → [a, b] (i coincident), horizontal/vertical → [line], fix → [point], radius → [curve]. */
export function constraintTargets(c: SketchConstraint): readonly SketchEntityId[];
```

- `constraintFor`: `horizontal`/`vertical` – právě 1 úsečka; `coincident` – právě 2 body; `fix` – právě 1 bod; `parallel`/`perpendicular` – právě 2 úsečky; `equal` – 2 úsečky nebo 2 z {kružnice, oblouk}; `tangent` – úsečka + kružnice/oblouk (v libovolném pořadí) nebo 2 z {kružnice, oblouk}. Jinak `null`. `a`, `b` v pořadí výběru.
- `removeItems` – kaskáda: (1) smaže vybrané vazby; (2) smaže vybrané entity, s bodem i křivky, které ho používají; (3) bod, který používala smazaná křivka a žádná zbylá křivka ho nepoužívá, se smaže také; (4) smažou se vazby, které odkazují na smazanou entitu.

## Featura skici (`features/sketch`)

```ts
export interface SketchParams {
  readonly plane: readonly (PlaneRef | TopoRef)[];   // planes, min 1, max 1; výchozí [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy }]; TopoRef na rovinnou plochu od M14
  readonly entities: readonly SketchEntity[];        // data, výchozí []
  readonly constraints: readonly SketchConstraint[]; // data, výchozí []
}
export const sketchPlugin: FeaturePlugin<SketchParams>;
```

- Schéma `type: SKETCH_FEATURE_TYPE`, `version: 1`, `label: 'sketch.label'`, `icon: 'pencil'`; parametry v pořadí `plane` (`{ kind: 'planes', label: 'sketch.plane', min: 1, max: 1 }`), `entities` a `constraints` (`{ kind: 'data', label: … }`). Jména parametrů jsou v modulu `sketch` jako `SKETCH_PARAM` a schéma ověří typem (`satisfies Record<keyof SketchParams, ParamSpec>`), že sedí na klíče `SketchParams`. Skicář v `interaction` čte a zapisuje parametry skici jen přes `SKETCH_PARAM`, takže jedinou vazbou na plugin zůstává `SKETCH_FEATURE_TYPE` a tato jména ([[0017-modul-sketch-a-skicar|ADR 0017]]). `validate` = `validateAgainstSchema` a, když jsou `entities` i `constraints` přítomné, `parseSketchData` převedené na `ParamIssue { param: path, code, params: { index } }`.
- Plugin **nemá nástroje** ani operace: vstup do skicáře je vestavěný nástroj `sketch` v modulu `sketcher` ([[0024-modul-sketcher|ADR 0024]]) ([[0017-modul-sketch-a-skicar|ADR 0017]]) a editace jde přes `feature.setParams` ([[Q074 Operace skicáře v logu|Q074]]).
- **Builder:** (1) `ctx.resolvePlanes(params.plane)`, chyba → `unresolvedReference('plane', e)`; (2) `parseSketchData` (parametry jsou ověřené, `err` je chyba programu → výjimka); (3) `computeRegions(data)`; `crossing` → `ctx.warn('Sketch curves cross each other; no regions')`; (4) pro každou oblast v pořadí `kernel.makeFace({ plane, outer, holes })`; (5) nový artefakt `SketchArtifact { kind: 'sketch', id: sketchId(feature.id), owner: feature.id, plane, entities: data.entities, regions }` (mapa jméno → handle v pořadí oblastí), zmrazený, do nové mapy artefaktů. Chyba jádra proletí (`KERNEL`). Skica bez oblastí je platná (artefakt s prázdnou mapou).

## Roviny a počátek

Počáteční roviny jsou [[Artefakt|artefakty]] vyhrazeného vlastníka `origin` seedované do `EMPTY_STATE` ([[0015-artefakty-a-identita-telesa|ADR 0015]]). `SketchParams.plane` je proto obyčejná reference `PlaneRef`, ne výčet `'XY' | 'XZ' | 'YZ'`; skica na ploše (M14) přidá referenci na rovinnou plochu.

| Id | Jméno (klíč) | `origin` | `xDir` | `normal` | Pohled kolmo |
|---|---|---|---|---|---|
| `origin/plane:xy` | `origin.plane.xy` („Horní“) | 0 | +X | +Z | `top` |
| `origin/plane:xz` | `origin.plane.xz` („Přední“) | 0 | +X | −Y | `front` |
| `origin/plane:yz` | `origin.plane.yz` („Pravá“) | 0 | +Y | +X | `right` |

Osa y roviny = `normal × xDir` vyjde u všech tří +Y, +Z, +Z – skica na přední a pravé rovině má „nahoru“ osu Z jako v Onshape. Osy počátku `origin/axis:x|y|z` přibyly s Revolve v M13 jako artefakty téhož vlastníka ([[03-dokument#Počáteční geometrie (M12)]], [[07-regenerace#Princip]]).

**Skica na rovinné ploše tělesa** (M14, [[08-topologicke-pojmenovani#Reference ve featurách]], [[Rozhodnutí noční rychloakce#M14 – Topologické pojmenování|R106]]): `plane` může být `TopoRef` na plochu (`<box>/face:top`). `BuildContext.resolvePlanes` najde plochu podle jména (víc ploch → první a varování, nerovinná → `UNRESOLVED_REFERENCE`) a rámec spočítá čistá funkce `sketchPlaneOfFace({ origin, normal })` z `regen`: `normal` = normála plochy ven z tělesa, počátek = průmět počátku světa do roviny plochy, `xDir` = jednotkový průmět +X do roviny, a když `|normal · X| ≥ 0,9`, průmět +Y. Pro plochy rovnoběžné s počátečními rovinami tak vyjde stejný rámec jako u nich (horní stěna kvádru = XY posunutá do výšky stěny, přední = XZ…), nezávisle na parametrizaci plochy v OCCT. Skica se s plochou stěhuje: vyšší kvádr → rovina skici výš, entity skici v rovině zůstávají. Zanikne-li plocha, skica je červená a skicář ji otevře na rovině XY s hláškou „Rovina skici chybí, vyberte novou“ (`SketchState.planeMissing`) a s aktivním výběrem roviny, aby šla přepojit ([[Q079 Skica se zaniklou rovinou|Q079]], [[M21-vstupni-stav-editovane-featury|M21]]). Totéž platí pro referenci, kterou nejde přečíst. Příznak zmizí, jakmile se parametr `plane` změní na spočitatelnou rovinu (i na XY). Zrušení výběru nechá skicu na XY s hláškou; „Hotovo“ uloží entity a vazby a ztracenou referenci roviny ponechá (skica zůstane v chybě).

## Oblasti (profily)

> [!note] Od M30
> Oblasti počítá jádro (`SketchOps.profileRegions`, [[0028-geometrie-skici-v-jadre|ADR 0028]]), algoritmus níže je od té doby implementace `FakeKernel` a **kontrakt výsledku** pro obě implementace. Viz [[#Geometrie skici v jádře (M30)]].

```ts
// sketch/regions.ts
export interface SketchRegion {
  /** Id všech hraničních křivek (vnější i díry), bez duplicit, seřazená (porovnání řetězců), spojená ','. */
  readonly name: string;
  readonly outer: readonly Curve2[];                     // uzavřená smyčka proti směru hodinových ručiček
  readonly holes: readonly (readonly Curve2[])[];        // uzavřené smyčky po směru hodinových ručiček
  readonly area: number;                                 // > 0: vnější minus díry
}
export interface RegionsResult { readonly regions: readonly SketchRegion[]; readonly crossing: boolean }
export function computeRegions(data: SketchData): RegionsResult;   // oblasti seřazené podle name
```

Čistá 2D geometrie v TypeScriptu, testovatelná bez OCCT. Postup:

1. **Křivky:** jen nekonstrukční úsečky, kružnice a oblouky; úsečka nulové délky (≤ tolerance) se vynechá. Tolerance `tol = 1e-9 · max(1, největší |souřadnice|)`.
2. **Uzly:** konce křivek; konce bližší než `tol` jsou jeden uzel (body s vazbou `coincident` tak splynou). Kružnice je uzavřená hrana bez uzlu.
3. **Křížení:** dvě křivky, které mají společný bod mimo sdílený koncový uzel (vnitřní průsečík, dotyk konce s vnitřkem jiné křivky, překryv), → `{ regions: [], crossing: true }`. Průsečík, který vyjde do `1e3 · tol` od společného uzlu, se k uzlu přiřadí (vzorce průsečíků jsou u téměř tečných křivek nepřesné). Dělení křivek v průsečících je mimo rozsah M12 ([[Rozhodnutí noční rychloakce#M12 – Skicář|R40]] ⚠).
4. **Prořezání:** opakovaně se odeberou hrany s uzlem stupně 1 (otevřené čáry neohraničují nic).
5. **Stěny:** polohrany (half-edge); v každém uzlu se odchozí polohrany seřadí proti směru hodinových ručiček podle úhlu tečny v uzlu; při shodě úhlu (do 1e-9 rad, tečný oblouk a úsečka) je dál ta, která se víc stáčí doleva (větší znaménková křivost: oblouk otáčející se proti směru `+1/r`, po směru `−1/r`, úsečka 0). `next(e)` = odchozí polohrana v cílovém uzlu bezprostředně **po směru** hodinových ručiček od `twin(e)`. Cykly se znaménkovou plochou (shoelace + kruhová úseč u oblouků) > 0 jsou omezené stěny, < 0 vnější hranice komponenty.
6. **Díry:** vnější hranici komponenty (a kružnici jako samostatnou komponentu) přiřadí jako díru té omezené stěně **jiné** komponenty s nejmenší plochou, která obsahuje její libovolný bod (např. první bod první křivky). Bez takové stěny se nepřiřadí nikam.
7. **Jméno** z id hraničních křivek, takže je stabilní při změně kót i pořadí kreslení; jiná oblast stejné jméno mít nemůže (dvě omezené stěny s týmž souborem hran planární graf bez křížení nedovolí). Extrude ukládá `SketchRegionRef { sketch: FeatureId, region: name }` ([[03-dokument#Reference na jiné entity]]).

**Spotřebitelé oblastí (M13):** Vysunutí a Rotace dostanou plochu oblasti přes `BuildContext.resolveRegions` ([[07-regenerace#Builder featury]]); `interaction` spočítá stejné oblasti z entit artefaktu znovu (`artifactDrawing`), aby je `render` uměl vyplnit a pickovat ([[10-interakce#Kresba skici]]) – jména se shodují, protože jde o stejnou čistou funkci nad stejnými daty. Osou Rotace může být úsečka skici, i konstrukční (`SketchEntityRef`). **M14:** id křivek v oblastech (`Curve2.id`) dávají bočním plochám vysunutí a rotace jména `face:side:<id entity>` ([[08-topologicke-pojmenovani#Plochy]]).

## Řešič vazeb

Za portem v modulu `sketch`, stejně jako jádro ([[0016-planegcs-resic-vazeb|ADR 0016]], [[Q020 Planegcs v samostatném workeru|Q020]]):

```ts
// sketch/solver.ts
export interface SolveInput extends SketchData {
  /** Tažený bod a cíl v rovině skici; dočasné vazby, které ustoupí ostatním. */
  readonly drag?: { readonly point: SketchEntityId; readonly to: Vec2 };
}
export type SolveStatus = 'ok' | 'conflict' | 'failed';
export interface SolveResult {
  readonly status: SolveStatus;
  /** Jen 'ok': vstupní entity se stejným pořadím, id a poli, jen s novými souřadnicemi bodů a poloměry kružnic. */
  readonly entities: readonly SketchEntity[] | null;
  /** Stupně volnosti bez tažení; null u 'failed'. */
  readonly dof: number | null;
  readonly conflicting: readonly SketchConstraintId[];
  readonly redundant: readonly SketchConstraintId[];
}
export interface ConstraintSolver {
  /** Odmítne jen při selhání infrastruktury (worker zanikl → RpcError 'disconnected'); chyba řešení je status. */
  solve(input: SolveInput): Promise<SolveResult>;
}
```

- **Stav:** neprázdné `conflicting` → `'conflict'` (bez poloh); jinak selhání řešiče → `'failed'`; jinak `'ok'` (i při `redundant`, ty jen hlásí). Plně určená skica = `'ok'` a `dof === 0`.
- Vstup se čte synchronně při volání (izolace jako u jádra).
- **Adaptér `solver-planegcs`** (prstenec 3): čistá funkce `solveSketch(module, input)` postaví při každém volání nový `GcsSystem` s `debug_mode = NoDebug`; body jako `point` (`fixed: false`), úsečky `line`, kružnice `circle`, oblouk `arc` + `arc_rules` (úhly a poloměr spočítané z bodů); vazby `coincident → p2p_coincident`, `horizontal → horizontal_l`, `vertical → vertical_l`, `parallel → parallel`, `perpendicular → perpendicular_ll`, `equal → equal_length` / `equal_radius_cc|ca|aa`, `tangent → tangent_lc|la|cc|ca|aa` (úsečka vždy první), `distance → p2p_distance`, `radius → circle_radius` / `arc_radius`, `fix → coordinate_x` + `coordinate_y` s id `<id>:x`, `<id>:y` na aktuální souřadnice (ne `fixed: true`, jinak by se vazba mezi pevnými body tiše ignorovala); tažení → `coordinate_x/y` s `temporary: true` a id `__drag:x|y`. Id v seznamech konfliktů a redundancí se převedou zpět (přípona pryč, `__drag` vynechat, bez duplicit). Po `Failed` ani při konfliktu se `apply_solution` nevolá. Na konci `destroy_gcs_module()`. Nekonečné číslo ve výsledku → `'failed'`.
- **Worker:** `serveRpc` synchronně při startu, modul se načte líně při prvním volání; `WebAssembly.RuntimeError` (OOM, abort) instanci zahodí (další volání načte novou) a volání vrátí `'failed'`. `createPlanegcsSolver(): ConstraintSolver & Disposable` vytvoří worker líně při prvním `solve`; volání odmítnuté `'disconnected'` worker ukončí a další `solve` spustí nový.
- `FakeSolver` (`sketch/testing.ts`) pro testy `interaction` a `app`: vrací vstup (tažený bod přesune na cíl), naivní `dof = max(0, 2·bodů + kružnic − Σ váha vazeb − oblouků)` s vahami `coincident 2, fix 2`, ostatní 1; `next(partial)` vnutí další výsledek (fronta), `hold()`/`release()` pozdrží odpovědi (test souběhu), `calls` zaznamenává vstupy.

## Operace a transakce

Editace skici zapisuje **`feature.setParams`** přes `FeatureEditSession.setParams({ entities, constraints })` ([[Q074 Operace skicáře v logu|Q074]]). Vlastní operace `sketch.*` ani `FeaturePlugin.ops` v M12 nevznikají ([[Rozhodnutí noční rychloakce#M12 – Skicář|R36]] ⚠). Celá editace skici (od vstupu do skicáře po „Hotovo“) je jedna transakce: nová skica = jeden záznam `batch[feature.add, feature.setParams]`, úprava = jeden `feature.setParams` (sousední `setParams` téže featury se sloučí). „Zrušit“ transakci zahodí. Undo uvnitř skicáře v M12 není (transakce je otevřená, [[Rozhodnutí noční rychloakce#M12 – Skicář|R44]] ⚠).

## Režim skicáře (sketcher)

**Rovina** ([[0025-vstupni-stav-editovane-featury|ADR 0025]], [[M21-vstupni-stav-editovane-featury|M21]]): editovaná skica bere rovinu z vlastního artefaktu (`planeOfSketch` = `SketchArtifact.plane`, kterou builder spočítal ze vstupu skici), až bez artefaktu (skica v chybě) z reference přes `resolvePlane`. Pozdější Transformace ani Boolean ji tak neposune ani nezruší ([[Rozhodnutí noční rychloakce|R108]]). Rovinu jde změnit polem Rovina v panelu ([[11-ui#Komponenty]]): `SketchSession.plane` je `Observable<Plane>`, po změně parametru `plane` se přepočítá a překreslí kresba i kóty; fokus parametru po výběru roviny ruší `interaction` (`pickEndsFocus`). Panel ovládá výběr příkazy `pickPlane()` a `cancelPlanePick()` a čte `SketchState.planeField`. Rovina, kterou nejde spočítat (nerovinná plocha), se nepřevezme a chybu ukáže regenerace. Entity zůstávají ve 2D souřadnicích nové roviny.

Kontrakt v [[10-interakce#Skicář]]. Shrnutí chování:

- **Vstup:** nástroj `sketch` (lišta *Skica*, `Shift+S`) vytvoří skicu na rovině vybrané v Prohlížeči (položka výběru `plane`), od M14 i na vybrané rovinné ploše tělesa (položka `face` se jménem, `TopoRef`), jinak na `origin/plane:xy`; dvojklik na skicu v Timeline nebo v Prohlížeči ji otevře k úpravě. Aplikace přejde do režimu `'sketch'`: lišta ukáže nástroje skicáře, kamera se natočí kolmo na rovinu (`setViewDirection(plane.normal)`), dialog featury se nekreslí, místo něj panel skici.
- **Nástroje:** výběr a tažení bodů (`sketch.select`, výchozí v režimu skici), úsečka – polyline (`L`), obdélník (`R`), kružnice střed + bod (`C`), oblouk střed + začátek + konec (`A`), kóta (`D`).
- **Automatické vazby:** snap na existující bod (picking v okruhu 6 px, body mají přednost) použije jeho id; snap na počátek roviny vytvoří bod `[0, 0]` s vazbou `fix`; úsečka, která svírá s osou x nebo y roviny úhel do 3°, dostane `horizontal`/`vertical`; obdélník má vždy dvě `horizontal` a dvě `vertical`.
- **Přichycení k mřížce** (M19.2 D4): nový volný bod kreslicích nástrojů (úsečka, obdélník, kružnice, oblouk) se při pohybu i kliku zaokrouhlí na aktuální krok mřížky skici v souřadnicích roviny. Přichycení k existujícímu bodu a k počátku má přednost. Krok je ten, který viewport právě kreslí (`Viewport.sketchGridStep()`, 1–2–5 × 10ⁿ mm podle zoomu, [[09-vykreslovani#Skici]]). Přichycení vypíná přepínač `SketchEditor.setGridSnap(false)` (výchozí zapnuto, přežije zavření a otevření skici, neukládá se) a dočasně podržená klávesa Alt. Mřížka zůstává vidět i s vypnutým přichycením. Tažení bodu a nástroj kóty se nepřichytávají. Kontrakt v [[10-interakce#Nástroje a akce skicáře]].
- **Vazby** jsou akce nad výběrem (lišta, zkratky `H`, `V`, `I`): `constraintFor(kind, výběr)`; konfliktní nebo redundantní vazba se nepřidá a panel ukáže hlášku. **Kóta** vznikne se změřenou hodnotou a její pole v panelu dostane fokus; změna hodnoty přepočítá skicu, konflikt hodnotu odmítne. Od M19.2 (D4) je kóta vidět i ve viewportu (vynášecí a kótovací čára se šipkami, u poloměru odkazová čára a `R…`) a dvojklikem na popisek jde změnit na místě; hodnoty v panelu i ve viewportu jsou zaokrouhlené na 2 desetinná místa, model drží přesnou hodnotu ([[11-ui#Komponenty]], Režim skici).
- **Tažení bodu:** `solve` s `drag` při každém pohybu, nejvýš jeden rozpracovaný požadavek a jeden čekající cíl (poslední vyhrává).
- **Stupně volnosti** v panelu („Stupně volnosti: 4“ / „Plně určeno“); plně určená skica se kreslí barvou `sketchDefined` (jako černá v Onshape), jinak `sketch` (modrá).
- **Hotovo** (`sketch.finish`) = commit, **Zrušit** (`sketch.cancel`) = abort; obojí vrátí režim `'model'`.

## Kresba a picking

Skicu kreslí `render` z dat, ne z jádra ([[0017-modul-sketch-a-skicar|ADR 0017]]): `interaction` převede entity na `SketchDrawing` (rovina + úsečky, oblouky a body ve 2D se stylem) a pošle ji `ViewportPort.sketches.set(id, kresba)` ([[10-interakce#Port viewportu]], [[09-vykreslovani#Skici]]). Editovaná skica má id `'sketch-edit'` (kreslí ji `SketchEditor`, i s body a počátkem `'__origin'`); skici z poslední regenerace (bez konstrukčních křivek a bez bodů) a zapnuté počáteční roviny (čtverec 100 × 100 mm) kreslí `app` pod id artefaktu. Picking entit skici (`PickKind 'sketchEntity'`) dělá `render` nad vykreslenými křivkami a body v pixelech, ne `interaction` ručně.

Od M19.2 (D2) tělesa skici zakrývají, při kreslení i při pickingu: entita nebo oblast skici za bližším tělesem se nevybere. Výjimkou je editovaná skica (`SketchDrawing.editing`): pro picking zakrytá není a její zakryté části se kreslí slabě a čárkovaně. V její rovině se kreslí mřížka skici ([[09-vykreslovani#Skici]]).

## Mimo rozsah M12

- „Most“ – úsečka spojující vnitřní smyčku s vnější: stěna ji obsahuje tam i zpět, díra nevznikne a `makeFace` nejspíš selže (`'operation-failed'`); uživatel most smaže.

Každá položka je v [[Rozhodnutí noční rychloakce#M12 – Skicář|rozhodnutích R31–R50]]: splines, odsazení (offset), úhlová kóta a vzdálenost bod–přímka, vazba bod na křivce (snap na vnitřek úsečky), dělení křivek v průsečících (trim), značky vazeb ve viewportu (vazby jsou jen v panelu), tažení úseček a kružnic (jen body), undo uvnitř skicáře, skica na ploše tělesa (M14), výplň rovin. Osy počátku a výběr oblasti přidal M13, popisky kót ve viewportu M19.2 ([[11-ui#Komponenty]], Režim skici).

## Rozšíření skicáře (M25–M29)

Naplánováno 2026-10-15, zatím jen rozsah – kontrakt se do sekcí výše dopíše při startu každého milníku. Řeší několik položek z *Mimo rozsah M12* (značky vazeb, splines, úhlová kóta a vzdálenost bod–přímka, bod na křivce).

| Milník | Co přibude | Dopad na data | Otázka |
|---|---|---|---|
| [[M25-glyfy-vazeb\|M25]] | glyfy vazeb ve viewportu, výběr a mazání glyfu, seznam vazeb v panelu sbalený | žádný (`SketchState.glyphs`, vrstva v `ui`) | [[Q083 Rozložení glyfů vazeb\|Q083]] |
| [[M26-snapper-a-auto-vazby\|M26]] | snapper (čistá funkce v `sketch`), vodítka, automatické vazby ověřené řešičem, potlačení Ctrl/Cmd | nové vazby `pointOnCurve`, `midpoint`, `hAlign`/`vAlign` (zpětně kompatibilní) | [[Q084 Inference automatických vazeb\|Q084]] |
| [[M27-oblouky-a-kruznice\|M27]] | kružnice 2 body, 3 body, 2 a 3 tečny; oblouk 3 body a tečný; tečný oblouk v polyline; rodiny nástrojů v liště | žádný | – |
| [[M28-koty\|M28]] | jeden nástroj Kóta (druh podle polohy myši), vodorovná, svislá, bod–přímka, úhel, průměr; přetahování | nové druhy kót, poloha popisku | [[Q085 Poloha kóty v datech\|Q085]] |
| [[M29-spliny\|M29]] | kubický B-spline přes řídicí body (NURBS) a přes body; oblasti, vysunutí | nová entita, nová varianta `ProfileCurve` v `kernel` | [[Q086 Spline přes body v řešiči\|Q086]] |

**Souběžná práce:** M25–M27 (stopa A), M28 (stopa B) a M29 bez nástrojů (stopa C) se implementují souběžně ve třech worktree ([[Roadmapa#Závislosti milníků]]). Kontrakty sdílených typů jsou proto zafixované níže předem: každá stopa přidá jen své členy unií `SketchEntity`, `SketchConstraint` a `Curve2` a své větve do vyčerpávajících `switch` (`parseSketchData`, adaptér planegcs, `removeItems`, kresba). Nástroje splinu (M29) přijdou až po sloučení M26, protože stojí na snapperu.

## Glyfy vazeb (M25)

Rozhodnuto v [[Q083 Rozložení glyfů vazeb|Q083]]: styl Onshape, glyfy kreslí **vrstva v `ui` nad pohledem** stejně jako kóty z M19.2 (ne `render`). Nový `PickKind` ani změna `render` nevzniká.

```ts
// sketcher/sketch-glyphs.ts (čistá funkce, sketcher ji volá při každé změně stavu)
export type GlyphKind = Exclude<SketchConstraint['kind'], DimensionKind>;   // geometrické vazby; každá stopa přidá své
export interface SketchGlyphView {
  readonly constraint: SketchConstraintId;
  readonly kind: GlyphKind;
  /** Entita, u které glyf leží; vazba dvou entit má dva glyfy (u každé jeden). */
  readonly entity: SketchEntityId;
  /** Kotva na entitě ve světových souřadnicích. */
  readonly anchor: Vec3;
  /** Jednotkový směr v rovině skici (ve světě), kterým se glyfy u téže kotvy skládají; kolmo od entity. */
  readonly side: Vec3;
  /** Pořadí v řadě u téže kotvy (0, 1, …) v pořadí vazeb v datech. */
  readonly slot: number;
  /** Vazba je pod kurzorem (hover glyfu) nebo vybraná. */
  readonly hover: boolean;
  readonly selected: boolean;
}
export function glyphViews(
  plane: Plane, data: SketchData, visible: 'all' | ReadonlySet<SketchItemId>,
  selection: readonly SketchItemId[], hover: SketchItemId | null, prev: readonly SketchGlyphView[],
): readonly SketchGlyphView[];
```

- **Které vazby:** `visible = 'all'` (přepínač „Zobrazit vazby“) → všechny geometrické vazby; jinak ty, které odkazují na entitu z množiny (vybrané entity, entita pod kurzorem a entity vybrané nebo najeté geometrické vazby). Množinu skládá session; vybraná nebo najetá **křivka** do ní přidá i své definiční body (konce úsečky, střed kružnice, střed a konce oblouku), takže výběr úsečky ukáže i `coincident` a `fix` na jejích koncích (jako Onshape). Glyf se kreslí u každé jejich entity, nejen u vybrané. Kóty glyf nemají (mají vlastní kresbu) a vybraná nebo najetá kóta glyfy ani zvýraznění entit nepřidá.
- **Řada (`slot`):** glyfy se skládají podle **polohy kotvy**, ne podle entity: kotvy, které se v souřadnicích roviny liší nejvýš o 1e-6 mm, tvoří jednu řadu (tečka `coincident` u bodu `a` a `fix` u shodného bodu `b` se tak nepřekryjí). `slot` číslují jen zobrazené glyfy, řada je bez mezer a při změně výběru se může posunout. Úsečka nulové délky má `side` +y.
- **Kotvy:** bod (`coincident`, `fix`) = bod; úsečka = střed; kružnice = bod nahoře (úhel π/2); oblouk = střed oblouku; `side` = normála úsečky otočená k +y roviny (svislá úsečka → −x), u kružnice a oblouku směr od středu ke kotvě, u bodu +x+y normalizované. `coincident` má jeden glyf u bodu `a` (vykreslí se jako plná tečka, ne ikona). Stopy M26 a M29 doplní kotvy svých vazeb a entit.
- **Neměnnost:** nezměněná položka zůstane stejným objektem z `prev`, nezměněný výsledek stejným polem (jako `dimensionViews`).
- **Stav:** `SketchState.glyphs: readonly SketchGlyphView[]`. Přepínač: `SketchEditor.showAllConstraints: Observable<boolean>` a `setShowAllConstraints(on)`, výchozí `false`, přežije zavření skici, neukládá se (jako `gridSnap`).
- **Hover a výběr vazby** používají stávající `SketchSession.setHover(id)` a `select(id, { additive })` s id vazby; smazání stávající akcí mazání nad výběrem. Najetá nebo vybraná vazba zvýrazní své entity v kresbě (styl `hover`/`selected`), pokud už nejsou vybrané.
- **`ui`:** `SketchGlyphs.vue` (sourozenec `SketchDimensions`, jen při otevřené skice) a čistá `glyphLayout(glyphs, project, { sizePx: 16, gapPx: 2, offsetPx: 10 })` → střed každého glyfu v px: průmět kotvy + `side` promítnutý do obrazovky a normalizovaný × (`offsetPx` + `slot` · (`sizePx` + `gapPx`) + `sizePx`/2). Nepromítnutá kotva, nebo `side` promítnutý na nulovou délku (rovina viděná z hrany) → glyf se nekreslí. Glyf je tlačítko s ikonou druhu (SVG v `ui/sketch-glyph-icons.ts`, `aria-label` = název vazby, `aria-pressed` = vybraná), `pointerenter`/`pointerleave` → `setHover`, klik → `select` (aditivně podle `isAdditive`). Přepočet při změně `glyphs` a při `onViewChanged`.
- **Panel:** seznam vazeb a kót je sbalitelná sekce (`<details>`), výchozí sbalená, stav se neukládá. Když panel dává fokus poli nové kóty, sbalená sekce se nejdřív sama rozbalí. Přepínač „Zobrazit vazby“ je v panelu nad ní (vedle přichycení k mřížce).
- **Testy:** `glyphViews` (které vazby pro výběr/hover/`all`, dva glyfy u dvouentitové vazby, `slot` u sdílené kotvy, kotvy a `side` všech druhů, stabilita objektů); `glyphLayout` (skládání, nepromítnutá kotva); `SketchGlyphs.vue` (hover → `setHover`, klik → `select`, `aria-pressed`); session (najetá vazba zvýrazní entity); e2e (výběr úsečky ukáže glyf `horizontal`, klik a Delete vazbu smaže).

## Snapper a auto-vazby (M26)

Rozhodnuto v [[Q084 Inference automatických vazeb|Q084]]: prahy v pixelech (6 px) a stupních (3°), pevné pořadí priorit, víc vazeb na klik (nejvýš jedna na dvojici entit), stejná délka a poloměr jen s navazující křivkou s tolerancí 2 %. Snapper je **čistá synchronní funkce v `sketch`**, nástroje v `sketcher` ji jen volají; řešič kandidáty ověří při zápisu.

### Nové vazby

```ts
// nové členy SketchConstraint (sketch/model.ts)
| { readonly kind: 'pointOnCurve'; readonly id: SketchConstraintId; readonly point: SketchEntityId; readonly curve: SketchEntityId } // bod + úsečka/kružnice/oblouk, od M29 i spline
| { readonly kind: 'midpoint'; readonly id: SketchConstraintId; readonly point: SketchEntityId; readonly line: SketchEntityId }     // bod ve středu úsečky
| { readonly kind: 'hAlign' | 'vAlign'; readonly id: SketchConstraintId; readonly a: SketchEntityId; readonly b: SketchEntityId } // dva body se stejnou y (hAlign) / x (vAlign)
// GeometricConstraintKind (akce lišty) dostane 'midpoint' za 'tangent'; pointOnCurve, hAlign a vAlign vznikají akcemi coincident a horizontal/vertical (níže)
```

- `pointOnCurve` drží bod na **celé** nosné přímce úsečky nebo kružnici oblouku (jako Onshape a FreeCAD), ne jen na úseku. Bod nesmí být definičním bodem té křivky (`curvePoints`), jinak `sketch.invalidConstraint`.
- `midpoint`: bod nesmí být koncem úsečky. `hAlign`/`vAlign`: `a !== b`, oba body.
- **`parseSketchData`:** nové tvary a odkazy podle tabulky výše; staré dokumenty zůstávají platné, migrace není.
- **`constraintFor`** (konvence Onshape, bez nových akcí kromě Středu): `coincident` – 2 body → `coincident`, bod + křivka (libovolné pořadí) → `pointOnCurve`; `horizontal`/`vertical` – 1 úsečka jako dřív, 2 body → `hAlign`/`vAlign`; `midpoint` – bod + úsečka (libovolné pořadí). Bod, který je definičním bodem křivky, → `null`.
- **`constraintTargets`:** `pointOnCurve` → `[point, curve]`, `midpoint` → `[point, line]`, `hAlign`/`vAlign` → `[a, b]`. `removeItems` kaskádu bere z `constraintTargets` jako dřív.
- **Adaptér planegcs:** `pointOnCurve` → `point_on_line_pl` / `point_on_circle` / `point_on_arc`; `midpoint` → `p2p_symmetric_ppp(p1, p2, point)`; `hAlign` → `horizontal_pp`, `vAlign` → `vertical_pp`.
- **`FakeSolver`:** váha `pointOnCurve`, `midpoint` 1 a 2, `hAlign`/`vAlign` 1.
- **Glyfy** (M25): `pointOnCurve` a `midpoint` mají jeden glyf u bodu (ikony: bod na čáře, `M`-značka středu), `hAlign`/`vAlign` u obou bodů (ikony: tečkovaná vodorovná / svislá čára). Kotvy jako u bodu. Akce lišty Střed: ikona jako glyf, zkratka žádná, i18n `sketch.constraint.midpoint` „Střed“ / „Midpoint“, ostatní nové druhy `sketch.constraint.pointOnCurve` „Bod na křivce“ / „Point on curve“, `hAlign` „Zarovnat vodorovně“ / „Align horizontally“, `vAlign` „Zarovnat svisle“ / „Align vertically“.

### Snapper

```ts
// sketch/snap.ts (čisté funkce, souřadnice roviny v mm)
export interface SnapOptions {
  /** Práh přichycení v mm = 6 px převedené v místě kurzoru (počítá sketcher z pohledu). */
  readonly tolerance: number;
  /** Krok mřížky v mm, null = bez mřížky (vypnuto nebo Alt). */
  readonly grid: number | null;
  /** false = Ctrl/Cmd: jen poloha na existující bod a počátek a mřížka, žádné jiné přichycení ani vazby. */
  readonly infer: boolean;
  /** Entity, které se nepřichytávají (rozpracovaná položka nástroje, není-li ještě v datech). */
  readonly exclude?: ReadonlySet<SketchEntityId>;
}
export type SnapKind = 'point' | 'origin' | 'midpoint' | 'onCurve' | 'alignBoth' | 'align' | 'grid' | 'free';
/** Vazba k bodu, který teprve vznikne (id dostane v nástroji). */
export type PointInference =
  | { readonly kind: 'fix' }                                                    // počátek
  | { readonly kind: 'pointOnCurve'; readonly curve: SketchEntityId }
  | { readonly kind: 'midpoint'; readonly line: SketchEntityId }
  | { readonly kind: 'hAlign' | 'vAlign'; readonly with: SketchEntityId };    // s existujícím bodem
export interface SnapGuide { readonly axis: 'h' | 'v'; readonly from: Vec2; readonly to: Vec2 } // tečkované vodítko od bodu ke kurzoru
export interface SnapResult {
  readonly at: Vec2;
  readonly kind: SnapKind;
  /** Existující bod, jehož id se použije (kind 'point'); jinak null. */
  readonly point: SketchEntityId | null;
  readonly inferred: readonly PointInference[];
  readonly guides: readonly SnapGuide[];
}
export const ORIGIN_SNAP: Vec2;   // [0, 0]
export function snap(cursor: Vec2, data: SketchData, opts: SnapOptions): SnapResult;
```

**Pořadí** (první, které platí; „blízko“ = vzdálenost ≤ `tolerance`):
1. `point`: nejbližší existující bod (konce, středy kružnic a oblouků, samostatné body) blízko kurzoru; `inferred` prázdné.
2. `origin`: počátek `[0, 0]` blízko (a žádný bod v datech tam neleží) → `at = [0, 0]`, `inferred = [fix]`.
3. `midpoint` (jen `infer`): střed úsečky blízko → `[midpoint(line)]`.
4. `onCurve` (jen `infer`): nejbližší bod nejbližší křivky (úsek úsečky, kružnice, oblouk v jeho rozsahu) blízko → `at` = průmět, `[pointOnCurve(curve)]`.
5. `alignBoth` (jen `infer`): kurzor je zároveň do `tolerance` od svislice jednoho bodu a vodorovky jiného (nejbližší v každém směru) → `at` = průsečík, `[vAlign(p), hAlign(q)]`, dvě vodítka.
6. `align` (jen `infer`): jen jedno z nich → `at` = kurzor s přichycenou souřadnicí, jedna vazba a jedno vodítko. Druhá souřadnice se přichytí k mřížce, je-li zapnutá.
7. `grid`: `grid !== null` → zaokrouhlení na mřížku (jako dnes, −0 → 0).
8. `free`: kurzor.

„Bod“ je každá entita `point` (konce, středy, samostatné body). `exclude` vyřadí entitu ze všech kroků, body vyřazené křivky ne. Je-li nejbližším bodem ve svislém i vodorovném směru tentýž bod, vznikne jen `align` k bližší ose (shoda → svislá), jinak by nový bod padl na existující. Kandidáti zarovnání jsou jen body (ne středy úseček); oblouk je kandidátem kroku 4 jen v rozsahu svého úhlu; bod přichycení v kroku 1 nikdy nedostane zarovnání (je to existující bod). Při shodě vzdáleností vyhrává dřívější entita v datech. Bez `infer` platí jen kroky 1, 2, 7, 8.

```ts
// sketch/infer.ts – úhlové a délkové vazby nové úsečky (po poloze bodů)
export type LineInference =
  | { readonly kind: 'horizontal' | 'vertical' }
  | { readonly kind: 'parallel' | 'perpendicular' | 'equal'; readonly line: SketchEntityId }
  | { readonly kind: 'tangent'; readonly curve: SketchEntityId };
export function inferLine(
  from: { readonly at: Vec2; readonly point: SketchEntityId | null },
  to: Vec2, data: SketchData,
  opts: { readonly previous: SketchEntityId | null; readonly angleTolerance: number },   // 3° v radiánech
): readonly LineInference[];
export function inferRadius(radius: number, data: SketchData, previous: SketchEntityId | null): SketchEntityId | null; // equal s kružnicí/obloukem
```

- `inferLine`: úhel úsečky do 3° od osy → `horizontal`/`vertical` (jako dnes). Jinak pro **navazující křivky** – křivky dat, které používají bod `from.point` (u nového bodu žádné): úsečka do 3° od rovnoběžky → `parallel`, od kolmice → `perpendicular` (u každé nejvýš jedno, s osou má přednost); oblouk, jehož začátek nebo konec je `from.point` a jehož tečna v něm svírá s úsečkou do 3° → `tangent` (kružnice koncové body nemá, tečnu ze snapperu nedostane). Navazující úsečka je ta, jejíž `p1` nebo `p2` je `from.point`. `equal` jen s `previous` (předchozí úsečka řetězu polyline), když se délky liší nejvýš o 2 % delší z nich. Nejvýš jedna vazba na dvojici entit; pořadí výsledku: osa, `parallel`/`perpendicular`/`tangent` v pořadí dat, `equal`.
- `inferRadius`: `previous` (poslední kružnice nebo oblouk dat, který nástroj dostane od sketcheru) s poloměrem lišícím se nejvýš o 2 % → jeho id, jinak `null`.
- S Ctrl/Cmd se `inferLine` ani `inferRadius` nevolají; vodorovná/svislá z dnešního nástroje úsečky tím **také** odpadá (Ctrl/Cmd vypíná všechny automatické vazby kromě sdíleného bodu a `fix` počátku). Obdélník má své `horizontal`/`vertical` vždy (jsou jeho definicí, ne inference).

### Nástroje (`sketcher`)

- `snapAt` v `sketch-tools/snap.ts` místo pickingu volá `snap(cursorAt(...), data, { tolerance, grid, infer: !mods.mod, exclude })`; `tolerance` = vzdálenost v rovině mezi `cursorAt(x, y)` a `cursorAt(x + 6, y)` (rovnoběžný paprsek → klik se ignoruje jako dnes). `SnapTarget` nese `SnapResult`; `placePoint` z `inferred` vytvoří vazby s novými id (`pointOnCurve`, `midpoint`, `hAlign`/`vAlign` s novým bodem, `fix` u počátku).
- **Které nástroje:** úsečka (každý bod + `inferLine` pro každou novou úsečku, `previous` = předchozí úsečka řetězu), obdélník (rohy; nové rohy dostanou svá `inferred`), kružnice (střed; poloměr přes `snap` jen polohou, + `inferRadius`), oblouk (střed, začátek, konec; `inferRadius`). Tažení bodu a nástroj kóty snapper nepoužívají. Úsečka mezi dvěma existujícími body, které už spojuje existující úsečka, se nevytvoří (obdélník na existující hraně ji sdílí, i bez svých `horizontal`/`vertical` pro tu stranu; polyline se posune dál). Zarovnání nového bodu s počátečním bodem kreslené úsečky se nahradí její `horizontal`/`vertical`. Konec oblouku je vždy nový bod promítnutý na kružnici a **žádné** `inferred` ani vodítka nedostane (vazby spočítané pro místo kurzoru by po promítnutí neplatily); dopočítané rohy obdélníku se přichytávají bez mřížky a bez kliknutých rohů (`exclude`).
- **Ověření řešičem** (`SketchSession.addGeometry`): všechny vazby přidané `addGeometry` jsou automatické. Řešení s nimi; `'conflict'` → znovu bez přidaných vazeb ze seznamu `conflicting` (kromě `fix` a povinných), a když ani to nepomůže, bez všech přidaných vazeb kromě `fix` a vazeb, které nástroj označí jako povinné (`addGeometry(add, { required?: ReadonlySet<SketchConstraintId> })`, obdélník: své `horizontal`/`vertical`); přidané vazby v `redundant` se po zápisu vynechají (jako dnes). Nejvýš tři řešení na jeden zápis. Skica se kreslením nerozbije: buď se zapíše bez sporných vazeb, nebo (konflikt i bez nich) se geometrie odmítne jako dnes (`sketch.conflict`).
- **Náhled:** při pohybu nástroj nastaví `SketchSession.setInferencePreview(p: { at: Vec2; kinds: readonly GlyphKind[]; guides: readonly SnapGuide[] } | null)` (vazby, které by klik vytvořil – z `inferred` i `inferLine`/`inferRadius`); `SketchState.inference: { anchor: Vec3; kinds: readonly GlyphKind[] } | null` a vodítka kreslí sketcher do overlay `'sketch-guides'` stylem `'construction'` (bez změny `render`). Konec nástroje, Esc, deaktivace a klik náhled smažou.
- **`ui`:** `SketchGlyphs.vue` kreslí `SketchState.inference` jako vodorovnou řadu malých neaktivních ikon (`<span aria-hidden>`, `pointer-events: none`, třída `preview`): čistá `inferenceLayout` (`ui/sketch-glyphs.ts`, rozměry `GLYPH_LAYOUT`) dá první ikoně střed (`offsetPx` + `sizePx`/2) px vpravo a dolů od průmětu kotvy, každé další o `sizePx` + `gapPx` vpravo.
- **Co náhled ukazuje:** druhy vazeb, které by klik zapsal, spočítané **stejnou funkcí kroku nástroje** jako klik (`lineStep`, `rectangleStep`, `circleStep`, `arcStep`), takže se náhled a klik nerozejdou. Vlastní `horizontal`/`vertical` obdélníku a vazby už položeného prvního bodu se neukazují; přichycení na existující bod vazbu nevytváří, náhled je tedy prázdný; `fix` počátku se ukáže i s Ctrl/Cmd. Prázdný náhled → `inference: null`. Změna jen náhledu skicu nepřekresluje. Vodítka kreslí session (viewport skicáře dostane `overlay`). Náhled smaže klik, Esc, opuštění pohledu (`leave`), deaktivace nástroje a zavření session.

**Testy:** `snap` tabulkově (každý krok pořadí, shoda vzdáleností, `exclude`, `infer: false`, mřížka s `align`), `inferLine` (osa, rovnoběžka, kolmice, tečna k oblouku, `equal` 2 % hranice, jen navazující křivky, nejvýš jedna na dvojici), `inferRadius`; `parseSketchData` a `constraintFor` nových vazeb, `removeItems` kaskáda; adaptér planegcs (bod zůstane na úsečce při tažení úsečky, `midpoint`, `hAlign`); session (`conflict` → zápis bez sporných vazeb, `required` zůstanou, nejvýš tři řešení); nástroje s `FakeViewport` (Ctrl/Cmd bez vazeb, bod na úsečce dostane `pointOnCurve`, kolmá úsečka `perpendicular`, náhled a jeho smazání); e2e (akceptační kritéria M26).

## Oblouky a kružnice (M27)

Datový model se nemění (`circle`, `arc`); přibývají nástroje, čisté konstrukce počáteční polohy v `sketch` a rozbalovací skupiny nástrojů v liště. Počáteční poloha je jen **odhad**: vazby nástroje (tečnost, bod na křivce, sdílené body) ji při zápisu dořeší řešičem, jako ve Fusionu.

### Konstrukce (`sketch/construct.ts`, čisté funkce, souřadnice roviny)

```ts
export interface CircleFit { readonly center: Vec2; readonly radius: number }
export interface ArcFit { readonly center: Vec2; readonly radius: number; readonly ccw: boolean }   // ccw = od začátku ke konci proti směru hodinových ručiček
/** Kružnice s průměrem a–b; |a − b| ≤ 1e-9 → null. */
export function circleFrom2(a: Vec2, b: Vec2): CircleFit | null;
/** Opsaná kružnice; body na přímce (|cross| ≤ 1e-9 · max(1, rozměr²)) nebo shodné → null. */
export function circleFrom3(a: Vec2, b: Vec2, c: Vec2): CircleFit | null;
/** Oblouk start → end přes `through`; ccw podle toho, na které straně úsečky start–end leží through; na přímce → null. */
export function arcFrom3(start: Vec2, through: Vec2, end: Vec2): ArcFit | null;
/** Oblouk ze `start` tečný ke směru `direction` (jednotkový) do `end`; ccw, když end leží vlevo od směru; end na přímce směru (úhel ≤ 1e-9) nebo shodný → null. */
export function tangentArcFrom(start: Vec2, direction: Vec2, end: Vec2): ArcFit | null;
/**
 * Kružnice tečná ke 2 nebo 3 křivkám (úsečka = celá nosná přímka, oblouk = celá kružnice), odhad
 * nejbližší k `hint`: numericky (Gauss–Newton / Levenberg–Marquardt nad středem a poloměrem,
 * nejvýš 50 iterací) minimalizuje Σ (d_i(střed) − r)², u dvou křivek navíc slabý člen
 * λ · |střed − hint|² (λ = 1e-3), takže střed leží na množině středů nejblíž kurzoru. d_i je
 * vzdálenost od přímky, u kružnice | |p − c| − R |. Start ve `hint` s r = průměr d_i. Slabý člen
 * minimum mírně posune mimo tečné kružnice, proto následuje projekce: Gauss–Newton s nejmenší
 * normou jen nad rezidui tečnosti (obě fáze dohromady nejvýš 50 iterací). Jiný počet křivek než 2
 * nebo 3, úsečka nulové délky a spline → null.
 * Nekonvergence, r ≤ 1e-9 nebo zbytek tečnosti > 1e-6 · max(1, r) → null.
 */
export function tangentCircle(curves: readonly Curve2[], hint: Vec2): CircleFit | null;
/** Směr, kterým křivka pokračuje za svým koncovým bodem `point` (úsečka: od druhého konce; oblouk: tečna ve směru pohybu ke konci a dál); bod není koncem → null. */
export function endTangent(curve: SketchCurve, point: SketchEntityId, data: SketchData): Vec2 | null;
```

### Nástroje

| Nástroj (`id`) | Rodina, zkratka | Gesto | Vznikne |
|---|---|---|---|
| `sketch.circle` | `circle`, `C` | střed, bod na obvodu (jako dřív) | kružnice; vazby středu ze snapperu, `inferRadius` |
| `sketch.circle2p` | `circle` | dva body průměru | kružnice `circleFrom2`; klik přichycený na existující bod → `pointOnCurve(bod, kružnice)`; `inferRadius` |
| `sketch.circle3p` | `circle` | tři body na obvodu | `circleFrom3`; existující body → `pointOnCurve`; `inferRadius` |
| `sketch.circle2t` | `circle` | klik na křivku A, klik na křivku B, pohyb volí polohu (`tangentCircle([A, B], kurzor)`), klik zapíše | kružnice + `tangent(kružnice, A)`, `tangent(kružnice, B)` |
| `sketch.circle3t` | `circle` | klik na tři křivky; třetí klik zapíše | `tangentCircle([A, B, C], těžiště tří kliků)` + 3× `tangent` |
| `sketch.arc` | `arc`, `A` | střed, začátek, konec (jako dřív) | beze změny |
| `sketch.arc3p` | `arc` | začátek, konec, bod na oblouku | `arcFrom3`; nový bod středu; začátek a konec jsou body ze snapperu se svými vazbami; bod na oblouku přichycený na existující bod → `pointOnCurve`; `ccw === false` → začátek a konec se v datech prohodí (oblouk je vždy proti směru); `inferRadius` |
| `sketch.arcTangent` | `arc` | klik na koncový bod existující úsečky nebo oblouku, konec | `tangentArcFrom(bod, endTangent(křivka, bod), konec)`; sdílený začátek, `tangent(oblouk, křivka)`; konec je bod ze snapperu se svými vazbami |

- **Křivka pod kurzorem** (2t, 3t): úsečka, kružnice nebo oblouk editované skici do 6 px – snapper s vyloučenými body skici (klik u konce úsečky vybere úsečku), přichycení na střed úsečky je zásah té úsečky, jinak kandidát `onCurve`; klik mimo křivku nebo na už vybranou křivku nic. Do 6 px od počátku vyhrává počátek (křivku tam vybrat nejde – známé omezení). Vybrané křivky jsou během nástroje **výběrem session** (`select`/`clearSelection`, kreslí se stylem `selected`, předchozí výběr se zruší); Esc s rozpracovaným výběrem ho zruší, bez něj nástroj skončí. Hledání křivky ignoruje Ctrl/Cmd (tečny jsou povinné).
- **Navazující křivka** u `sketch.arcTangent`: koncový bod (snap `point`) musí být koncem úsečky nebo oblouku (začátek/konec), jinak klik nic; víc takových křivek → poslední v datech.
- **Povinné vazby** (`addGeometry` `required`, [[#Snapper a auto-vazby (M26)]]): `tangent` nástrojů 2t, 3t a tečného oblouku, `pointOnCurve` kliků 2p, 3p a bodu na oblouku. Ostatní (vazby bodů ze snapperu, `inferRadius`) jsou automatické. Konflikt i bez automatických → geometrie se nezapíše (`sketch.conflict`), nástroj zůstane aktivní.
- **Degenerovaný vstup** (konstrukce vrátí `null`, nulový poloměr): klik nic nevytvoří, rozpracovaný stav zůstane, náhled se nekreslí.
- **Náhled** jako u ostatních nástrojů: tvar stylem `preview` v overlay `'sketch-tool'`, náhled vazeb (`setInferencePreview`) z jedné funkce kroku nástroje (`circle2pStep` …), včetně `tangent` a `pointOnCurve`.
- **Ctrl/Cmd** vypne automatické vazby jako v M26, povinné zůstanou.

### Tečnost ve sdíleném koncovém bodě (adaptér planegcs)

Když dvě křivky vazby `tangent` (úsečka + oblouk, oblouk + oblouk) sdílejí koncový bod, planegcs u `tangent_la`/`tangent_aa` hlásí vazbu jako redundantní (ve sdíleném bodě je tečnost maximum vzdálenosti středu od druhé křivky, gradient je závislý na ostatních vazbách) a `addGeometry` by ji zahodil. Adaptér proto v tom případě mapuje `tangent` jako FreeCAD na **`angle_via_point(křivka a, křivka b, sdílený bod, úhel)`** s úhlem 0, nebo π podle toho, který je blíž úhlu tečen v aktuální geometrii (rozhoduje se při každém řešení; geometrie se mezi řešeními hýbe spojitě). Data se nemění. Týká se i tečny úsečky z konce oblouku z M26 (`inferLine`) a tečného oblouku v polyline. Kružnice koncové body nemá; bez sdíleného bodu zůstává `tangent_*`. „Sdílený“ znamená stejné id bodu – dva body spojené jen vazbou `coincident` jdou dál přes `tangent_*` (planegcs ji tam nejspíš označí za redundantní; nástroje body sdílejí, takže se to týká jen ručně spojených bodů). Úhel tečen: úsečka ve směru p1 → p2, oblouk proti směru hodinových ručiček; nezáporný skalární součin → 0, záporný → π. Úsečka u konce splinu má vlastní mapování ze stopy M29.

### Tečný oblouk v polyline

V nástroji úsečka s rozpracovaným řetězem: stisk na posledním bodu řetězu a tah nad `CLICK_TOLERANCE_PX` přepne do tečného oblouku (náhled oblouku `tangentArcFrom(poslední bod, směr předchozí úsečky nebo oblouku řetězu, kurzor)`); uvolnění zapíše oblouk se sdíleným začátkem, `tangent(oblouk, předchozí)` (povinná) a konec ze snapperu; řetěz pokračuje z konce oblouku (`previous` = oblouk – další úsečka dostane tečnu přes `inferLine`, je-li do 3°). Bez předchozí křivky (první bod řetězu) se tah ignoruje. Esc během tahu tah zruší, řetěz zůstane. Oblouk se počítá do podmínky uzavření (dvě křivky řetězu); konec oblouku na prvním bodu řetězu řetěz uzavře a ukončí jako uzavírací úsečka. Oblouk po směru se v datech uloží prohozením konců a řetěz pokračuje z bodu u kurzoru. Tah obsluhuje `clickTool` (`onDragStart` při prvním pohybu nad toleranci, `onDrag`, `onDragEnd`, Esc → `onDragCancel`); nástroj bez `onDragStart` tah ignoruje jako dřív. Společný kód s nástrojem Tečný oblouk je v `sketch-tools/tangent-arc.ts`.

### Rodiny nástrojů v liště

```ts
// interaction/tools.ts
interface ToolDescriptor { …; readonly family?: string }   // nástroje se stejnou rodinou ve skupině = jedno rozbalovací tlačítko
// interaction/toolbar-model.ts
interface ToolbarItem { …; readonly variants: readonly ToolbarItem[] }   // [] = obyčejné tlačítko (i rodina s jediným nástrojem v režimu a skupině); jinak všechny nástroje rodiny v pořadí registrace
```

- Rodina je v liště jedna položka: tlačítko ukazuje **naposledy aktivovaný** nástroj rodiny (stav modelu, neukládá se), na začátku první registrovaný; `active` = některý nástroj rodiny je aktivní. Šipka ▾ vedle otevře nabídku variant (stejná komponenta jako nabídka skupiny); položka nabídky nástroj aktivuje. Nabídka skupiny a „…“ ukazují varianty jako běžné položky.
- `ui`: `Toolbar.vue` kreslí položku s `variants` jako dělené tlačítko (hlavní část + ▾ s `aria-haspopup="menu"`, `aria-label` „Další způsoby: {popisek zobrazené varianty}“ / „More: {…}“, klíč `toolbar.variants`); šířka pro `toolbar-fit` je šířka obou částí.
- Popisky nástrojů i18n `tool.<id bez sketch.>`: `circle2p` „Kružnice 2 body“ / „2-point circle“, `circle3p` „Kružnice 3 body“ / „3-point circle“, `circle2t` „Kružnice 2 tečny“ / „2-tangent circle“, `circle3t` „Kružnice 3 tečny“ / „3-tangent circle“, `arc` „Oblouk středem“ / „Center point arc“, `arc3p` „Oblouk 3 body“ / „3-point arc“, `arcTangent` „Tečný oblouk“ / „Tangent arc“; `circle` zůstane „Kružnice“, rodiny bez vlastního popisku.

**Testy:** konstrukce (kružnice 2 a 3 body, kolineární → null, `arcFrom3` obě orientace, `tangentArcFrom` vlevo/vpravo/přímka, `tangentCircle` – dvě různoběžky: střed na ose úhlu u kurzoru; rovnoběžky: r = polovina vzdálenosti; úsečka + kružnice; tři strany trojúhelníku s hintem uvnitř → vepsaná; nekonvergence → null; `endTangent` úsečky a oblouku na obou koncích); model lišty (rodina = jedna položka, naposledy aktivovaná varianta, `active`, nabídka); nástroje s `FakeViewport` a `FakeSolver` (každý nástroj: vzniklé entity a vazby, degenerovaný vstup nic, Esc, náhled vazeb, `ccw === false` prohodí konce); polyline (tah z posledního bodu → oblouk + tečna, řetěz pokračuje, tah bez předchozí křivky nic); e2e (kružnice 3 body, 2 tečny ke dvěma úsečkám → 2× Tečnost v panelu, tečný oblouk v polyline, dělené tlačítko Kružnice ▾).

## Kóty (M28)

Rozhodnuto v [[Q085 Poloha kóty v datech|Q085]]. Nové druhy kót a volitelná poloha; staré dokumenty jsou platné beze změny, verze schématu skici zůstává 1.

```ts
export type DimensionKind =
  | 'distance' | 'hDistance' | 'vDistance' | 'pointLineDistance' | 'angle' | 'radius' | 'diameter';

// nové členy SketchConstraint (všechny mají volitelné placement)
| { kind: 'distance' | 'hDistance' | 'vDistance'; id; a: SketchEntityId; b: SketchEntityId; value: number; placement?: LinearPlacement }   // dva body
| { kind: 'pointLineDistance'; id; point: SketchEntityId; line: SketchEntityId; value: number; placement?: LinearPlacement }
| { kind: 'angle'; id; a: SketchEntityId; b: SketchEntityId; value: number; reverseA?: true; reverseB?: true; placement?: AngularPlacement } // dvě úsečky, 0 < value < π
| { kind: 'radius' | 'diameter'; id; curve: SketchEntityId; value: number; placement?: RadialPlacement }

/** Lineární kóta: kótovací čára rovnoběžná s měřeným směrem, ve vzdálenosti offset (mm, se znaménkem: kladná = vlevo od směru a→b; u hDistance nahoru, u vDistance doleva), popisek posunutý o along (mm) od středu. */
export interface LinearPlacement { readonly kind: 'linear'; readonly offset: number; readonly along: number }
/** Poloměr/průměr: popisek ve směru angle (rad, od osy x roviny) od středu, ve vzdálenosti distance (mm) od středu. */
export interface RadialPlacement { readonly kind: 'radial'; readonly angle: number; readonly distance: number }
/** Úhel: oblouk kóty o poloměru radius (mm) kolem průsečíku přímek, popisek v podílu t ∈ [0, 1] oblouku. */
export interface AngularPlacement { readonly kind: 'angular'; readonly radius: number; readonly t: number }
export type DimensionPlacement = LinearPlacement | RadialPlacement | AngularPlacement;
/** Kóta = vazba s hodnotou; `measure(data, c: DimensionConstraint)` měří všechny druhy. */
export type DimensionConstraint = Extract<SketchConstraint, { kind: DimensionKind }>;
export const DIMENSION_KINDS: readonly DimensionKind[];   // zmrazené, v pořadí typu výše
/** Kóta podle druhu, ne podle tvaru (jiná vazba s polem `value` kótou není); funguje i pro drafty. */
export function isDimension<C extends { readonly kind: string }>(c: C): c is Extract<C, { readonly kind: DimensionKind }>;
```

- **Významy:** `hDistance` = |b.x − a.x|, `vDistance` = |b.y − a.y|, `pointLineDistance` = vzdálenost bodu od přímky úsečky, `angle` = úhel mezi směry `p1→p2` úseček (směr obrácený příznakem `reverseA`/`reverseB`), `diameter` = 2 · poloměr. `value > 0` vždy; u `angle` `0 < value < π`. Úhel se ukládá v radiánech, panel a viewport ho ukazují ve stupních.
- **Kontrola dat:** `placement` je volitelný; když je, musí mít druh odpovídající kótě a konečná čísla, `radial.distance > 0`, `angular.radius > 0`, `0 ≤ t ≤ 1`. `pointLineDistance`: `point` je bod, `line` úsečka a bod není jejím koncem. `angle`: dvě různé úsečky. Druh polohy: `linear` u vzdáleností (i `pointLineDistance`), `radial` u `radius`/`diameter`, `angular` u `angle`; přebývající nebo chybějící pole polohy je chyba. `reverseA`/`reverseB` jsou buď nepřítomné, nebo `true` (jako `construction`); vlastnost přítomná s hodnotou `undefined` je chyba.
- **Mazání:** `removeItems` maže i nové kóty, které odkazují na smazanou entitu (`pointLineDistance` přes `point` i `line`, `angle` přes obě úsečky).
- **Měření úhlu:** `measure` vrací `atan2(|d_a × d_b|, d_a · d_b)` ∈ [0, π] pro směry `p1→p2` obrácené podle příznaků; `pointLineDistance` měří k nekonečné přímce úsečky.
- **Řešič:** `hDistance`/`vDistance` → `difference` souřadnic se znaménkem podle aktuální polohy (b vpravo/nahoře = +, při shodě +), `pointLineDistance` → `p2l_distance`, `angle` → `l2l_angle_pppp` s body v pořadí podle příznaků (obrácený příznak prohodí `p1`/`p2`); protože planegcs měří orientovaný úhel od první úsečky ke druhé, adaptér úsečky seřadí tak, aby aktuální orientovaný úhel byl kladný (při nulovém součinu a → b), a úhel se tak při řešení nepřeklopí do jiného kvadrantu, `diameter` → `circle_diameter`/`arc_diameter`. `placement` do řešiče nevstupuje a řešič ho vrací beze změny.
- **Výběr druhu** (čistá funkce `sketch/dimension-placement.ts`):

  ```ts
  export type DimensionTarget =
    | { readonly kind: 'points'; readonly a: SketchEntityId; readonly b: SketchEntityId }  // dva body nebo úsečka (její body)
    | { readonly kind: 'pointLine'; readonly point: SketchEntityId; readonly line: SketchEntityId }
    | { readonly kind: 'lines'; readonly a: SketchEntityId; readonly b: SketchEntityId }    // nerovnoběžné úsečky
    | { readonly kind: 'round'; readonly curve: SketchEntityId };
  export function dimensionTarget(selected: readonly SketchEntity[]): DimensionTarget | null;
  /** Druh, hodnota a poloha kóty pro kurzor v rovině skici. null = degenerované (nulová délka, rovnoběžné úsečky). */
  export function placeDimension(target: DimensionTarget, cursor: Vec2, data: SketchData): SketchConstraintDraft | null;
  /** Nová poloha existující kóty pro kurzor; druh ani hodnotu nemění. */
  export function movePlacement(c: DimensionConstraint, cursor: Vec2, data: SketchData): DimensionPlacement;
  /** Poloha, kterou kóta bez placement používá (dnešní výchozí z M19.2). */
  export function defaultPlacement(c: DimensionConstraint, data: SketchData): DimensionPlacement;
  ```

  - `points`: kurzor v pásu kolmém na úsečku AB (jeho průmět leží mezi A a B) → `distance` (zarovnaná); jinak, je-li |Δy kurzoru od středu| > |Δx| → `hDistance` (kurzor nad/pod), jinak `vDistance`. U vodorovné nebo svislé úsečky (do 1e-9) se zarovnaná nenabízí a osa, která by měřila nulu, ustoupí druhé (u svislé úsečky je všude kolem svislá vzdálenost; Pavel 2026-10-15, jako Fusion). Nulová měřená hodnota (splývající body) → `null`.
  - `round`: kurzor uvnitř kružnice → `radius`, vně → `diameter` (jako Fusion).
  - `lines`: kvadrant podle polohy kurzoru vůči průsečíku přímek → příznaky `reverseA`/`reverseB` a hodnota úhlu v tom kvadrantu.
  - `placement` u všech = poloha odvozená z kurzoru (offset a along, úhel a vzdálenost, poloměr a t).
  - `dimensionTarget`: 1 úsečka → `points(p1, p2)`; 2 body → `points` v pořadí výběru; bod + úsečka (v libovolném pořadí) → `pointLine`, je-li bod koncem úsečky → `null`; 2 úsečky → `lines` v pořadí výběru (rovnoběžné vrátí `lines` také, `placeDimension` pak `null`); 1 kružnice/oblouk → `round`; jinak `null`.
  - **Odvození polohy z kurzoru `c`** (stejné v `placeDimension` i `movePlacement`): lineární kóta má měřený směr `u` (jednotkový), normálu `n = (−u.y, u.x)` (vlevo od `u`) a střed `M`: `offset = (c − M)·n`, `along = (c − M)·u`. Pro `distance` je `u` směr A→B a `M` střed AB; pro `hDistance` `u = (1, 0)`, `n = (0, 1)`; pro `vDistance` `u = (0, 1)`, `n = (−1, 0)` (`M` střed AB); pro `pointLineDistance` je A pata kolmice z bodu na přímku, B bod. Nulová délka AB → `u = (1, 0)`. Radiální: `angle = atan2(c − střed)`, `distance = |c − střed|`. Úhlová: vrchol X = průsečík přímek, `w = c − X`; `placeDimension` rozloží `w = α·d_a + β·d_b` a nastaví `reverseA = α < 0`, `reverseB = β < 0` (`d` = směr `p1→p2`); `radius = |w|`, `t` = úhel od paprsku A (`±d_a` podle příznaku) k `w` ve směru k paprsku B, dělený hodnotou úhlu, oříznutý na [0, 1]. `c` ve vrcholu, ve středu kružnice nebo nulová hodnota → `placeDimension` vrátí `null`. `movePlacement` vrátí dosavadní polohu (`placement` nebo výchozí) jen pro `c` ve vrcholu nebo ve středu, pro rovnoběžné úsečky a pro `pointLineDistance` k úsečce nulové délky; lineární kóta s nulovou délkou AB (i bod na přímce) se dál posouvá s `u = (1, 0)`. Práh degenerace je všude 1e-9 (rovnoběžnost poměrně: `|d_a × d_b| ≤ 1e-9·|d_a|·|d_b|`).
  - **Výchozí poloha** (`defaultPlacement`; v mm, protože čistá funkce nezná zoom, proto úměrná velikosti geometrie místo pevných 24 px z M19.2): lineární `offset = ±0,2 · měřená hodnota`, `along = 0`, znaménko u `distance` tak, aby kóta byla na straně kladného y roviny (u svislé úsečky vlevo), u ostatních `+`; radiální `angle` = π/4 u kružnice, střed oblouku u oblouku, `distance = 1,25 · poloměr`; úhlová `radius = 0,5 · kratší z obou úseček` (u úsečky nulové délky 1 mm, aby uložená poloha prošla kontrolou dat), `t = 0,5`; `pointLineDistance` k úsečce nulové délky (hodnota NaN) má `offset = 0`.
- **Nástroj Kóta** (`sketcher`): klik na entitu nebo dvě entity (jako dnes) určí cíl; pak kóta **visí na myši** (náhled přes `SketchState.dimensions` s příznakem `preview: true`) a každý pohyb volá `placeDimension`. Klik ji zapíše a nastaví `editingDimension` (pole hodnoty dostane fokus). Esc náhled zruší. Druh se volí jen při vytváření.
  - **Průběh výběru** (jako Fusion): klik na úsečku nebo kružnici/oblouk → kóta hned visí na myši (cíl `points` / `round`); klik na bod → čeká na druhou entitu (bod → `points`, úsečka → `pointLine`). Visí-li kóta úsečky, klik na jinou úsečku změní cíl na `lines` (úhel) a klik na bod, který není jejím koncem, na `pointLine`; jakýkoli jiný klik kótu položí. U `round` a u cílů ze dvou entit položí kótu každý klik. Po kliku na bod: klik na entitu, která s ním netvoří cíl (konec téže úsečky, kružnice), začne vlastní cíl jako první klik; klik na týž bod nebo do prázdna bod zapomene. Klik, který na degenerovaném místě nic nezapíše, nechá kótu viset. `placeDimension` → `null` (degenerovaná poloha) náhled skryje a klik nic nezapíše. Kurzor se do roviny převádí jako u kreslicích nástrojů (`cursorAt`), bez přichycení k mřížce.
  - **Náhled:** `SketchSession.previewDimension(draft: SketchConstraintDraft | null): void` (jen pro nástroj, neprochází řešičem ani zápisem) – `SketchState.dimensions` pak obsahuje navíc pohled s `id` `'__preview'` (rezervovaná předpona `__` jako `__origin` a `__drag`; jediné id vazby značkované mimo `parse.ts`, nikdy se nezapíše), `preview: true`, `n: 0`, `selected: false`. Zápis kóty (už volání `addConstraint`, i když ji řešič pak odmítne) i deaktivace nástroje náhled zruší.
- **Přetažení:** popisek kóty v `ui` je tlačítko; tah (posun > `CLICK_TOLERANCE_PX`) volá `SketchSession.moveDimension(id, x, y)` s px plochy pohledu (session převede přes `screenToRay` do roviny a `movePlacement`) a `endMoveDimension()` zapíše `setParams` bez řešiče. Klik bez tahu vybírá jako dnes. Během tahu session drží novou polohu jen ve svém stavu (`SketchState.constraints` i `dimensions` ji ukazují), `endMoveDimension(): void` ji zapíše jedním `setParams` (běží-li zápis řešiče, zařadí se za něj jako `toggleConstruction`); bez pohybu nezapíše nic. `SketchSession` k tomu dostane z viewportu `screenToRay`.
- **Kresba:** `SketchDimensionView` dostane `kind: DimensionKind`, `placement` (vždy vyplněné, výchozí z `defaultPlacement`), světové body potřebné ke kresbě a `preview?: true`. Geometrii z `placement` počítá `sketcher` (zná rovinu a umí to testovat bez DOM), `ui` body jen promítne a dokreslí šipky a text:

  ```ts
  export type DimensionGeometry =
    /** Vynášecí čáry from→lineFrom a to→lineTo, kótovací čára lineFrom–lineTo; label = bod na kótovací čáře posunutý o along (leží-li mimo úsek, ui čáru k němu prodlouží). */
    | { readonly kind: 'linear'; readonly from: Vec3; readonly to: Vec3; readonly lineFrom: Vec3; readonly lineTo: Vec3; readonly label: Vec3 }
    /** near = bod na křivce ve směru angle; far = protilehlý bod (jen průměr, čára vede přes střed); label ve vzdálenosti distance od středu. */
    | { readonly kind: 'radial'; readonly center: Vec3; readonly near: Vec3; readonly far: Vec3 | null; readonly label: Vec3 }
    /** arc = body oblouku kóty (navzorkovaný, 33 bodů) od paprsku A k paprsku B; label na podílu t. */
    | { readonly kind: 'angular'; readonly vertex: Vec3; readonly arc: readonly Vec3[]; readonly label: Vec3 };
  ```

  `SketchDimensionView` = `{ id, kind, value, n, selected, preview?, placement, geometry: DimensionGeometry }` (pole `from`/`to` z M19.2 nahrazuje `geometry`). `dimensionLayout` v `ui` kreslí z `geometry` místo pevného `offsetPx`; úhel obloukem se šipkami, průměr `⌀…`, poloměr `R…`, úhel `…°`. Popisek leží středem na bodu `label` a čáry se kolem něj přeruší (`withLabelGap`: obdélník odhadnutý z délky textu, 7 px na znak + 4 px okraj, výška 16 px), aby číslo nekřížila kótovací čára (Pavel 2026-10-15 při ručním testu, jako mezera v kótě Fusionu).
- **Testy:** `parseSketchData` pro každý nový druh a `placement`; `measure` všech druhů; `dimensionTarget`; `placeDimension` (pás → zarovnaná, nad → vodorovná, vedle → svislá, uvnitř/vně kružnice, čtyři kvadranty úhlu, degenerované → `null`); `movePlacement` a `defaultPlacement`; adaptér planegcs (každý druh drží hodnotu, `placement` beze změny, úhel ve správném kvadrantu); session (`moveDimension` nezavolá řešič, zápis po `endMoveDimension`); `dimensionLayout` s `placement`; e2e (vytvoření vodorovné kóty myší, přetažení, uložení a načtení polohy, dokument bez `placement`).

## Spliny (M29)

Rozhodnuto v [[Q086 Spline přes body v řešiči|Q086]]: jen polynomiální B-spline (bez vah), dva druhy entit nad stejnou matematikou.

```ts
/** Spline přes řídicí body (NURBS bez vah). Konce křivky = první a poslední řídicí bod (clamped). */
export interface SketchBSpline {
  readonly kind: 'bspline'; readonly id: SketchEntityId;
  readonly degree: 1 | 2 | 3;                       // = min(3, poles.length − 1)
  readonly poles: readonly SketchEntityId[];        // body skici, ≥ 2, různé
  readonly knots: readonly number[];                // clamped, neklesající, délka poles + degree + 1, od 0 do 1
  readonly construction?: true;
}
/** Spline přes body: prochází fit body; řídicí body jsou skryté proměnné řešiče a jejich vyřešené souřadnice jsou v datech. */
export interface SketchFitSpline {
  readonly kind: 'fitSpline'; readonly id: SketchEntityId;
  readonly degree: 1 | 2 | 3;                       // = min(3, fit.length − 1)
  readonly fit: readonly SketchEntityId[];          // body skici, ≥ 2, různé
  readonly params: readonly number[];               // parametr každého fit bodu, rostoucí, první 0, poslední 1
  readonly poles: readonly Vec2[];                  // vyřešené řídicí body, délka = fit.length
  readonly knots: readonly number[];                // clamped, délka poles + degree + 1
  readonly construction?: true;
}
// Curve2 a ProfileCurve dostanou stejnou variantu:
| { readonly kind: 'bspline'; readonly degree: number; readonly poles: readonly Vec2[]; readonly knots: readonly number[]; readonly id?: string }
```

- **Vytvoření fit-splinu:** `params` z délky tětiv (normalizované), `knots` průměrováním (Piegl–Tiller, globální interpolace) a `poles` řešením lineární soustavy – čistá funkce `bspline.interpolate(points)` v `core`. Počet řídicích bodů = počet fit bodů, takže systém je **určený bez koncových podmínek**. Planegcs vazbu na druhou derivaci nemá, proto globální interpolace místo přirozených koncových podmínek z Q086; cíl rozhodnutí (spline vždy prochází fit body a „neplave“) zůstává.
- **Řešič** (upraveno podle [[Q087 Spline v řešiči a v jádře – zjištění z implementace|Q087]]): `bspline` se do planegcs **nepřidává** – jeho řídicí body jsou body skici a žádná vazba planegcs na spline neodkazuje, takže primitiv by na řešení neměl vliv. `fitSpline` → planegcs `bspline` s řídicími body jako vnitřními body (`<id>:pole<i>`, start z `poles` v datech) a `point_on_bspline` pro každý fit bod na pevném parametru z `params` (parametr jako číslo = pevný, nepřidá stupeň volnosti; id vazby `<id spline>:fit<i>`, převádí se zpět na id splinu). Wrapper planegcs ke splinu, na který odkazuje vazba, založí 4 nepoužité volné parametry (kopie začátku a konce, ne sdílené proměnné), proto adaptér od `dof` odečte 4 za každý takový spline (jedna funkce s komentářem; test hlídá, že planegcs se chová pořád stejně). `SolveResult.entities` vrací u `fitSpline` nové `poles`, ostatní pole beze změny. Vazby na spline: `coincident` s koncem (konec = bod skici), `tangent` úsečka–spline na konci → `point_on_line` (planegcs `point_on_line_pl`) druhého řídicího bodu (u posledního konce předposledního) na úsečce: u sevřeného splinu je tečna na začátku úměrná `P1 − P0` a úsečka prochází `P0` (sdílený bod). U `fitSpline` jde o skrytý řídicí bod. `tangent_at_bspline_knot` na krajním uzlu v planegcs nefunguje (Failed). Upřesněno při úkolu 4: sdílí-li úsečka body s oběma konci splinu, tečnost patří k začátku. **Interní vazby splinu v seznamech** (úkol 8, Pavel 2026-10-15): vazby `<id>:fit<i>` se z `conflicting` a `redundant` **vynechají** jako `__drag` – seznamy nesou jen vazby skici (typ `SketchConstraintId[]` platí, žádné přetypování). Stav `'conflict'` se ale určí ze surového seznamu planegcs, takže konflikt jen mezi interními vazbami (nastat by neměl) dá `'conflict'` s prázdným `conflicting`. Ostatní dvojice se splinem `constraintFor` nenabídne.
- **Kontrola dat:** odkazy na existující body, délky polí podle vzorců výše, `knots` clamped a neklesající v [0, 1], `params` rostoucí od 0 do 1, souřadnice konečné; `degree` musí odpovídat vzorci. Upřesněno při úkolu 2: `poles` (`bspline`) a `fit` (`fitSpline`) vedou na existující **body**, navzájem různé; *clamped* = prvních `degree + 1` uzlů je 0 a posledních `degree + 1` je 1, vnitřní uzly leží v (0, 1), neklesají a žádný se neopakuje víc než `degree`krát; `fitSpline.poles` má délku `fit.length` a konečné souřadnice. Chybí-li nebo přebývá vlastnost, je `construction` jiné než `true` nebo nesedí `degree`, je to `sketch.invalidEntity` jako u ostatních entit.
- **Vazby a výběr (`constraintFor`):** konce splinu jsou první a poslední bod (`poles` u `bspline`, `fit` u `fitSpline`). `tangent` = úsečka + spline (v libovolném pořadí) jen tehdy, když úsečka sdílí bod s koncem splinu (`p1` nebo `p2` je první nebo poslední bod splinu) – `constraintFor` to pozná z id bez dat. Ostatní vazby a kóty se splinem (`equal`, `parallel`, `radius`, `tangent` spline–kružnice…) → `null`; `dimensionFor` se splinem → `null`. `parseSketchData` u `tangent` se splinem ověří totéž (sdílený koncový bod), jinak `sketch.invalidConstraint`. `SketchCurve` zahrnuje oba druhy splinu, takže `toggleConstruction` je přepíná jako ostatní křivky.
- **`removeItems`:** smazání řídicího bodu nebo fit bodu smaže spline (jako smazání bodu úsečky); body používané jen smazaným splinem se smažou také.
- **Geometrie:** matematika B-spline je v `core` (`src/core/math/bspline.ts`, [[02-core#Matematika (hodnotové typy)]]), protože ji potřebuje i `FakeKernel` a `kernel` smí jen na `core` ([[Q087 Spline v řešiči a v jádře – zjištění z implementace|Q087]], Pavel 2026-10-15). Jako ostatní matematika v `core` je to jmenný prostor:

  ```ts
  export interface BSplineShape { readonly degree: number; readonly poles: readonly Vec2[]; readonly knots: readonly number[] }
  export const bspline = {
    /** Bod na křivce (de Boor); t se ořízne do [knots[degree], knots[poles.length]]. */
    evaluate(curve: BSplineShape, t: number): Vec2,
    /** order-tá derivace podle t (order 1 nebo 2; u degree < order nulový vektor). */
    derivative(curve: BSplineShape, t: number, order?: 1 | 2): Vec2,
    /** Body křivky od t = 0 do 1: adaptivní půlení, dokud odchylka středu úseku od tětivy > tolerance; oba konce přesně (= krajní řídicí body). */
    tessellate(curve: BSplineShape, tolerance: number): Vec2[],
    /** Globální interpolace (Piegl–Tiller 9.2.1): degree = min(3, n − 1), params z délky tětiv, knots průměrováním. */
    interpolate(points: readonly Vec2[]): { degree: 1 | 2 | 3; params: number[]; knots: number[]; poles: Vec2[] },
  };
  ```

  `BSplineShape` je strukturálně podmnožina varianty `Curve2` `bspline`, takže funkce berou přímo křivku. `bspline.interpolate` vyhodí `RangeError` pro méně než 2 body, nekonečnou souřadnici nebo dva po sobě jdoucí shodné body (nulová tětiva by dala neklesající parametry). Druhá derivace je pro znaménkovou křivost v oblastech. Tessellace půlí v intervalech mezi různými uzly (každý úsek polynomu zvlášť), aby nepřeskočila krátký oblouk; u stupně ≥ 2 každý interval rozpůlí aspoň dvakrát (úsek tvaru S má střed na tětivě) a nejvýš 16krát (nulová tolerance tak skončí). Stupeň 1 vrátí přesně řídicí body.
- **Oblasti:** spline je hrana mezi svými konci (uzavřený spline se shodnými konci je smyčka s jedním uzlem). Průsečíky a test „bod uvnitř“ se počítají nad tessellací s tolerancí `tol`, úhel tečny v uzlu z derivace na konci, znaménková křivost z první a druhé derivace, plocha z tessellace. Jména oblastí zůstávají z id křivek. Tolerance tessellace splinu pro oblasti (upřesněno při úkolu 3) je `SPLINE_TOLERANCE · max(1, největší |souřadnice|)`, `SPLINE_TOLERANCE = 1e-4` exportuje `sketch` a používá ji i kresba – s `tol` (1e-9) by tessellace měla desítky tisíc úseků; průsečík tessellace do `1e3 · tol` od sdíleného koncového uzlu se k uzlu přiřadí jako u ostatních křivek. Oblasti v `outer` a `holes` nesou přesnou křivku `bspline`, tessellace slouží jen k výpočtům. Upřesněno při úkolu 3: měřítko tolerance se bere jen ze souřadnic bodů skici (skryté `poles` fit-splinu ne, stejně jako u `tol`); spline, jehož všechny body tessellace leží do `tol` od prvního, se vynechá jako úsečka nulové délky; při nulové derivaci na konci se úhel tečny bere ze směru prvního (posledního) úseku tessellace a křivost je 0; polohrana proti směru splinu nese spline obrácený (`poles` pozpátku, uzly `1 − k` pozpátku – tatáž křivka). Spline, který kříží sám sebe, je `crossing` jako dvě křížící se křivky: nesousední úseky tessellace téhož splinu se nesmí protnout, kromě shodných konců uzavřeného splinu ([[Q087 Spline v řešiči a v jádře – zjištění z implementace|Q087]]).
- **Jádro:** `ProfileCurve` `bspline` → `kernel-occt` postaví `Geom2d_BSplineCurve` (nebo 3D `Geom_BSplineCurve` v rovině, podle toho, co build umí) a hranu; `validateFaceInput` ověří tvar a napojení konců (první a poslední řídicí bod). `FakeKernel` ji aproximuje tessellací (plocha, obálka). Role hrany `edge:<id>` a boční plochy `face:side:<id>` jako u ostatních křivek.
- **Kresba:** `SketchDrawingCurve` dostane variantu `{ kind: 'polyline'; id; points: readonly Vec2[]; style }`; `sketcher` spline tessellací převede na ni, `render` ji kreslí a pickuje jako řadu úseček s jedním id. Řídicí body `bspline` jsou body skici a kreslí se s tečkovanou řídicí lomenou čarou (styl `construction`); fit body jsou body skici, řídicí body `fitSpline` se nekreslí. Upřesněno při úkolu 6: tolerance tessellace pro kresbu je stejná jako pro oblasti (`1e-4 · max(1, největší |souřadnice| řídicích bodů splinu)`); řídicí lomená čára má id `__poles:<id splinu>` (vzor `'__origin'`: picking ji vrátí, ale entitu k ní skicář nenajde, takže se nic nevybere) a v kresbě je až za svým splinem, aby při shodné vzdálenosti vyhrál spline; kreslí se stylem `construction` (čárkovaně, jak ho `render` kreslí). Kresba skici z regenerace řídicí lomenou čáru nemá. **Picking lomené čáry** (úkol 8, Pavel 2026-10-15): skicář přeloží id `__poles:<id>` na id splinu – najetí na lomenou čáru i klik na ni najede a vybere spline (bez změny `render`).
- **Bod na splinu** (úkol 8, Pavel 2026-10-15): `pointOnCurve` smí mít jako `curve` i `bspline` a `fitSpline`. Bod nesmí být bodem splinu (`poles` u `bspline`, `fit` u `fitSpline`), jinak `sketch.invalidConstraint` / `constraintFor` → `null` (stejně jako definiční bod jiné křivky). `constraintFor('coincident', bod + spline)` → `pointOnCurve`. **Snapper** krok 4 (`onCurve`): průmět na spline = nejbližší bod tessellace splinu (tolerance `SPLINE_TOLERANCE` · měřítko, jako oblasti) – úsek tessellace jako úsečka. **Adaptér planegcs:** `pointOnCurve` na spline → `point_on_bspline` s **volným** parametrem (nová proměnná planegcs `<id vazby>:t`, počáteční hodnota = nejbližší z 16 vzorků v každém intervalu uzlů zpřesněný nejvýš 8 Newtonovými kroky na (C(t) − p) · C′(t) = 0, oříznutý do [0, 1]; při každém řešení znovu z aktuální polohy bodu, data parametr neukládají; `<id>:t` je parametr, ne vazba, do seznamů sporů se nedostane). Proměnná přidá 1 stupeň volnosti, vazba odebere 2, takže bod na splinu má jako bod na úsečce 1 stupeň volnosti. `bspline`, na který odkazuje `point_on_bspline`, se do planegcs přidá (řídicí body = body skici) a korekce `dof` −4 z [[Q087 Spline v řešiči a v jádře – zjištění z implementace|Q087]] platí i pro něj. Parametr se nesmí dostat mimo [0, 1] (jinak by bod „utekl“ za konec křivky): implementace ověří chování planegcs při tažení bodu za konec splinu; planegcs rozsah neomezuje (parametr při tažení uteče, bod pak leží na polynomiálním prodloužení), proto (Pavel 2026-10-16) **druhé řešení na konci**: vyjde-li po řešení parametr některého bodu na splinu mimo [0, 1], adaptér vyřeší soustavu znovu s pevným parametrem 0 nebo 1 pro všechny takové vazby najednou (nejvýš jedno druhé řešení, hranice ostrá) – bod se „přilepí“ ke konci splinu (jako v Onshape). `dof` se hlásí z prvního řešení; konflikt nebo selhání druhého řešení je výsledkem. Volný parametr: `push_sketch_param('<id>:t', t0, false)` a `pointparam` jako řetězec (primitiv `param` planegcs vždy fixuje). **Glyf:** `pointOnCurve` u bodu jako dřív.
- **Kotva glyfu splinu** (úkol 8): bod křivky v polovině rozsahu parametru (`t = 0,5`), `side` = normála tečny v něm otočená k +y roviny (jako u úsečky; nulová derivace → +y). Glyfy `tangent` úsečka–spline mají jeden glyf u úsečky a jeden u splinu.
- **Nástroje** (úkol 8, Pavel 2026-10-15): `sketch.spline` (*Spline přes řídicí body* / *Control point spline*) a `sketch.fitSpline` (*Spline přes body* / *Spline*) v `sketcher/sketch-tools/spline-tool.ts`, jeden nástroj parametrizovaný druhem, bez klávesové zkratky, v liště skicáře (skupina `draw`) jako rodina `spline` (`ToolDescriptor.family`, M27) za oblouky; ikony z Tabler webfontu jako ostatní nástroje: `vector-bezier` (řídicí body) a `vector-spline` (přes body). Enter jde přes `Tool.onKey` (lokální `isPlainEnter`, obdoba `isPlainEscape`); bez umístěných bodů Enter i Esc vrací `false` (Esc pak přepne na výběrový nástroj jako u ostatních).
  - Každý klik umístí bod přes snapper (`snapAt`, `placePoint`): přichycení na existující bod použije jeho id, nový bod dostane `inferred` vazby (`fix`, `pointOnCurve`, `midpoint`, `hAlign`/`vAlign`); `inferLine`/`inferRadius` se nepoužijí. Rozpracované body nástroj drží jako `pending` (snapper je vidí jako data, `exclude` jako u úsečky).
  - Klik na **vlastní poslední bod** (stejné id nebo do tolerance snapperu – náhrada dvojkliku, port nemá dvojklik) nebo **Enter** spline ukončí a zapíše jedním `addGeometry`: body, vazby z `inferred` (automatické) a entitu. Klik na **vlastní první bod** při aspoň 3 bodech spline **uzavře**: poslední bod vznikne nový na místě prvního s vazbou `coincident` k němu (povinná, `required`) a spline se zapíše. Klik na jiný vlastní bod se ignoruje (body splinu musí být různé). Méně než 2 body při ukončení → nic se nezapíše.
  - `bspline`: `degree = min(3, n − 1)`, uzly **sevřené rovnoměrné** (vnitřní uzly `j / (n − degree)`, `j = 1 … n − degree − 1`). `fitSpline`: `bspline.interpolate` z poloh bodů (`degree`, `params`, `knots`, `poles`); klik do tolerance od posledního bodu spline ukončí (shodné body tak nevzniknou); uzavření `fitSpline`, jehož poslední bod už leží na místě prvního, se ignoruje (`interpolate` by vyhodilo výjimku).
  - **Esc** zruší celý rozpracovaný spline (nic se nezapíše), nástroj zůstane aktivní; druhé Esc ho jako u ostatních nástrojů ukončí. Ctrl/Cmd vypne inference jako u ostatních nástrojů.
  - **Náhled** při pohybu (overlay nástroje, `previewPairs`): křivka přes umístěné body a kurzor (tessellace s `SPLINE_TOLERANCE`), u `bspline` i řídicí lomená čára; náhled vazeb (`previewInference`) jako u úsečky.
  - Tažení bodů splinu jako u ostatních entit (výběrový nástroj, řešič).
- **Testy:** `core/math/bspline.ts` (hodnoty a derivace proti ručně spočítaným, tessellace v toleranci), `bspline.interpolate` (prochází body, 2–3 body → nižší stupeň), `parseSketchData` všech pravidel, `removeItems`, `computeRegions` (obdélník s jednou stranou spline, uzavřený spline, spline křížící úsečku → `crossing`, díra ze splinu), adaptér planegcs (tažený fit bod → spline jím prochází, `dof` fit-splinu = 2 · fit bodů, tečná úsečka na konci), `validateFaceInput` a `FakeKernel`, `kernel-occt` (plocha profilu se splinem ≈ plocha z tessellace), kresba `polyline`, integrační test (skica se splinem → Vysunutí, jméno `face:side:<id>`), e2e po nástrojích.

## Rozšíření skicáře II (M30–M37)

Naplánováno 2026-10-16. Sdílené kontrakty, které musí znát víc stop, jsou zafixované níže předem (sekce *Sdílené kontrakty série II* a *Geometrie skici v jádře (M30)*); zbytek kontraktu dopíše každá stopa do své sekce při startu milníku ([[Roadmapa#Rozšíření skicáře II (M30–M37)]]).

| Milník | Co přibude | Dopad na data | Otázka |
|---|---|---|---|
| [[M30-geometrie-skici-v-occt\|M30]] | oblasti, křížení a průsečíky v jádře místo `sketch/regions.ts` ([[0028-geometrie-skici-v-jadre\|ADR 0028]]) | žádný; nový port jádra | [[Q092 Hranice geometrie skici v TS a v OCCT\|Q092]] |
| [[M31-nove-kreslici-nastroje\|M31]] | obdélník středem a třemi body, bod, drážky (3 druhy), režim konstrukce, nekonečná přímka | nová entita přímky | – |
| [[M32-ciselny-vstup\|M32]] | délka, úhel a souřadnice z klávesnice při kreslení | žádný (vznikají kóty) | [[Q090 Číselný vstup při kreslení\|Q090]] |
| [[M33-trim-extend-split\|M33]] | ořezání, prodloužení, dělení | nové entity z částí křivek | – |
| [[M34-zaobleni-a-srazeni-ve-skice\|M34]] | zaoblení a sražení mezi dvěma křivkami | žádný (oblouk/úsečka + vazby) | – |
| [[M35-offset\|M35]] | ekvidistanta křivky a řetězce | možná vazba odsazení | – |
| [[M36-zrcadleni-a-pole\|M36]] | parametrické zrcadlení, lineární a kruhové pole, vynesené kóty | nové entity, vazba symetrie | [[Q089 Parametrické zrcadlení a pole ve skice\|Q089]] |
| [[M37-text-ve-skice\|M37]] | text jako obrysy písmen (opentype.js, [[0029-text-ve-skice-pres-opentype\|ADR 0029]]) | nová entita text | [[Q091 Fonty pro text ve skice\|Q091]] |

### Sdílené kontrakty série II

Zafixováno 2026-10-16 před spuštěním stop. Pravidlo jako v první sérii: stopa přidává jen **své** členy unií a své větve vyčerpávajících `switch`; cizí členy nepřidává ani „pro jistotu“. Sémantické konflikty po sloučení najde typecheck.

**Kdo co přidává do sdílených typů a souborů:**

| Stopa | `SketchEntity` / `SketchCurve` | `SketchConstraint` | `Curve2` / `ProfileCurve` | Ostatní sdílené |
|---|---|---|---|---|
| A (M30, M33–M35) | – | případná vazba odsazení (M35, `kind: 'offset'`) | – (beze změny) | port jádra `profileRegions`, `SketchArtifact.outlines`, `regionCurves`, port `SketchGeometry`; průsečíky a offset v M33/M35 |
| B (M31, M32) | `SketchXLine` (`kind: 'xline'`) | – | – | `SketchState.constructionMode`; nástroje a akce níže |
| C (M36, M37) | entity `mirror`, `linearPattern`, `circularPattern` (recept, kopie odvozené – [[Q089 Parametrické zrcadlení a pole ve skice\|Q089]]) a `text` ([[Q091 Fonty pro text ve skice\|Q091]]); **nejsou** v `SketchCurve` | `symmetric` | – (text a kopie jsou `line`/`arc`/`circle`/`bspline` s odvozeným id) | větve `regionCurves` pro kopie a text |

Druhy `xline`, `mirror`, `linearPattern`, `circularPattern`, `text`, `symmetric` a `offset` jsou tím rezervované; jiná stopa je nepoužije pro nic jiného. Entity stopy C jsou členy `SketchEntity`, ale ne `SketchCurve` (nejsou to křivky, nesou recept); funkce nad `SketchCurve` se jich proto netýkají a stopa C doplní jen `switch` nad `SketchEntity`.

#### Nekonečná přímka (M31, stopa B)

```ts
/** Konstrukční přímka bez konců přes dva body skici (Onshape Construction line, SolidWorks Centerline nekonečná). */
export interface SketchXLine {
  readonly kind: 'xline'; readonly id: SketchEntityId;
  readonly p1: SketchEntityId; readonly p2: SketchEntityId;   // dva různé body, určují polohu a směr
  readonly construction: true;                               // povinně: přímka nikdy neohraničuje oblast
}
export type SketchCurve = SketchLine | SketchCircle | SketchArc | SketchBSpline | SketchFitSpline | SketchXLine;
```

- `construction: true` je **povinné** (ne volitelné), takže všechny dnešní filtry `c.construction === true` přímku z oblastí a z builderu vyřadí bez další větve. `toggleConstruction` přímku přeskočí. `parseSketchData`: chybějící nebo jiné `construction` → `sketch.invalidEntity`.
- `curve2(xline)` vrátí `line` od `m − XLINE_EXTENT · d̂` do `m + XLINE_EXTENT · d̂` (`m` střed `p1p2`, `d̂` jednotkový směr, `XLINE_EXTENT = 1e5` mm, export ze `sketch`). Kresba, picking a snapper tak přímku vidí jako dlouhou úsečku bez zásahu do `render`. Snapper nepřichytí ke „koncům“ ani ke středu té úsečky – jen k `p1`, `p2` a k přímce (`onCurve`).
- Vazby: kde vazba bere úsečku jako **přímku** (`horizontal`, `vertical`, `parallel`, `perpendicular`, `angle`, `pointLineDistance`, `pointOnCurve`, `tangent` přímka–kružnice/oblouk, osa `symmetric`), bere i `xline`. Kde jde o **úsečku s délkou** (`midpoint`, `equal`, kóta délky z `dimensionFor`), `xline` ne (`constraintFor`/`dimensionFor` → `null`, parse → `sketch.invalidConstraint`). Planegcs: přímka jako `line` přes `p1`, `p2` (vazby na úsečce už dnes pracují s nekonečnou přímkou).
- `removeItems`: smazání `p1` nebo `p2` smaže přímku, jako u úsečky.

#### Vazba symetrie (M36, stopa C)

```ts
/** Body a, b souměrné podle osy (úsečka nebo xline): střed ab leží na ose a ab je na ni kolmá. */
| { readonly kind: 'symmetric'; readonly id: SketchConstraintId; readonly a: SketchEntityId; readonly b: SketchEntityId; readonly axis: SketchEntityId }
```

- `a !== b`, oba body; `axis` úsečka nebo `xline`; žádný z bodů není bodem osy. Planegcs: `symmetric_ppl`. `GEOMETRIC_CONSTRAINT_KINDS` ji přidá **před `fix`** (na konec geometrických vazeb, `fix` zůstane poslední) – pořadí akcí v liště upraví stopa C.
- Stopa B ji **nepoužívá**: obdélník středem drží střed vazbou `midpoint` na konstrukční úhlopříčce.

#### Křivky pro oblasti a odvozená id (M30 zavede, stopa C rozšíří)

```ts
// sketch/geometry.ts (M30)
/** Křivky, které ohraničují oblasti: nekonstrukční křivky skici jako Curve2 s id; M36/M37 přidají kopie polí a obrysy textu. */
export function regionCurves(data: SketchData): readonly Curve2[];
```

- Builder skici volá `regionCurves` a výsledek pošle jádru (`profileRegions`). Je to **jediné místo**, kde se rozhoduje, co ohraničuje oblasti; stopa C sem přidá své větve, nikam jinam.
- **Odvozené id** (kopie z pole, písmeno textu) má tvar `<id entity>:<přípona>`; přípona neobsahuje `,` ani `:` navíc a je stabilní, dokud se nezmění parametr, ze kterého vznikla. Kopie: `<id entity>:<index>.<id zdroje>` (index `i`, u mřížky `i-j`; [[Q089 Parametrické zrcadlení a pole ve skice|Q089]]); písmena textu určí M37. Id z generátoru jsou base62 ([[Q002 Formát ID|Q002]]), dvojtečku ani čárku neobsahují, takže odvozené id se s id entity nesrazí a jméno oblasti (id spojená `,`) zůstane jednoznačné. Jádro bere id jako neprůhledný řetězec; role `edge:<id>` a `face:side:<id>` fungují beze změny.
- Výběr a picking odvozené křivky: kresba ji nese s odvozeným id; skicář ho přeloží na id zdrojové entity (vzor `__poles:` z M29). Detail rozhodne stopa C.

#### Id nástrojů, akcí a rodin

Aby se stopy nesrazily v `sketch-tools.ts`, `constants.ts` a i18n, jsou id rozdělená předem (popisky i18n `tool.<id bez sketch.>`, česky / anglicky dopíše stopa):

| Stopa | Nástroje (rodina) | Akce |
|---|---|---|
| B | `sketch.rectangle` (stávající, rohy) + `sketch.rectangleCenter`, `sketch.rectangle3p` (rodina `rectangle`); `sketch.line` + `sketch.xline` (rodina `line`); `sketch.point`; `sketch.slot`, `sketch.slotOverall`, `sketch.slotArc` (rodina `slot`) | `sketch.constructionMode` (přepínač, klávesa `Q`) |
| A | `sketch.trim`, `sketch.extend`, `sketch.split` (rodina `trim`); `sketch.fillet`, `sketch.chamfer` (rodina `fillet`); `sketch.offset` | – |
| C | `sketch.mirror`; `sketch.linearPattern`, `sketch.circularPattern` (rodina `pattern`); `sketch.text` | `sketch.constraint.symmetric` (z `GEOMETRIC_CONSTRAINT_KINDS`) |

Skupiny lišty: kreslení `draw`, úpravy (trim, fillet, offset, mirror, pole) nová skupina `modify` – zavede ji ta stopa, která se do `main` sloučí první, druhá ji jen použije. Klávesové zkratky: B `Q` (režim konstrukce), `P` (bod); A `T` (trim); ostatní bez zkratky, dokud se nedohodne.

## Geometrie skici v jádře (M30)

Rozhodnuto v [[0028-geometrie-skici-v-jadre|ADR 0028]] a [[Q092 Hranice geometrie skici v TS a v OCCT|Q092]]. **Chování se nemění:** stejné oblasti, stejná jména, křížení = žádné oblasti (oblasti z křížících se křivek: [[Q093 Oblasti z křížících se křivek|Q093]]). Mění se jen to, **kdo** je počítá.

```ts
// kernel (port, spec 06 „Stav po M30“)
SketchOps.profileRegions(p: { readonly curves: readonly ProfileCurve[] }): Promise<ProfileRegions>;

// regen/state.ts
export interface SketchArtifact {
  …                                                    // beze změny
  readonly regions: ReadonlyMap<string, ShapeHandle>;  // beze změny: jméno oblasti → plocha
  /** M30: obrysy oblastí z jádra ve stejném pořadí jako regions; pro kresbu a picking oblastí. */
  readonly outlines: readonly ProfileRegion[];
}

// sketch/geometry.ts – typ zůstává, přesouvá se sem z regions.ts (strukturálně = ProfileRegion)
export interface SketchRegion { readonly name: string; readonly outer: readonly Curve2[]; readonly holes: readonly (readonly Curve2[])[]; readonly area: number }
export function regionCurves(data: SketchData): readonly Curve2[];   // viz výše

// sketcher/sketch-drawing.ts
export function artifactDrawing(plane: Plane, entities: readonly SketchEntity[], regions: readonly SketchRegion[]): SketchDrawing;

// sketch/geometry-port.ts – port pro skicář (Q092 bod 3); v M30 bez metod, M33 a M35 přidají průsečíky a offset
export interface SketchGeometry {}
```

- **Builder skici:** `regionCurves(data)` → `kernel.profileRegions({ curves })` → `crossing` → `ctx.warn` jako dnes → `makeFace` pro každou oblast v pořadí → artefakt s `regions` a `outlines`. Regenerace tak volá jádro o jednou víc na skicu; plánovač a cache se nemění.
- **Kresba skic z regenerace:** `app` (`regen-pipeline.ts`) předá `artifact.outlines` do `artifactDrawing`; `sketcher` oblasti nepočítá. Kresba editované skici oblasti nemá (beze změny).
- **`sketch/regions.ts`** se přesune do `kernel` jako implementace `profileRegions` ve `FakeKernel` (soubor `kernel/fake-regions.ts`, matematika splinu z `core`). `sketch` přestane exportovat `computeRegions` a `RegionsResult`; `SPLINE_TOLERANCE` zůstane (kresba), fake má vlastní konstantu se stejnou hodnotou. Testy `test/unit/sketch/regions.test.ts` se přesunou do kontraktové sady jádra (`describeGeometryKernelContract`), takže stejné případy běží proti fake i OCCT.
- **`SketchGeometry`** je v `sketch` (prstenec 1, jen typ), implementuje ho `app` nad klientem jádra a skicář ho dostane v závislostech `SketchSession` jako `ConstraintSolver`. V M30 vznikne jen prázdné rozhraní a jeho předání, aby stopa A v M33 nemusela měnit kompoziční kořen; pravidla závislostí se nemění.
- Postup výpočtu v sekci *Oblasti (profily)* výše platí dál jako **kontrakt výsledku** (co je oblast, díra, jméno, křížení, pořadí); OCCT ho smí dosáhnout jinou cestou (dělení hran `BOPAlgo`, stěny z `BRepBuilderAPI`), tolerance jsou OCCT.


## Zrcadlení a pole (M36)

Rozhodnuto v [[Q089 Parametrické zrcadlení a pole ve skice|Q089]]: entita je **recept** (zdroje + parametry), kopie se odvozují z vyřešeného originálu a do řešiče nevstupují; vazby a kóty na kopie nejdou. Směr lineárního pole je **úhel** (Pavel 2026-10-16, jako manipulátor v Onshape): pole nezávisí na jiné entitě a úhel je další vynesená kóta. Verze schématu skici zůstává 1 (nové druhy jen přibývají).

```ts
// sketch/model.ts – členy SketchEntity, ne SketchCurve
/** Zrcadlení zdrojů podle osy (úsečka; po sloučení M31 i xline). Jedna kopie s indexem 1. */
export interface SketchMirror {
  readonly kind: 'mirror'; readonly id: SketchEntityId;
  readonly sources: readonly SketchEntityId[];
  readonly axis: SketchEntityId;
}
/** Jeden směr lineárního pole: count ≥ 2 instancí (včetně originálu) po spacing (mm) ve směru angle. */
export interface PatternDirection {
  readonly angle: number;     // rad od osy x roviny skici, libovolné konečné číslo
  readonly count: number;     // celé číslo, 2 ≤ count ≤ MAX_PATTERN_COUNT
  readonly spacing: number;   // mm, > 0, vzdálenost sousedních instancí
}
/** Lineární pole: směr 1 povinný, směr 2 volitelný (mřížka, jako Onshape). */
export interface SketchLinearPattern {
  readonly kind: 'linearPattern'; readonly id: SketchEntityId;
  readonly sources: readonly SketchEntityId[];
  readonly direction1: PatternDirection;
  readonly direction2?: PatternDirection;
}
/** Kruhové pole kolem bodu skici: count instancí (včetně originálu) v celkovém úhlu angle. */
export interface SketchCircularPattern {
  readonly kind: 'circularPattern'; readonly id: SketchEntityId;
  readonly sources: readonly SketchEntityId[];
  readonly center: SketchEntityId;   // bod skici
  readonly count: number;            // celé číslo, 2 ≤ count ≤ MAX_PATTERN_COUNT
  readonly angle: number;            // rad, 0 < |angle| ≤ 2π; kladný = proti směru hodinových ručiček
}
export type SketchPattern = SketchMirror | SketchLinearPattern | SketchCircularPattern;
export type SketchEntity = SketchPoint | SketchCurve | SketchPattern;
export const MAX_PATTERN_COUNT = 100;
export function isPattern(e: SketchEntity): e is SketchPattern;

// sketch/patterns.ts (nový)
/** Kopie všech polí skici jako běžné entity (body a křivky) s odvozenými id; originál (index 0) se nekopíruje. */
export function patternCopies(data: SketchData): readonly (SketchPoint | SketchCurve)[];
/** Id entity pole z odvozeného id kopie ('<pole>:<přípona>'), jinak null. */
export function patternOfCopy(id: string): SketchEntityId | null;
```

- **Zdroje:** neprázdné, bez duplicit, každý je bod nebo křivka skici (ne pole, ne text); u zrcadlení zdrojem není osa, u kruhového pole zdrojem není střed. Jeden zdroj smí být ve více polích. Id pole a id zdrojů nesmí obsahovat `:` ani `,` (odvozené id by nebylo jednoznačné; id z generátoru je base62).
- **Kopie** (`patternCopies`, čistá funkce nad vyřešenými daty): pro každou instanci kromě originálu se zkopíruje každý zdroj **i jeho definiční body** (`curvePoints`; u `fitSpline` body `fit`). Kopie bodu má id `<pole>:<index>.<id bodu>`, kopie křivky `<pole>:<index>.<id křivky>` a odkazuje na odvozená id svých bodů; dvě zdrojové křivky se společným bodem mají tedy v kopii také společný bod (oblasti z kopií zůstanou uzavřené). Kopie křivky přebírá `construction` zdroje. Pořadí: pole v pořadí entit, instance vzestupně, zdroje v pořadí `sources`, body před křivkou; každé id jen jednou.
  - **Index:** zrcadlení `1`; lineární pole s jedním směrem `i` (1 … count−1); se dvěma směry `i-j` (`i` směr 1, `j` směr 2, všechny dvojice kromě `0-0`); kruhové pole `k` (1 … count−1). Přidání směru 2 tedy id změní (`1` → `1-0`), to je změna parametru.
  - **Transformace:** lineární posun `i·s₁·(cos α₁, sin α₁) + j·s₂·(cos α₂, sin α₂)`; kruhové otočení kolem středu o `k·krok`, kde `krok = angle / count` pro plný kruh (`| |angle| − 2π | ≤ 1e-9`) a `angle / (count − 1)` jinak (jako Fusion); zrcadlení podle přímky osy.
  - **Zrcadlení obrací orientaci:** zrcadlený oblouk má prohozené `start` a `end` (oblouk zůstane proti směru hodinových ručiček); kružnice jen střed; spline transformuje body (`bspline` póly jako body, `fitSpline` body `fit` a uložené `poles`), uzly a parametry beze změny.
  - **Stabilita id:** změna rozteče, úhlu nebo zdrojové geometrie id nemění; snížení počtu odebere jen instance s nejvyšším indexem. Odebrání zdroje odebere jen jeho kopie.
- **Kontrola dat** (`sketch.invalidEntity` u pole): tvar a pole jako u ostatních entit; `sources` podle pravidel výše; `axis` vede na úsečku (po M31 i `xline`); `center` na bod; `count` celé číslo v rozsahu; `spacing > 0` konečné; `angle` konečné, u kruhového `0 < |angle| ≤ 2π` (+1e-9); `direction2` volitelné, ale když je, platné. Vazby na entitu pole nesmějí odkazovat (`sketch.invalidConstraint`).
- **Mazání** (`removeItems`): (2a) smazání zdroje ho vyřadí ze `sources` všech polí, pole s prázdnými zdroji se smaže; (2b) smazání osy nebo středu smaže pole; smazání pole zdroje ani osu nemaže. V kroku (3) se bod, který používá zbylé pole jako `center`, počítá jako použitý. Kaskáda běží do ustálení (smazaná křivka → vyřazený zdroj → smazané pole).
- **Pomůcky editace:** `constraintFor` a `dimensionFor` s polem ve výběru → `null`; `toggleConstruction` pole přeskočí; `constraintFor('symmetric', [a, b, osa])` – dva body a úsečka (po M31 i xline) v tomto pořadí, body nejsou body osy.
- **Řešič:** entity polí do řešiče nevstupují (adaptér je přeskočí); osa a střed jsou běžné entity. Vazba `symmetric` → `symmetric_ppl` (sekce *Vazba symetrie* výše).
- **Kresba, výběr, snapper:** kresba editované i regenerované skici přidá `patternCopies(data)` stylem zdroje (konstrukční čárkovaně), kopie bodů jako body. Najetí a klik na kopii se přeloží `patternOfCopy` na id pole (vzor `__poles:` z M29), takže klik na kopii vybere celé pole a Delete ho smaže. Tah za kopii nic nepohne. Snapper bere kopie jako geometrii bez identity: přichytí se polohou (konec, střed, na křivce), ale nevznikne automatická vazba a bod se nesloučí s kopií. Glyfy vazeb kopie nemají.
- **Vynesené kóty pole** (vzor *Kóty (M28)*): u **vybraného** pole a během nástroje ukazuje viewport popisky parametrů: u lineárního pole pro každý směr počet `n×` u poslední instance, rozteč `… mm` mezi originálem a první instancí a úhel `…°` u originálu; u kruhového počet `n×` a celkový úhel `…°` na oblouku kolem středu; zrcadlení popisky nemá. Kotva = střed obálky definičních bodů zdrojů. Klik na popisek otevře pole hodnoty a potvrzení zapíše nový parametr jedním `setParams` (bez řešiče – pole do něj nevstupuje); neplatná hodnota (počet mimo rozsah, rozteč ≤ 0) se nezapíše. Přesný tvar pohledu (`SketchState`) a API session dopíše úkol 4.
- **Oblasti** (úkol 5, po sloučení M30): `regionCurves` přidá nekonstrukční kopie křivek z `patternCopies` jako `Curve2` s odvozeným id; jména ploch pak `face:side:<pole>:<index>.<zdroj>`.


## Testy

- `sketch`: `parseSketchData` pro každé pravidlo (platná data, každý druh chyby s `index`); `constraintFor` a `dimensionFor` pro platné i neplatné výběry; `measure`; `removeItems` (kaskáda bod → křivky → osiřelé body → vazby); `toggleConstruction`; `computeRegions`: obdélník (1 oblast, jméno z id 4 úseček, plocha), dva obdélníky vedle sebe se sdílenou hranou (2 oblasti), obdélník s kružnicí uvnitř (díra, 2 oblasti), kružnice v kružnici v kružnici, drážka z úseček a tečných oblouků (řazení při shodě úhlu), otevřená polyline (0), polyline s „ocáskem“ (prořezání), konstrukční úsečka uvnitř obdélníku (ignorována), křížící se úsečky (`crossing`), body spojené `coincident` (splynutí uzlů), stabilita jména po změně souřadnic a pořadí entit; `FakeSolver`.
- `solver-planegcs` (Node, skutečný planegcs): obdélník bez kót `dof` 4 → se dvěma kótami 2 → s `fix` 0; změna kóty posune body; konflikt (třetí kóta úhlopříčky, kóta mezi dvěma fixovanými body) → `'conflict'` s id vazby; dvakrát `horizontal` → `'ok'` s `redundant`; tažení bodu u `dof > 0` (bod sleduje cíl) a u `dof 0` (nic se nehne, `'ok'`); kružnice s poloměrem; oblouk tečný k úsečce; `dof` s tažením = bez tažení; nic na konzoli; OOM (≥ 1000 obdélníků) → `'failed'` a další malé řešení projde; worker přes `MessageChannel`.
- `features/sketch`: schéma (společné testy pluginu), builder s `FakeKernel` (jedna oblast → `makeFace` jednou, artefakt s rovinou, `crossing` → varování a žádné plochy, neznámá rovina → `UNRESOLVED_REFERENCE`).
- `interaction`: `SketchEditor`/`SketchSession` s `FakeSolver` a `FakeViewport` (vstup, kresba, výběr, vazby, kóty, odmítnutí, souběh tažení, Hotovo = jeden záznam, Zrušit = nic), nástroje skicáře.
- Integrační `tests/sketch-scenario.test.ts` se skutečným řešičem v Node a e2e `e2e/m12.spec.ts` s OCCT ([[M12-skicar#Implementační plán]]).

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
