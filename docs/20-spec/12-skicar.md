---
type: spec
status: outline
order: 12
aliases:
  - Skicář
  - Spec 12
modules:
  - features
milestones:
  - "[[M12-skicar]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-12
---
# 12 – Skicář

> **Pojmy:** [[Featura]], [[Operace]], [[Transakce]], [[Determinismus operací]]  
> **Rozhodnutí:** [[0004-data-oddelene-od-chovani]]  
> **Milník:** [[M12-skicar]]

> Stav: hrubý návrh pro milník M12. Před zahájením M12 se upřesní.

Skica je featura (`type: 'sketch'`) – 2D geometrie s vazbami na rovině. Sama tělesa nevytváří; poskytuje **profily** (uzavřené oblasti), na které se odkazuje extrude a revolve ([[0004-data-oddelene-od-chovani|ADR 0004]] – stejný model data/chování jako ostatní featury).

## Data

```ts
export type SketchEntityId = Brand<string, 'SketchEntityId'>;

export interface SketchParams {
  readonly plane: PlaneRef;                          // 'XY' | 'XZ' | 'YZ' | TopoRef na rovinnou plochu (M14)
  readonly entities: readonly SketchEntity[];
  readonly constraints: readonly SketchConstraint[];
}

export type SketchEntity =
  | { kind: 'point';  id: SketchEntityId; x: number; y: number; construction?: boolean }
  | { kind: 'line';   id: SketchEntityId; p1: SketchEntityId; p2: SketchEntityId; construction?: boolean }
  | { kind: 'circle'; id: SketchEntityId; center: SketchEntityId; radius: number; construction?: boolean }
  | { kind: 'arc';    id: SketchEntityId; center: SketchEntityId; start: SketchEntityId; end: SketchEntityId; construction?: boolean };

export type SketchConstraint =
  | { kind: 'coincident'; id; a: SketchEntityId; b: SketchEntityId }
  | { kind: 'horizontal' | 'vertical'; id; line: SketchEntityId }
  | { kind: 'parallel' | 'perpendicular' | 'equal'; id; a; b }
  | { kind: 'tangent'; id; a; b }
  | { kind: 'distance'; id; a; b; value: number }
  | { kind: 'radius'; id; circle: SketchEntityId; value: number }
  | { kind: 'angle'; id; a; b; value: number }
  | { kind: 'fix'; id; point: SketchEntityId };
```

- ID entit jsou stabilní a generují se před operací. Na nich stojí jména bočních ploch extrude ([[08-topologicke-pojmenovani|08]]).
- **Souřadnice v datech jsou už vyřešené.** Řešič běží při editaci, jeho výsledek se zapíše do operace. Přehrání logu tedy na řešiči nezávisí (determinismus) a regenerace skicu nepřepočítává.

## Operace

Skica má vlastní operace (registrované pluginem), aby byl log čitelný a jemný:

`sketch.addEntities`, `sketch.removeEntities`, `sketch.addConstraint`, `sketch.removeConstraint`, `sketch.setConstraintValue`, `sketch.moveSolved` (nové vyřešené souřadnice po tažení).

Každá nese `featureId` skici. Celá editace skici (od vstupu do skicáře po „Hotovo“) je jedna transakce → jeden záznam v logu.

## Řešič vazeb

Za portem, stejně jako jádro:

```ts
export interface ConstraintSolver {
  solve(input: { entities; constraints; dragged?: { point: SketchEntityId; x: number; y: number } }):
    Promise<{ status: 'ok' | 'over' | 'under' | 'failed'; positions: Map<SketchEntityId, [number, number]>; dof: number }>;
}
```

Adaptér `PlanegcsSolver` nad knihovnou planegcs (FreeCAD GCS ve WASM), ve vlastním workeru nebo ve workeru jádra. Status `dof` (stupně volnosti) se zobrazuje – plně určená skica má jinou barvu (jako v Onshape).

## Profily

Z čar a oblouků skici (bez konstrukčních) se sestaví planární graf a najdou se **oblasti** (faces of the arrangement). Každá oblast dostane stabilní jméno odvozené z ID ohraničujících entit (seřazených). Extrude pak ukládá `SketchRegionRef { sketch, region }`.

Výpočet oblastí je čistá 2D geometrie v TypeScriptu (testovatelná bez OCCT). Až výsledný wire/face se staví v jádře.

## Režim skicáře (interakce)

- Vstup do skici = `FeatureEditSession` pro featuru `sketch` + aktivace sady skicovacích nástrojů (úsečka, kružnice, oblouk, kóta, vazby).
- Kamera se natočí kolmo na rovinu skici.
- Overlay vrstva viewportu kreslí skicu (Three.js `Line2` pro tlusté čáry), picking skicových entit je 2D v rovině skici, ne přes jádro.
- Tažení bodu = `solve` s `dragged` → `sketch.moveSolved` v transakci.
- Automatické vazby při kreslení (snap na koncový bod → coincident, téměř vodorovně → horizontal).

## Mimo rozsah M12

- Splines a odsazení (offset).

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
