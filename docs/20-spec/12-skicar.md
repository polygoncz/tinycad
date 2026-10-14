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
tags:
  - spec
created: 2026-10-12
updated: 2026-10-14
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
export function curve2(curve: SketchCurve, points: ReadonlyMap<SketchEntityId, SketchPoint>): Curve2;   // arc → ccw: true

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
```

- `constraintFor`: `horizontal`/`vertical` – právě 1 úsečka; `coincident` – právě 2 body; `fix` – právě 1 bod; `parallel`/`perpendicular` – právě 2 úsečky; `equal` – 2 úsečky nebo 2 z {kružnice, oblouk}; `tangent` – úsečka + kružnice/oblouk (v libovolném pořadí) nebo 2 z {kružnice, oblouk}. Jinak `null`. `a`, `b` v pořadí výběru.
- `removeItems` – kaskáda: (1) smaže vybrané vazby; (2) smaže vybrané entity, s bodem i křivky, které ho používají; (3) bod, který používala smazaná křivka a žádná zbylá křivka ho nepoužívá, se smaže také; (4) smažou se vazby, které odkazují na smazanou entitu.

## Featura skici (`features/sketch`)

```ts
export interface SketchParams {
  readonly plane: readonly PlaneRef[];               // planes, min 1, max 1; výchozí [{ kind: 'plane', plane: ORIGIN_PLANE_IDS.xy }]
  readonly entities: readonly SketchEntity[];        // data, výchozí []
  readonly constraints: readonly SketchConstraint[]; // data, výchozí []
}
export const sketchPlugin: FeaturePlugin<SketchParams>;
```

- Schéma `type: SKETCH_FEATURE_TYPE`, `version: 1`, `label: 'sketch.label'`, `icon: 'pencil'`; parametry v pořadí `plane` (`{ kind: 'planes', label: 'sketch.plane', min: 1, max: 1 }`), `entities` a `constraints` (`{ kind: 'data', label: … }`). `validate` = `validateAgainstSchema` a, když jsou `entities` i `constraints` přítomné, `parseSketchData` převedené na `ParamIssue { param: path, code, params: { index } }`.
- Plugin **nemá nástroje** ani operace: vstup do skicáře je vestavěný nástroj `sketch` v `interaction` ([[0017-modul-sketch-a-skicar|ADR 0017]]) a editace jde přes `feature.setParams` ([[Q074 Operace skicáře v logu|Q074]]).
- **Builder:** (1) `ctx.resolvePlanes(params.plane)`, chyba → `unresolvedReference('plane', e)`; (2) `parseSketchData` (parametry jsou ověřené, `err` je chyba programu → výjimka); (3) `computeRegions(data)`; `crossing` → `ctx.warn('Sketch curves cross each other; no regions')`; (4) pro každou oblast v pořadí `kernel.makeFace({ plane, outer, holes })`; (5) nový artefakt `SketchArtifact { kind: 'sketch', id: sketchId(feature.id), owner: feature.id, plane, entities: data.entities, regions }` (mapa jméno → handle v pořadí oblastí), zmrazený, do nové mapy artefaktů. Chyba jádra proletí (`KERNEL`). Skica bez oblastí je platná (artefakt s prázdnou mapou).

## Roviny a počátek

Počáteční roviny jsou [[Artefakt|artefakty]] vyhrazeného vlastníka `origin` seedované do `EMPTY_STATE` ([[0015-artefakty-a-identita-telesa|ADR 0015]]). `SketchParams.plane` je proto obyčejná reference `PlaneRef`, ne výčet `'XY' | 'XZ' | 'YZ'`; skica na ploše (M14) přidá referenci na rovinnou plochu.

| Id | Jméno (klíč) | `origin` | `xDir` | `normal` | Pohled kolmo |
|---|---|---|---|---|---|
| `origin/plane:xy` | `origin.plane.xy` („Horní“) | 0 | +X | +Z | `top` |
| `origin/plane:xz` | `origin.plane.xz` („Přední“) | 0 | +X | −Y | `front` |
| `origin/plane:yz` | `origin.plane.yz` („Pravá“) | 0 | +Y | +X | `right` |

Osa y roviny = `normal × xDir` vyjde u všech tří +Y, +Z, +Z – skica na přední a pravé rovině má „nahoru“ osu Z jako v Onshape. Osy počátku (`origin/axis:z`) přibudou s Revolve v M13.

## Oblasti (profily)

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

## Režim skicáře (interaction)

Kontrakt v [[10-interakce#Skicář]]. Shrnutí chování:

- **Vstup:** nástroj `sketch` (lišta *Skica*, `Shift+S`) vytvoří skicu na rovině vybrané v Prohlížeči (položka výběru `plane`), jinak na `origin/plane:xy`; dvojklik na skicu v Timeline nebo v Prohlížeči ji otevře k úpravě. Aplikace přejde do režimu `'sketch'`: lišta ukáže nástroje skicáře, kamera se natočí kolmo na rovinu (`setViewDirection(plane.normal)`), dialog featury se nekreslí, místo něj panel skici.
- **Nástroje:** výběr a tažení bodů (`sketch.select`, výchozí v režimu skici), úsečka – polyline (`L`), obdélník (`R`), kružnice střed + bod (`C`), oblouk střed + začátek + konec (`A`), kóta (`D`).
- **Automatické vazby:** snap na existující bod (picking v okruhu 6 px, body mají přednost) použije jeho id; snap na počátek roviny vytvoří bod `[0, 0]` s vazbou `fix`; úsečka, která svírá s osou x nebo y roviny úhel do 3°, dostane `horizontal`/`vertical`; obdélník má vždy dvě `horizontal` a dvě `vertical`.
- **Vazby** jsou akce nad výběrem (lišta, zkratky `H`, `V`, `I`): `constraintFor(kind, výběr)`; konfliktní nebo redundantní vazba se nepřidá a panel ukáže hlášku. **Kóta** vznikne se změřenou hodnotou a její pole v panelu dostane fokus; změna hodnoty přepočítá skicu, konflikt hodnotu odmítne.
- **Tažení bodu:** `solve` s `drag` při každém pohybu, nejvýš jeden rozpracovaný požadavek a jeden čekající cíl (poslední vyhrává).
- **Stupně volnosti** v panelu („Stupně volnosti: 4“ / „Plně určeno“); plně určená skica se kreslí barvou `sketchDefined` (jako černá v Onshape), jinak `sketch` (modrá).
- **Hotovo** (`sketch.finish`) = commit, **Zrušit** (`sketch.cancel`) = abort; obojí vrátí režim `'model'`.

## Kresba a picking

Skicu kreslí `render` z dat, ne z jádra ([[0017-modul-sketch-a-skicar|ADR 0017]]): `interaction` převede entity na `SketchDrawing` (rovina + úsečky, oblouky a body ve 2D se stylem) a pošle ji `ViewportPort.sketches.set(id, kresba)` ([[10-interakce#Port viewportu]], [[09-vykreslovani#Skici]]). Editovaná skica má id `'sketch-edit'` (kreslí ji `SketchEditor`, i s body a počátkem `'__origin'`); skici z poslední regenerace (bez konstrukčních křivek a bez bodů) a zapnuté počáteční roviny (čtverec 100 × 100 mm) kreslí `app` pod id artefaktu. Picking entit skici (`PickKind 'sketchEntity'`) dělá `render` nad vykreslenými křivkami a body v pixelech, ne `interaction` ručně.

## Mimo rozsah M12

- „Most“ – úsečka spojující vnitřní smyčku s vnější: stěna ji obsahuje tam i zpět, díra nevznikne a `makeFace` nejspíš selže (`'operation-failed'`); uživatel most smaže.

Každá položka je v [[Rozhodnutí noční rychloakce#M12 – Skicář|rozhodnutích R31–R50]]: splines, odsazení (offset), úhlová kóta a vzdálenost bod–přímka, vazba bod na křivce (snap na vnitřek úsečky), dělení křivek v průsečících (trim), popisky kót a značky vazeb ve viewportu (kóty a vazby jsou jen v panelu), tažení úseček a kružnic (jen body), undo uvnitř skicáře, skica na ploše tělesa (M14), osy počátku (M13), výplň rovin.

## Testy

- `sketch`: `parseSketchData` pro každé pravidlo (platná data, každý druh chyby s `index`); `constraintFor` a `dimensionFor` pro platné i neplatné výběry; `measure`; `removeItems` (kaskáda bod → křivky → osiřelé body → vazby); `toggleConstruction`; `computeRegions`: obdélník (1 oblast, jméno z id 4 úseček, plocha), dva obdélníky vedle sebe se sdílenou hranou (2 oblasti), obdélník s kružnicí uvnitř (díra, 2 oblasti), kružnice v kružnici v kružnici, drážka z úseček a tečných oblouků (řazení při shodě úhlu), otevřená polyline (0), polyline s „ocáskem“ (prořezání), konstrukční úsečka uvnitř obdélníku (ignorována), křížící se úsečky (`crossing`), body spojené `coincident` (splynutí uzlů), stabilita jména po změně souřadnic a pořadí entit; `FakeSolver`.
- `solver-planegcs` (Node, skutečný planegcs): obdélník bez kót `dof` 4 → se dvěma kótami 2 → s `fix` 0; změna kóty posune body; konflikt (třetí kóta úhlopříčky, kóta mezi dvěma fixovanými body) → `'conflict'` s id vazby; dvakrát `horizontal` → `'ok'` s `redundant`; tažení bodu u `dof > 0` (bod sleduje cíl) a u `dof 0` (nic se nehne, `'ok'`); kružnice s poloměrem; oblouk tečný k úsečce; `dof` s tažením = bez tažení; nic na konzoli; OOM (≥ 1000 obdélníků) → `'failed'` a další malé řešení projde; worker přes `MessageChannel`.
- `features/sketch`: schéma (společné testy pluginu), builder s `FakeKernel` (jedna oblast → `makeFace` jednou, artefakt s rovinou, `crossing` → varování a žádné plochy, neznámá rovina → `UNRESOLVED_REFERENCE`).
- `interaction`: `SketchEditor`/`SketchSession` s `FakeSolver` a `FakeViewport` (vstup, kresba, výběr, vazby, kóty, odmítnutí, souběh tažení, Hotovo = jeden záznam, Zrušit = nic), nástroje skicáře.
- Integrační `tests/sketch-scenario.test.ts` se skutečným řešičem v Node a e2e `e2e/m12.spec.ts` s OCCT ([[M12-skicar#Implementační plán]]).

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
