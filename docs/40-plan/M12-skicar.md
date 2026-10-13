---
type: milestone
status: todo
order: 12
aliases:
  - M12
  - M12 Skicář
modules:
  - features
specs:
  - "[[12-skicar]]"
depends_on:
  - "[[M11-dalsi-entity]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-12
---
# M12 – Skicář

**Cíl:** 2D skica na rovině s vazbami a kótami, řešená přes planegcs; výpočet uzavřených oblastí (profilů).

**Specifikace:** [[12-skicar|12 – skicář]]

> Hrubý plán – před zahájením upřesnit specifikaci 12 a úkoly.

**Navazuje na:** [[M11-dalsi-entity]]

## Úkoly (orientačně)

- [ ] Datový model skici a schéma featury `sketch` (roviny XY/XZ/YZ).
- [ ] Operace `sketch.*` jako součást pluginu.
- [ ] Port `ConstraintSolver` + adaptér planegcs ve workeru; spike na integraci knihovny.
- [ ] Výpočet oblastí (planární graf) jako čistá funkce s testy.
- [ ] Režim skicáře: kamera kolmo, overlay kreslení, 2D picking, nástroje úsečka/kružnice/oblouk/kóta/vazby, automatické vazby.
- [ ] Zobrazení stupňů volnosti.

## Akceptační kritéria (orientačně)

- Obdélník s kótami a vazbami je plně určený; změna kóty přepočítá skicu.
- Celé skicování je v logu jeden záznam; undo vrátí skicu do stavu před editací.

## Retrospektiva

_(vyplnit po dokončení)_

## Úkoly z revize architektury (doplněno 2026-10-13, [[M10.1-zpevneni-kostry]])

Nálezy 1, 6 a 9 z [[Revize architektury 2026-10-13]]. Při upřesňování [[12-skicar|spec 12]] před startem M12 z nich udělat otázky a kontrakty.

- [ ] **Druhy artefaktů** ([[07-regenerace]]): `Artifact = Body | SketchArtifact | PlaneArtifact | AxisArtifact`; `SketchArtifact { kind: 'sketch'; id: SketchId; owner: FeatureId; plane: Plane; regions: ReadonlyMap<string, ShapeHandle>; curves: ShapeHandle }`; počáteční roviny a osy jako artefakty vyhrazeného vlastníka `origin` (`origin/plane:xy`, `origin/axis:z`), seedované do `EMPTY_STATE`; `EntityRef` o `kind: 'plane' | 'axis'`, takže `SketchParams.plane` je obyčejná reference, ne sjednocení enumu a `TopoRef`. `BuildContext.resolvePlanes`, `resolveSketches`.
- [ ] **Port a Prohlížeč** ([[10-interakce]]): `RegenSnapshot.artifacts` místo `bodies`; `BrowserModel` seskupí řádky *Počátek*, *Skici*, *Tělesa* podle `kind`; viditelnost na artefakt.
- [ ] **Kanál do renderu** ([[09-vykreslovani]]): `viewport.scene.sync(artifacts)` s vykreslovačem podle druhu (tělesa jako dosud, křivky skici jako `Line2`, roviny jako průhledné obdélníky viditelné jen při zapnutí v Prohlížeči); `SceneSync` klíčovaný `(ArtifactId, ShapeHandle)` zůstává.
- [ ] **Profil jako handle v jádře** ([[06-geometricke-jadro]], nález 9): builder skici vytvoří v jádře wire/face oblastí (`SketchOps.makeSketchFaces(plane, loops)` a `makeSketchCurves`), uloží handle do artefaktu; jména oblastí zůstávají v TypeScriptu. Extrude bere `ShapeHandle` plochy, ne data. `MeshOps.tessellateCurves(handle)` pro zobrazení.
- [ ] **Režimy** ([[10-interakce]], nález 6): prezentační model `ModeModel` (`'model' | 'sketch'`, `enter(sketchId)`, `finish()`), `ToolDescriptor.modes: readonly Mode[]`, `Action.enabled` odvozené i z režimu, `Toolbar` kreslí nástroje aktivního režimu, kamera kolmo na rovinu při vstupu. `PickKind` o `'sketchEntity'` a varianta `PickResult`; picking entit skici dělá `render` nad vykreslenými křivkami, ne `interaction` ručně.
