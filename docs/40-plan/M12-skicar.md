---
type: milestone
status: done
order: 12
aliases:
  - M12
  - M12 Skicář
modules:
  - core
  - document
  - sketch
  - solver-planegcs
  - kernel
  - kernel-occt
  - regen
  - interaction
  - render
  - features
  - app
  - ui
specs:
  - "[[12-skicar]]"
  - "[[02-core]]"
  - "[[03-dokument]]"
  - "[[04-operace-a-historie]]"
  - "[[06-geometricke-jadro]]"
  - "[[07-regenerace]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M11-dalsi-entity]]"
started: 2026-10-14
finished: 2026-10-14
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-14
---
# M12 – Skicář

**Cíl:** 2D [[Skica|skica]] na rovině s vazbami a kótami, řešená přes planegcs ve workeru; výpočet uzavřených oblastí (profilů) a jejich ploch v jádře; režim skicáře v aplikaci.

**Specifikace:** [[12-skicar|12 – skicář]] (hlavní), [[02-core|02]], [[03-dokument|03]], [[04-operace-a-historie|04]], [[06-geometricke-jadro|06]], [[07-regenerace|07]], [[09-vykreslovani|09]], [[10-interakce|10]], [[11-ui|11]]

**Navazuje na:** [[M11-dalsi-entity]] – plán začíná **po sloučení M11** (`TransformOps`, `BooleanOps`, `makeCylinder`, `PartStudioData.bodies`, operace `body.*`, port `confirm`, `RefListField` s čipy, `BrowserModel` nad metadaty).

**Rozhodnutí** (noční rychloakce, bez Pavla): R31–R50 v [[Rozhodnutí noční rychloakce#M12 – Skicář]], [[0016-planegcs-resic-vazeb|ADR 0016]] (planegcs ve workeru), [[0017-modul-sketch-a-skicar|ADR 0017]] (modul `sketch`, skicář v `interaction`, kresba z dat), [[Q020 Planegcs v samostatném workeru|Q020]], [[Q074 Operace skicáře v logu|Q074]].

## Úkoly

- [x] Ú1 `core`: rovina a 2D vektory (`Vec2`, `Plane`, `plane`)
- [x] Ú2 `document`, `ops`, `interaction`, `ui`: počáteční roviny, `PlaneRef`, `SketchId`, druhy parametrů `planes` a `data`
- [x] Ú3 `sketch` (nový modul): model skici, kontrola dat, pomůcky editace, oblasti, port řešiče, `FakeSolver`; hranice modulů
- [x] Ú4 `kernel`, `kernel-occt`, `regen`: `SketchOps.makeFace`
- [x] Ú5 `interaction` (+ zástupné místo v `render`, `app/testing`): režimy, `SketchPort`, `sketchEntity` v pickingu
- [x] Ú6 `solver-planegcs` (nový modul): adaptér řešiče ve workeru
- [x] Ú7 `regen`: artefakty `plane` a `sketch`, počátek v `EMPTY_STATE`, `resolvePlanes`, sweep ploch oblastí
- [x] Ú8 `render`: vrstva skic, picking entit skici, paleta, kamera kolmo na rovinu
- [x] Ú9 `interaction`: `SketchEditor`, `SketchSession`, akce skicáře, kresba skici, `FeatureEditSession.setParams`, výběr roviny
- [x] Ú10 `features/sketch`: plugin skici (schéma, builder, slovník)
- [x] Ú11 `interaction`, `app`: Prohlížeč (Počátek, Skici), port regenerace se skicami, úprava skici z Timeline
- [x] Ú12 `interaction`: nástroje skicáře
- [x] Ú13 `app`, `ui`: skládání skicáře, lišta podle režimu, panel skici, Prohlížeč, překlady, registrace pluginu
- [x] Ú14 `tests`: integrační scénář se skutečným řešičem
- [x] Ú15 `e2e`: akceptační scénář s OCCT a planegcs v prohlížeči
- [x] Ú16 hlavní sezení: kontrola, vault, `architecture-reviewer`, retrospektiva

## Akceptační kritéria

- **Obdélník plně určený:** nová skica na rovině XY, obdélník nakreslený od počátku (snap na počátek → `fix`) a dvě kóty (šířka, výška) → panel ukáže „Plně určeno“ a skica se kreslí barvou `sketchDefined`; před kótami „Stupně volnosti: 2“.
- **Změna kóty přepočítá skicu:** nová hodnota šířky v panelu posune body (ověřeno v integračním testu na souřadnicích, v e2e na hodnotě a stavu), skica zůstane plně určená.
- **Jeden záznam v logu:** celé skicování od vstupu po „Hotovo“ je v logu jeden záznam (`batch[feature.add, feature.setParams]`); úprava existující skici jeden `feature.setParams`; „Zrušit“ log nezmění. Undo vrátí dokument do stavu před skicou, redo ji vrátí; po reloadu je skica zpět.
- Po „Hotovo“ má skica v regeneraci jednu oblast (plocha v OCCT), Timeline ukazuje „Skica 1“ bez chyby, aplikace je v režimu modelování.
- `npm run check`, `npm run test:integration`, `npm run build`, `npm run test:e2e` zelené.

## Úkoly z revize architektury (doplněno 2026-10-13, [[M10.1-zpevneni-kostry]])

Nálezy 1, 6 a 9 z [[Revize architektury 2026-10-13]]. Zapracováno do Implementačního plánu (2026-10-14), u každého bodu je, kde se řeší a co se změnilo.

- [x] **Druhy artefaktů** ([[07-regenerace]]): `Artifact = Body | SketchArtifact | PlaneArtifact`; počáteční roviny jako artefakty vlastníka `origin` seedované do `EMPTY_STATE`; `EntityRef` o `kind: 'plane'`, `SketchParams.plane` je obyčejná reference; `BuildContext.resolvePlanes`. → Ú2, Ú7. **Upraveno:** `SketchArtifact` nese místo `curves: ShapeHandle` vyřešené entity pro kresbu (R34); `AxisArtifact` a osy počátku až s Revolve v M13 (R37); `resolveSketches` přijde s Extrude v M13 (první spotřebitel).
- [x] **Port a Prohlížeč** ([[10-interakce]]): Prohlížeč seskupí *Počátek*, *Skici*, *Tělesa*. → Ú11, Ú13. **Upraveno (R38 ⚠):** `RegenSnapshot` dostane `sketches` vedle `bodies` místo přejmenování na `artifacts`; viditelnost rovin je stav pohledu, skici oko nemají (R48 ⚠).
- [x] **Kanál do renderu** ([[09-vykreslovani]]): skici a roviny se kreslí. → Ú5, Ú8, Ú13. **Upraveno (R34):** kanál je `ViewportPort.sketches` s platformově nezávislou kresbou z dat (`SketchDrawing`), ne `sync(artifacts)` přes jádro; tělesa zůstávají v `BodyLayer` beze změny; roviny jako obrys čtverce bez výplně.
- [x] **Profil jako handle v jádře** (nález 9, [[06-geometricke-jadro]]): builder skici staví plochy oblastí v jádře, jména oblastí v TS. → Ú3, Ú4, Ú10. **Upraveno (R35):** jedna operace `SketchOps.makeFace` na oblast; `makeSketchCurves` a `tessellateCurves` nevznikají (kresba z dat).
- [x] **Režimy** (nález 6, [[10-interakce]]): `Mode`, `ToolDescriptor.modes`, akce podle režimu, Toolbar podle režimu, kamera kolmo na rovinu, `PickKind 'sketchEntity'`, picking v `render`. → Ú5, Ú8, Ú9, Ú13. **Upraveno (R45):** `ModeModel` není samostatný model – režim je `SketchEditor.mode` (odvozený od otevřené session); `Action.modes` a pravidlo „stejná zkratka jen v disjunktních režimech“.
- Menší nález z revize „`FeaturePlugin` nemá `ops`…, M12 změní tabulku závislostí“: **odpadá** – skicář operace pluginu nepotřebuje ([[Q074 Operace skicáře v logu|Q074]], R36 ⚠).

## Implementační plán

Každý úkol dělá zvlášť subagent `implementer` (TDD: test nejdřív a ověřit, že padá; `npm run check`). Kontrakty jsou propsané do specifikací (odkazy u úkolů); hlavní zdroj je [[12-skicar]], `interaction` v [[10-interakce#Skicář]]. Implementátor hlásí odchylky, hlavní sezení je propíše. Seznam souborů je vodítko: sáhnout jinam smí, když to dává smysl, a ohlásí to.

**Paralelní běh:** úkoly jedné vlny mají oddělené soubory a běží souběžně ve vlastních worktree. `index.ts` a `testing.ts` modulu, `.dependency-cruiser.cjs`, `tsconfig*.json`, `vite.config.ts`, `src/ui/i18n/{cs,en}.ts`, `src/app/session.ts`, `src/app/testing.ts` a `src/app/plugins.ts` smí v dané vlně měnit jen úkol, u kterého jsou uvedené.

**Nové závislosti npm** instaluje hlavní sezení před vlnou A: `@salusoft89/planegcs@1.3.0` (dependencies, přesná verze jako u OCCT).

| Vlna | Úkoly (paralelně) | Závisí na |
|---|---|---|
| 0 | Ú1 `core` (malý) | M11 |
| A | Ú2 `document`/`ops` · Ú3 `sketch` · Ú4 `makeFace` · Ú5 režimy a porty `interaction` | Ú1 |
| B | Ú6 `solver-planegcs` · Ú7 `regen` artefakty · Ú8 `render` skici · Ú9 `SketchEditor` | Ú6 na Ú3; Ú7 na Ú2, Ú3, Ú4; Ú8 na Ú5; Ú9 na Ú2, Ú3, Ú5 |
| C | Ú10 plugin skici · Ú11 Prohlížeč a port · Ú12 nástroje skicáře | Ú10 na Ú7; Ú11 na Ú9; Ú12 na Ú9 |
| D | Ú13 `app` + `ui` · Ú14 integrační test | C (Ú14 i Ú6) |
| E | Ú15 e2e | D |
| F | Ú16 hlavní sezení | E |

Proč vlna 0: `Plane` a `Vec2` z `core` potřebují čtyři úkoly vlny A; `core/index.ts` smí měnit jen jeden úkol a duplikovat typ roviny v každém modulu nechceme.

Proč nástroje (Ú12) zvlášť od `SketchEditor` (Ú9): Ú9 je velký a nástroje stojí jen na jeho veřejném rozhraní. Ú9 proto vytvoří `src/interaction/sketch-tools.ts` s konečnou signaturou `createSketchTools` (vrací `[]`) a export v `index.ts`; Ú12 soubor jen naplní, `index.ts` nemění.

### Vlna 0

#### Ú1 `core`: rovina a 2D vektory
- **Soubory:** `src/core/math/plane.ts` (nový), `src/core/math/plane.test.ts`, `src/core/index.ts`, `src/core/index.test.ts` (export).
- **Kontrakt** ([[02-core#Matematika (hodnotové typy)]]): `Vec2`, `Plane`, `plane = { yDir, toWorld, toLocal, intersectRay, isOrthonormal }`. Bez gl-matrix (jen fasáda `vec3`), výsledky nová pole, zmrazení není potřeba (n-tice `readonly`).
- **Testy:** `toLocal(toWorld(v)) = v` pro roviny XY, XZ, YZ z tabulky [[12-skicar#Roviny a počátek]] i pro obecnou ortonormální rovinu s posunutým počátkem; `yDir` tří rovin (+Y, +Z, +Z); `intersectRay` kolmý, šikmý, „za“ počátkem paprsku, rovnoběžný → `null`; `isOrthonormal` – platná, nejednotková `xDir`, nekolmé osy, `NaN` → `false`, vlastní tolerance.
- **Hotovo když:** testy a `npm run check` projdou; `core` exportuje `Vec2`, `Plane`, `plane`.

### Vlna A

#### Ú2 `document`, `ops`, `interaction`, `ui`: počáteční roviny a nové druhy parametrů
- **Soubory:** `src/document/refs.ts`, `origin.ts` (nový), `schema.ts`, `validate.ts`, `references.ts`, `serialize.ts` (vyhrazené id), `index.ts` + testy (`refs.test.ts`, `origin.test.ts`, `validate.test.ts`, `references.test.ts`, `serialize.test.ts`, `index.test.ts`); `src/ops/handlers/feature.ts` (validate `feature.add`) + test; `src/interaction/feature-editor.ts` (`focusRefParam` s `planes`), `src/interaction/ref-pick-tool.ts` (`pickFilterFor(planes) = []`) + testy; `src/ui/components/params/registry.ts`, `registry.test.ts`, `src/ui/components/FeatureDialog.vue` (pole bez komponenty přeskočit).
- **Kontrakt** ([[03-dokument#Reference na jiné entity]], [[03-dokument#Počáteční geometrie (M12)]], [[03-dokument#Schéma featury]]):
  ```ts
  export type PlaneId = Brand<string, 'PlaneId'>;
  export type SketchId = Brand<string, 'SketchId'>;
  export interface PlaneRef { readonly kind: 'plane'; readonly plane: PlaneId }
  export type EntityRef = BodyRef | TopoRef | SketchRegionRef | PlaneRef;
  export function sketchId(owner: FeatureId): SketchId;            // '<owner>/sketch'
  export function parsePlaneId(v: unknown): PlaneId | undefined;   // '<vlastník>/plane:<[a-z0-9]+>'
  export const ORIGIN: FeatureId;                                  // 'origin'
  export const ORIGIN_PLANE_IDS: { readonly xy: PlaneId; readonly xz: PlaneId; readonly yz: PlaneId };
  export interface OriginPlane { readonly id: PlaneId; readonly label: string; readonly plane: Plane }
  export const ORIGIN_PLANES: readonly OriginPlane[];              // xy, xz, yz; label 'origin.plane.xy' …
  // ParamSpec
  | { kind: 'planes'; label: string; min?: number; max?: number }
  | { kind: 'data'; label: string };
  ```
  - Rámce rovin podle tabulky ve spec 12 (XY: x +X, n +Z; XZ: x +X, n −Y; YZ: x +Y, n +X), vše hluboce zmrazené.
  - `ownerOf(PlaneRef)` = text před `/`; `dependenciesOf` reference na `ORIGIN` přeskočí (není featura studia – platí už dnes, jen test).
  - `planes` v `readRef` (sdílí `validateAgainstSchema` a `referencesOf`): položka `{ kind: 'plane', plane }` s `parsePlaneId`, jinak `param.invalidRef`; duplicita podle `plane` (`param.duplicateRef`); `min`/`max` jako ostatní. `data`: jen `param.missing`, jinak bez kontroly.
  - `FeatureId` `'origin'` je neplatné: `fromData` (issue jako u id s `/`) a `validate` operace `feature.add`.
  - `FeatureEditor`: `focusRefParam` přijme parametr druhu `planes`; automatický fokus po `create` zůstává jen `bodies`/`topo`/`region` (skicář by jinak dostal `refPick`). `pickFilterFor` druhu `planes` → `[]` (roviny se vybírají v Prohlížeči).
  - `ui`: registr polí – `planes` → `RefListField` (počet, bez čipů), `data` → žádná komponenta; `FeatureDialog` pole bez komponenty nekreslí. Test registru vynechá `region` a `data`.
- **Testy:** `parsePlaneId` (platné, bez vlastníka, s `/` ve vlastníku, prázdné jméno, velká písmena, ne-řetězec); `sketchId` (a výjimky jako `bodyId`); `ORIGIN_PLANES` (id, pořadí, ortonormální rámce přes `plane.isOrthonormal`, `yDir`, zmrazené); `validateAgainstSchema` pro `planes` (platná, neplatná položka, duplicita, `min`/`max`) a `data` (chybí → `param.missing`, cokoli jiného projde); `referencesOf` s `planes`; `dependenciesOf` s referencí na počáteční rovinu = bez závislosti; `fromData` a `feature.add` odmítnou id `'origin'`; `focusRefParam('plane')` pro schéma s `planes`; `pickFilterFor`.
- **Hotovo když:** testy a `npm run check` projdou; `document` exportuje vše z kontraktu.

#### Ú3 `sketch`: nový doménový modul
- **Soubory:** `src/sketch/model.ts`, `parse.ts`, `geometry.ts`, `edit.ts`, `regions.ts`, `solver.ts`, `index.ts`, `testing.ts` (nové) + testy `parse.test.ts`, `geometry.test.ts`, `edit.test.ts`, `regions.test.ts`, `testing.test.ts`, `index.test.ts`; `.dependency-cruiser.cjs` (všechny změny tabulky M12 najednou, viz níže); `tsconfig.domain.json` (`src/sketch/**/*.ts`); `src/module-entry-points.test.ts`, je-li v něm výčet modulů.
- **Kontrakt** ([[12-skicar#Data (`sketch`)]], [[12-skicar#Kontrola dat]], [[12-skicar#Geometrie a pomůcky editace]], [[12-skicar#Oblasti (profily)]], [[12-skicar#Řešič vazeb]]): typy `SketchEntityId`, `SketchConstraintId`, `SketchItemId`, `SketchPoint`, `SketchLine`, `SketchCircle`, `SketchArc`, `SketchCurve`, `SketchEntity`, `GeometricConstraintKind`, `GEOMETRIC_CONSTRAINT_KINDS`, `DimensionKind`, `SketchConstraint`, `SketchConstraintDraft`, `SketchData`, `SKETCH_FEATURE_TYPE`; `parseSketchData`, `SketchIssue`; `Curve2`, `pointsById`, `curve2`; `constraintFor`, `dimensionFor`, `measure`, `removeItems`, `toggleConstruction`; `SketchRegion`, `RegionsResult`, `computeRegions`; `SolveInput`, `SolveStatus`, `SolveResult`, `ConstraintSolver`. `testing.ts`:
  ```ts
  export interface FakeSolver extends ConstraintSolver {
    next(result: Partial<SolveResult>): void;    // další solve vrátí echo přepsané těmito poli (fronta)
    hold(): void; release(): void;               // pozdržení odpovědí (souběh); release vyřídí všechny čekající v pořadí
    readonly calls: readonly SolveInput[];
  }
  export function createFakeSolver(): FakeSolver;
  /** Obdélník: body a, b, c, d (proti směru hodin od [x, y]), úsečky ab, bc, cd, da, 2× horizontal, 2× vertical; id s prefixem. */
  export function rectangleData(opts?: { readonly x?: number; readonly y?: number; readonly width?: number; readonly height?: number; readonly prefix?: string }): SketchData;
  ```
  - `sketch` závisí jen na `core`. `Curve2` má přesně tvar `ProfileCurve` ze spec 06 (Ú4 ho definuje v `kernel` paralelně; shodu ověří až builder skici v Ú10).
  - `FakeSolver` echo: `status 'ok'`, `entities` = vstup (tažený bod přesunutý na `to`), `dof` podle vzorce ve spec 12, prázdné seznamy; odpovídá v mikroúloze; `next` přepíše jednotlivá pole.
  - **`.dependency-cruiser.cjs`** (jediná změna souboru v celém M12, aby se další vlny nehádaly): nové moduly `sketch: { deps: ['core'] }` a `'solver-planegcs': { deps: ['core', 'sketch'], npm: ['@salusoft89/planegcs'] }`; `sketch` přidat do `deps` modulů `regen`, `interaction`, `features/*`, `app`; `solver-planegcs` do `deps` modulu `app`; do pravidla `render-pure-files-without-three` přidat soubory `sketch-drawing` a `sketch-pick` (vzniknou v Ú8). Komentář nahoře tabulky drží shodu se spec 01 (už propsáno).
- **Testy:** viz [[12-skicar#Testy]] – `parseSketchData` (každé pravidlo zvlášť s `index`, sdílené id entity a vazby, pole místo pole → `index -1`, odkaz na pozdější bod je platný); `constraintFor` (každý druh, platný i neplatný výběr, pořadí `a`/`b`, tečnost úsečka+oblouk v obou pořadích); `dimensionFor` (úsečka, kružnice, oblouk, dva body, nulová délka → `null`); `measure`; `removeItems` (kaskády, neznámá id, pořadí); `toggleConstruction`; `computeRegions` – všech 11 případů ze spec 12 včetně ploch (obdélník 10×5 → 50; obdélník s kruhem r = 2 → `50 − 4π` a `4π`) a stability jména; `FakeSolver` (echo, tažení, `dof`, `next`, `hold`/`release`, `calls`).
- **Hotovo když:** testy a `npm run check` projdou (včetně `lint:deps` s novými pravidly); `src/sketch/index.ts` exportuje vše z kontraktu.

#### Ú4 `kernel`, `kernel-occt`, `regen`: `SketchOps.makeFace`
- **Soubory:** `src/kernel/kernel.ts`, `src/kernel/profile.ts` (nový: `ProfileCurve`, `ProfileLoop`, validace smyček sdílená oběma jádry), `src/kernel/index.ts`, `src/kernel/fake-kernel.ts`, `src/kernel/testing.ts` (kontraktová sada) + testy `profile.test.ts`, `fake-kernel.test.ts`, `index.test.ts`; `src/kernel-occt/occt-kernel-impl.ts`, `client.ts`, `worker-impl.ts`, `index.ts` (`createOcctKernel` přeposílá i `makeFace`) + testy (`occt-sketch.test.ts` nový pro OCCT-specifické případy); `src/regen/builder.ts` (`ModelingKernel` += `SketchOps`), `src/regen/tracking-kernel.ts` + test.
- **Kontrakt** ([[06-geometricke-jadro#Stav po M12]], [[06-geometricke-jadro#Kontrakt (platí pro každou implementaci)]], [[06-geometricke-jadro#Rovinná plocha v adaptéru (M12)]], [[06-geometricke-jadro#`FakeKernel`]]):
  ```ts
  export type ProfileCurve = | { kind: 'line'; from: Vec2; to: Vec2 } | { kind: 'arc'; center: Vec2; from: Vec2; to: Vec2; ccw: boolean } | { kind: 'circle'; center: Vec2; radius: number };  // readonly pole
  export type ProfileLoop = readonly ProfileCurve[];
  export interface SketchOps { makeFace(p: { readonly plane: Plane; readonly outer: ProfileLoop; readonly holes: readonly ProfileLoop[] }): Promise<ShapeResult> }
  export interface GeometryKernel extends PrimitiveOps, TransformOps, BooleanOps, SketchOps, MeshOps, QueryOps, LifecycleOps {}
  /** Pro obě jádra: prázdné pole = vstup v pořádku, jinak popisy chyb (zpráva 'invalid-input'). */
  export function validateFaceInput(p: unknown): readonly string[];
  // regen
  export type ModelingKernel = PrimitiveOps & TransformOps & BooleanOps & SketchOps & QueryOps;
  ```
  - Validace a výsledek podle odrážky `makeFace` v kontraktu spec 06; vstup se čte synchronně (izolace); každé volání nový handle.
  - Fake: AABB podle spec 06; `failNext('makeFace', …)` a `callCount('makeFace')` fungují.
  - OCCT podle „Rovinná plocha v adaptéru“; `using` u všech objektů OCCT. Vyhoď `'operation-failed'`, když `MakeWire`/`MakeFace` není `IsDone()` nebo `BRepCheck_Analyzer` hlásí neplatnou plochu.
  - `tracking-kernel`: `makeFace` přes `track`.
- **Testy:** kontraktová sada M12 a OCCT navíc podle [[06-geometricke-jadro#Testy]]; `validateFaceInput` pro každé pravidlo; `regen`: sledované jádro zapíše handle z `makeFace`, chybu propustí.
- **Hotovo když:** testy a `npm run check` projdou; `kernel` exportuje `SketchOps`, `ProfileCurve`, `ProfileLoop`, `validateFaceInput`.

#### Ú5 `interaction` (+ `render`, `app/testing`): režimy a porty
- **Soubory:** `src/interaction/mode.ts` (nový), `viewport-port.ts`, `tools.ts`, `tool-manager.ts`, `actions.ts`, `builtin-actions.ts`, `select-tool.ts` (ignoruje `sketchEntity`), `testing.ts` (`FakeViewport.sketches`), `index.ts` + testy `tool-manager.test.ts`, `actions.test.ts`, `builtin-actions.test.ts`, `testing.test.ts`, `index.test.ts`; `src/render/viewport.ts` (zástupné `sketches` bez kreslení), `src/render/highlight-targets.ts` nebo `highlight-layer.ts` (vypustit `sketchEntity`), `src/render/picker.ts` (filtr jen s `sketchEntity` → `null`) + jejich testy; `src/app/testing.ts` (`FakeAppViewport.sketches` předá `FakeViewport`).
- **Kontrakt** ([[10-interakce#Port viewportu]], [[10-interakce#Režim]], [[10-interakce#Nástroje]], [[10-interakce#Akce a klávesové zkratky]]): `Mode`, `ALL_MODES`; `PickKind` += `'sketchEntity'`; `HighlightTarget` a `PickResult` += varianta `sketchEntity`; `SketchStyle`, `SketchDrawingCurve`, `SketchDrawingPoint`, `SketchDrawing`, `SketchPort`, `ViewportPort.sketches`; `ToolDescriptor.modes?`, skupiny `'draw' | 'constrain'`; `createToolManager` deps `mode?`, `defaultToolIds?`; `createActionRegistry(deps?: { mode? })`, `Action.modes?`, `ActionState.modes`; `createBuiltInActions` deps `mode?` a `modes` u vestavěných akcí. Exportovat i pomocníka `toolModes(d: ToolDescriptor): readonly Mode[]` (výchozí `['model']`).
  - `FakeViewport`: `sketches.set/remove` zaznamená do `sketchDrawings: ReadonlyMap<string, SketchDrawing>` (poslední stav) a `pick` vrací připravený výsledek `sketchEntity` jen s `'sketchEntity'` ve filtru (stávající pravidlo pro druhy).
  - `render` v tomto úkolu nic nekreslí: `sketches` je prázdná implementace s komentářem „Ú8“; jen musí projít typy a testy.
  - Bez `mode` se všechno chová jako dosud (stávající testy beze změny).
- **Testy:** podle odrážky „Režimy (M12)“ v [[10-interakce#Testy]]: přepnutí režimu aktivuje výchozí nástroj režimu (`active` vyšle id) a deaktivuje předchozí; `activate` nástroje mimo režim → výjimka, aktivní zůstane; `finish` a `Escape` v režimu `sketch` → `defaultToolIds.sketch`; chybějící výchozí nástroj režimu → výjimka při vytvoření; `ActionRegistry`: stejná zkratka v disjunktních režimech projde, v překrývajících výjimka; `handleKey` podle režimu; `enabled` ve snapshotu podle režimu, změna režimu = nový snapshot jen u změněných; `run` mimo režim `false`; vestavěné: akce nástroje pro `sketch` je v režimu `sketch` povolená i při `locked`, `feature.delete` má `['model']`; `FakeViewport.sketches`; `SelectTool` s výsledkem `sketchEntity` (nikdy nežádá) – typově ošetřeno.
- **Hotovo když:** testy a `npm run check` projdou; e2e M10/M11 beze změny.

### Vlna B

#### Ú6 `solver-planegcs`: adaptér řešiče ve workeru
- **Soubory:** `src/solver-planegcs/planegcs-module.ts` (izolovaná výjimka typů), `solve.ts`, `protocol.ts`, `worker-impl.ts`, `client.ts`, `solver.worker.ts`, `index.ts`, `testing.ts` (nové) + testy `solve.test.ts`, `worker-impl.test.ts`, `client.test.ts`; `vite.config.ts` (`optimizeDeps.exclude` += `'@salusoft89/planegcs'`); `README.md` (řádek o licenci LGPL-2.0-or-later řešiče).
- **Kontrakt** ([[12-skicar#Řešič vazeb]], [[0016-planegcs-resic-vazeb|ADR 0016]]):
  ```ts
  // planegcs-module.ts – jediné místo s přetypováním (balík nemá planegcs.d.ts); okomentovat proč
  export interface PlanegcsModule { readonly GcsSystem: GcsSystemConstructor }
  export function loadPlanegcs(opts?: { readonly locateWasm?: () => string }): Promise<PlanegcsModule>;
  // solve.ts
  /** Synchronně; WebAssembly.RuntimeError pouští dál (modul je mrtvý), jiné výjimky → status 'failed'. */
  export function solveSketch(mod: PlanegcsModule, input: SolveInput): SolveResult;
  // worker-impl.ts
  export function createSolverWorkerImpl(load: () => Promise<PlanegcsModule>): RpcImpl<SolverProtocol>;
  // index.ts (jediný veřejný export)
  export function createPlanegcsSolver(): ConstraintSolver & Disposable;
  // testing.ts (jen testy, i tests/)
  export function createInThreadPlanegcsSolver(): ConstraintSolver;   // Node: loadPlanegcs() bez locateWasm, stejná logika jako worker-impl
  ```
  - `solveSketch` přesně podle odrážky „Adaptér“ ve spec 12: nový `GcsWrapper(new mod.GcsSystem(), mod)` při každém volání, `debug_mode = DebugMode.NoDebug` **před** `push_primitives_and_params`, mapování entit a vazeb, `fix` → `coordinate_x/y` (`<id>:x`, `<id>:y`), tažení → dočasné `coordinate_x/y` (`__drag:x|y`; tažený bod, který neexistuje → `'failed'`), stav (konflikt má přednost před `Failed`), převod id zpět, `apply_solution` jen u `'ok'`, `destroy_gcs_module()` ve `finally`. Přesné názvy polí primitiv ověř v typech balíku (`dist/sketch/*.d.ts`) a ve spike skriptech (cesta v [[0016-planegcs-resic-vazeb|ADR 0016]] – `scratchpad/planegcs-spike/`).
  - `SolverProtocol` odvozený z `ConstraintSolver` + `ready(): void` (jako `OcctKernelProtocol`). Worker: `serveRpc` synchronně při startu, modul se načte líně; `RuntimeError` → zahodit slib modulu, vrátit `{ status: 'failed', entities: null, dof: null, conflicting: [], redundant: [] }`. Selhání načtení modulu → volání odmítne (`Error` se zprávou).
  - `createPlanegcsSolver`: worker `new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' })` až při prvním `solve`, `onerror`/`onmessageerror` → `failAll`; volání odmítnuté `RpcError` `'disconnected'` worker ukončí a zahodí (další `solve` vytvoří nový); `dispose` worker ukončí a další `solve` odmítne.
  - `solver.worker.ts`: `import wasmUrl from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url'`, endpoint jako `occt.worker.ts`.
- **Testy** (Node, skutečný planegcs, `loadPlanegcs()` jednou na soubor): všechny odrážky `solver-planegcs` v [[12-skicar#Testy]]; navíc `fix` jako dvojice souřadnic (kóta mezi dvěma fixovanými body se špatnou hodnotou → `'conflict'` s id kóty); `entities` zachovají pořadí a pole (konstrukce, id); nic na `console.*` ani `process.stdout.write` (spy) během řešení; worker-impl: líné načtení (počítadlo `load`), OOM test (≥ 1000 obdélníků → `'failed'`, další malé řešení `'ok'`, `load` zavolán podruhé) – smí mít delší timeout; klient přes `MessageChannel` (`serveRpc` + `createRpcClient` + `createSolverWorkerImpl`), výsledek dorazí.
- **Hotovo když:** testy a `npm run check` projdou; `npm run build` projde (worker a WASM v bundlu).

#### Ú7 `regen`: artefakty roviny a skici
- **Soubory:** `src/regen/state.ts`, `build-context.ts`, `builder.ts` (`BuildContext.resolvePlanes`, `RefError`), `regenerator.ts` (sweep), `index.ts`, `testing.ts` (`aBuildContext` s `resolvePlanes`, je-li tam), testy `state.test.ts`, `build-context.test.ts`, `regenerator-sweep.test.ts`, `index.test.ts`; testy jinde, které předpokládají prázdný `EMPTY_STATE` (ohlásit).
- **Kontrakt** ([[07-regenerace#Princip]], [[07-regenerace#Builder featury]], [[07-regenerace#Životnost handle: mark & sweep]]): `ArtifactId = BodyId | SketchId | PlaneId`; `PlaneArtifact`, `SketchArtifact`, `Artifact = Body | SketchArtifact | PlaneArtifact`; `EMPTY_STATE` se třemi rovinami z `ORIGIN_PLANES` (owner `ORIGIN`, zmrazené); `sketchesOf`, `planesOf`; `resolvePlanes(refs: readonly PlaneRef[]): Result<PlaneArtifact[], RefError>`; `RefError.ref: BodyRef | PlaneRef`; sweep: živé handle = `shape` těles ∪ hodnoty `regions` skic.
  - `isBody` už nepotřebuje rozšíření na `string` (druhů je víc); `resolveBodies` beze změny chování.
- **Testy:** `EMPTY_STATE` (3 roviny v pořadí, rámce, zmrazené); `bodiesOf` ignoruje roviny a skici; `sketchesOf`, `planesOf`; `resolvePlanes` (rovina, chybějící id, id tělesa → err s `ref`); sweep s testovacím builderem, který vytvoří skicu se dvěma plochami (`makeFace` z `FakeKernel`): po regeneraci `liveHandleCount` = 2, po odebrání featury 0; property test regenerace (cache = od nuly) projde se seedovanými rovinami.
- **Hotovo když:** testy a `npm run check` projdou; `regen` exportuje nové typy a funkce.

#### Ú8 `render`: vrstva skic, paleta, kamera kolmo na rovinu
- **Soubory:** `src/render/sketch-drawing.ts`, `sketch-pick.ts` (čisté, bez `three`), `sketch-layer.ts` (nové) + testy `sketch-drawing.test.ts`, `sketch-pick.test.ts`; `viewport.ts` (nahradí zástupné `sketches` z Ú5, picking), `palette.ts` (+ test), `camera-controller.ts`, `orbit-direction.ts` (`viewDirectionFor`) + test, `index.ts` (export typu `SketchLayer`, je-li potřeba); `src/app/testing.ts` (`FakeAppViewport.camera.setViewDirection` zaznamená směr do `viewDirections`); `dev/viewport.html` (ruční ukázka skici, je-li jednoduché).
- **Kontrakt** ([[09-vykreslovani#Skici]], [[09-vykreslovani#Kamera]]): `ScenePalette.sketch`, `sketchDefined` (hodnoty v spec 09); `tessellateSketch`, `pickSketch`; `SketchLayer` implementuje `SketchPort` (+ interní `group`, `pick`, `setPalette`, `setResolution`, `dispose`); `Viewport.sketches`; `pick` s `'sketchEntity'` nejdřív skici; `CameraController.setViewDirection(direction: Vec3)`, `viewDirectionFor(d)`.
  - Barvy po vrcholech v `LineSegmentsGeometry.setColors` a `PointsMaterial({ vertexColors: true, sizeAttenuation: false, size: 7 })`; `depthTest: false`, `renderOrder` 3; `dispose` vrstvy uvolní geometrie a materiály. `viewport.dispose` uvolní i vrstvu skic.
- **Testy:** `tessellateSketch` (úsečka = 1 segment, půlkruh s krokem π/36 = 36 segmentů, kruh, body přes `toWorld` na rovině XZ, mapy id a stylů); `pickSketch` (bod má přednost před bližší křivkou do tolerance, mimo toleranci `null`, nejbližší ze dvou křivek); `viewDirectionFor` (+Z → nakloněný `top`, −Z → `bottom`, −Y → `[0, −1, 0]`, nenormalizovaný vstup, nulový → výjimka); paleta má nové barvy v obou režimech. Three.js část ručně na dev stránce (ohlásit, co bylo ověřeno).
- **Hotovo když:** testy a `npm run check` projdou; `npm run build` projde.

#### Ú9 `interaction`: `SketchEditor`, `SketchSession`, akce a kresba skicáře
- **Soubory:** `src/interaction/sketch-editor.ts` (editor a session; smí rozdělit na `sketch-session.ts`), `sketch-drawing.ts`, `sketch-actions.ts`, `sketch-tools.ts` (jen konečná signatura `createSketchTools` vracející `[]`, komentář „Ú12“), `feature-editor.ts` (`setParams`), `selection.ts` (položka `plane`), `index.ts` + testy `sketch-editor.test.ts`, `sketch-drawing.test.ts`, `sketch-actions.test.ts`, `feature-editor.test.ts`, `selection.test.ts`, `index.test.ts`.
- **Kontrakt** ([[10-interakce#Skicář]], [[10-interakce#Dialog featury: `FeatureEditor`]], [[10-interakce#Výběr]]): `SketchEditor`, `createSketchEditor`, `SketchSession`, `SketchState`, `SketchMessageKey`, `SketchConstraintRow`, `EDIT_SKETCH_DRAWING_ID`, `ORIGIN_POINT_ID`; `toSketchDrawing`, `artifactDrawing`, `planeDrawing`; `SKETCH_ACTION_IDS`, `sketchConstraintActionId`, `createSketchActions`; `createSketchTools` (signatura); `FeatureEditSession.setParams`; `SelectionItem` `{ kind: 'plane'; plane: PlaneId }` (porovnání v `sameSelectionItem`, přežije novou generaci).
  - Pravidla zápisu, fronta, tažení, kresba, styly a kóty přesně podle [[10-interakce#`SketchEditor` a `SketchSession`]]. `SketchEditor` čte data skice z `FeatureEditSession.state.params` přes `parseSketchData` a rovinu z parametru `plane` (první položka) přes `resolvePlane`.
  - Testovací schéma skici (bez pluginu z Ú10, který vzniká až ve vlně C): v testu zaregistruj schéma typu `SKETCH_FEATURE_TYPE` se třemi parametry jako ve spec 12 (`planes`, `data`, `data`) a jednoduchým `validate`.
- **Testy:** odrážka „Skicář (M12…)“ v [[10-interakce#Testy]] kromě nástrojů a Prohlížeče: s dokumentem, dispečerem, logem, `FeatureEditor`, `FakeSolver` a `FakeViewport`; `finish` po nové skice = právě jeden záznam `batch[feature.add, feature.setParams]`; po úpravě jeden `feature.setParams`; `cancel` = log beze změny a featura pryč; kresba `'sketch-edit'` po vstupu, změně a odstranění po zavření; souběh tažení: `hold`, tři `drag` → po `release` dvě volání `solve` (první a poslední cíl); příkaz po zavření → výjimka.
- **Hotovo když:** testy a `npm run check` projdou; e2e M10/M11 beze změny.

### Vlna C

#### Ú10 `features/sketch`: plugin skici
- **Soubory:** `src/features/sketch/*` (nová složka: `index.ts`, `schema.ts`, `builder.ts`, `messages.ts`, `sketch.test.ts`). Do `app/plugins.ts` **nezapisuje** (Ú13).
- **Kontrakt** ([[12-skicar#Featura skici (`features/sketch`)]]): `SketchParams`, `sketchPlugin` (bez `tools`); schéma, `validate`, builder podle spec 12. Builder předává oblasti do `kernel.makeFace` **bez převodu** (`Curve2` je strukturálně `ProfileCurve` – když typy nesedí, je to odchylka mezi Ú3 a Ú4 k nahlášení).
  - Texty: cs „Skica“, „Rovina“, „Entity“, „Vazby“, `sketch.invalidEntity` „Neplatná entita skici {index}“, `sketch.invalidConstraint` „Neplatná vazba skici {index}“; en “Sketch”, “Plane”, “Entities”, “Constraints”, “Invalid sketch entity {index}”, “Invalid sketch constraint {index}”.
- **Testy:** společné testy pluginu jako `box.test.ts` (bez nástroje); `validate` s neplatnými daty skici (`issues` s `param` a `index`); builder s `FakeKernel` přes `aBuildContext`: obdélník (`rectangleData`) → `callCount('makeFace') === 1`, artefakt `sketchId(f)` s rovinou XY, entitami a jednou oblastí s jménem z id úseček; obdélník s kružnicí uvnitř → 2 plochy; křížící se úsečky → varování a žádná `makeFace`; skica na rovině XZ (rovina v artefaktu); neexistující rovina (`origin/plane:ab`) → `UNRESOLVED_REFERENCE` s `param: 'plane'`; v `Regenerator`: skica se nepočítá znovu, když se změní jen pozdější featura; změna kóty (souřadnic) → nové plochy, staré uvolněné (`liveHandleCount`).
- **Hotovo když:** testy a `npm run check` projdou; mimo `features/sketch` žádná změna.

#### Ú11 `interaction`, `app`: Prohlížeč, port regenerace se skicami, úprava skici
- **Soubory:** `src/interaction/regen-status-port.ts`, `browser-model.ts`, `feature-tree.ts`, `testing.ts` (`FakeRegenStatus.publish(health, bodies?, sketches?)`), `index.ts` + testy `browser-model.test.ts`, `feature-tree.test.ts`, `testing.test.ts`, `index.test.ts`; `src/app/regen-status-adapter.ts` + test.
- **Kontrakt** ([[10-interakce#Port stavu regenerace]], [[10-interakce#Prohlížeč: `BrowserModel` a viditelnost těles]], [[10-interakce#Strom featur: `FeatureTreeModel`]]): `RegenSketch`, `RegenSnapshot.sketches`; `BrowserPlaneRow`, `BrowserSketchRow`, `BrowserModel.planes`, `visiblePlanes`, `sketches`, `selectPlane`, `setPlaneVisible`, `selectSketch`, `editSketch`, deps `sketchEdit?`; `createFeatureTreeModel` deps `sketchEdit?` (edit featury typu `SKETCH_FEATURE_TYPE` jde do `sketchEdit`, bez něj jako dosud). `app` adaptér plní `sketches` z `sketchesOf(finalState)` (`{ sketch: a.id, feature: a.owner }`).
- **Testy:** roviny (3 řádky, klíče, výběr a přepnutí výběru, viditelnost jen v `visiblePlanes`, nový snapshot jen při změně); skici (řádky z portu, jméno z dokumentu se změní po `feature.rename`, výběr featury, `editSketch` zavolá `sketchEdit`); položka `plane` přežije novou generaci; `FeatureTreeModel.edit` skici → `sketchEdit`, jiné featury → `FeatureEditor.edit`; adaptér v `app` publikuje skici.
- **Hotovo když:** testy a `npm run check` projdou.

#### Ú12 `interaction`: nástroje skicáře
- **Soubory:** `src/interaction/sketch-tools.ts` (naplnit, signatura z Ú9), `src/interaction/sketch-tools/*.ts` (nové: `snap.ts`, `entry-tool.ts`, `select-tool.ts`, `line-tool.ts`, `rectangle-tool.ts`, `circle-tool.ts`, `arc-tool.ts`, `dimension-tool.ts` – dělení podle uvážení) + testy `sketch-tools/*.test.ts`. `index.ts` nemění.
- **Kontrakt** ([[10-interakce#Nástroje a akce skicáře]]): tabulka nástrojů (id, režim, skupina, zkratka, chování), `snapAt`, náhled přes overlay `'sketch-tool'`, popisky `tool.sketch`, `tool.select` (výběr ve skice), `tool.line`, `tool.rectangle`, `tool.circle`, `tool.arc`, `tool.dimension`; ikony `pencil`, `pointer`, `line`, `square`, `circle`, `chart-arcs`, `ruler-measure` (ověř existenci v `node_modules/@tabler/icons-webfont/dist/tabler-icons.css`, jinak nejbližší existující a ohlásit).
- **Testy** (`FakeViewport` s připraveným `pick` a `screenToRay`, skutečný `SketchEditor` s `FakeSolver`, dokument s testovacím schématem skici jako v Ú9): vstupní nástroj (rovina z výběru, výchozí XY, s otevřeným dialogem jen skončí); polyline 3 kliky = 2 úsečky se sdíleným bodem, klik na první bod uzavře (3. úsečka na existující bod), téměř vodorovná úsečka dostane `horizontal`, `Escape` ukončí řetěz a druhý `Escape` vrátí `sketch.select`; snap na existující bod (stejné id), snap na `ORIGIN_POINT_ID` (bod `[0, 0]` + `fix`); obdélník (4 body, 4 úsečky, 4 vazby, degenerovaný nic); kružnice; oblouk (konec promítnutý na kružnici, proti směru hodin); kóta na úsečku, kružnici a dva body (`editingDimension`); výběrový nástroj – hover, klik, Shift, klik do prázdna, tažení bodu (`drag` při pohybu, `endDrag` po uvolnění), malý pohyb = klik; náhled v overlay a jeho odstranění při deaktivaci; paprsek rovnoběžný s rovinou klik ignoruje.
- **Hotovo když:** testy a `npm run check` projdou.

### Vlna D

#### Ú13 `app`, `ui`: skládání skicáře, lišta, panel, Prohlížeč, překlady
- **Soubory:** `src/app/session.ts`, `browser.ts` (`openAppSession`: `createPlanegcsSolver()`, uvolnění po session), `plugins.ts` (`sketchPlugin` na konec `BUILT_IN_PLUGINS`), `testing.ts` (je-li potřeba), `index.ts` + testy `session.test.ts`, `plugins.test.ts`, `dispose-open-session.test.ts`; `src/ui/toolbar-groups.ts` + test, `src/ui/components/Toolbar.vue`, `SketchPanel.vue` (nový), `Browser.vue`, `AppShell.vue` nebo `App.vue` (dialog vs. panel), `src/ui/i18n/cs.ts`, `en.ts` (+ test úplnosti, je-li).
- **Kontrakt** ([[11-ui#Kompoziční kořen (app)]], [[11-ui#Komponenty]]): `AppSessionDeps.solver`; `AppSession.sketches`, `mode`, `sketchActionIds`, `sketchConstraintActionId`; skládání podle odrážky „Skicář (M12)“ ve spec 11 (editor, nástroje, akce, `mode` do registru akcí, správce nástrojů a vestavěných akcí, `sketchEdit`, kamera, kresby skic z regenerace bez editované skici, kresby zapnutých rovin pod id roviny); `toolbarGroups({ …, mode })` podle odrážky „Toolbar“ (ikony akcí: `sketch.finish` `check`, `sketch.cancel` `x`, vazby `point` (shoda), `arrows-horizontal`, `arrows-vertical`, `slashes` (rovnoběžnost), `angle` (kolmost), `equal`, `circle-dot` (tečnost), `lock` (ukotvení) – ověřit v CSS Tabler); `SketchPanel` (přístupné názvy: polí kót „Vzdálenost 1“, „Poloměr 1“ podle `constraintRows`; stav v `role="status"`); `Browser` se skupinami Počátek, Skici, Tělesa.
  - **Překlady** (cs / en) – všechny klíče M12 mimo plugin přidává jen tento úkol: `tool.sketch` „Skica“ / “Sketch”; `tool.line` „Úsečka“ / “Line”; `tool.rectangle` „Obdélník“ / “Rectangle”; `tool.circle` „Kružnice“ / “Circle”; `tool.arc` „Oblouk“ / “Arc”; `tool.dimension` „Kóta“ / “Dimension”; `toolbar.group.sketch` „Skica“ / “Sketch”; `toolbar.group.draw` „Kreslit“ / “Draw”; `toolbar.group.constrain` „Vazby“ / “Constrain”; `toolbar.group.finish` „Dokončit“ / “Finish”; `sketch.finish` „Hotovo“ / “Finish sketch”; `sketch.cancel` „Zrušit skicu“ / “Cancel sketch”; `sketch.delete` „Smazat“ / “Delete”; `sketch.construction` „Konstrukční“ / “Construction”; `sketch.constraint.coincident` „Shoda“ / “Coincident”; `.horizontal` „Vodorovná“ / “Horizontal”; `.vertical` „Svislá“ / “Vertical”; `.parallel` „Rovnoběžnost“ / “Parallel”; `.perpendicular` „Kolmost“ / “Perpendicular”; `.equal` „Shodná velikost“ / “Equal”; `.tangent` „Tečnost“ / “Tangent”; `.fix` „Ukotvení“ / “Fix”; `.distance` „Vzdálenost“ / “Distance”; `.radius` „Poloměr“ / “Radius”; `sketch.status.defined` „Plně určeno“ / “Fully defined”; `sketch.status.dof` „Stupně volnosti: {n}“ / “Degrees of freedom: {n}”; `sketch.status.solving` „Řeším…“ / “Solving…”; `sketch.conflict` „Vazba je v rozporu s ostatními“ / “The constraint conflicts with others”; `sketch.redundant` „Vazba už platí“ / “The constraint is redundant”; `sketch.solverFailed` „Skicu se nepodařilo vyřešit“ / “The sketch could not be solved”; `sketchPanel.constraints` „Vazby“ / “Constraints”; `sketchPanel.remove` „Odebrat {name}“ / “Remove {name}”; `browser.origin` „Počátek“ / “Origin”; `browser.sketches` „Skici“ / “Sketches”; `origin.plane.xy` „Horní (XY)“ / “Top (XY)”; `origin.plane.xz` „Přední (XZ)“ / “Front (XZ)”; `origin.plane.yz` „Pravá (YZ)“ / “Right (YZ)”. Popisek řádku vazby = `t('sketch.constraint.<kind>') + ' ' + n`.
- **Testy:** `session.test.ts` s `FakeSolver` a `FakeAppViewport`: nástroj `sketch` přepne `mode` na `sketch`, kamera dostane `setViewDirection([0, 0, 1])`, aktivní nástroj `sketch.select`, `sketch.finish` vrátí `model` a v logu je jeden záznam; po regeneraci je kresba skici pod jejím id a během úpravy té skici chybí (je jen `'sketch-edit'`); zapnutí roviny v Prohlížeči → kresba `planeDrawing`; `toolbarGroups` v obou režimech (skupiny, pořadí, akce vazeb a dokončení, nástroje mimo režim chybí); `plugins.test.ts`: pět pluginů, session se otevře (žádné kolize klíčů – ani se skicářem v `ui`).
- **Hotovo když:** testy, `npm run check` a `npm run build` projdou; e2e M10/M11 beze změny.

#### Ú14 `tests`: integrační scénář se skutečným řešičem
- **Soubory:** `tests/sketch-scenario.test.ts` (nový).
- **Kontrakt:** jako `tests/feature-dialog.test.ts` – dokument, dispečer, log, `UndoManager`, `Regenerator` nad `FakeKernel`, `FeatureEditor`, `createSketchEditor` s `createInThreadPlanegcsSolver()` (`@/solver-planegcs/testing`) a `FakeViewport`, plugin skici přes `registerPlugin`.
- **Testy:** nová skica na XY → `addGeometry(rectangleData({ x: 0, y: 0, width: 40, height: 20 }))` → `dof 4`; `fix` bodu `a` → 2; kóty `distance(a, b)` a `distance(b, c)` → 0, `fullyDefined`; `setDimension` šířky na 60 → `b.x ≈ 60`, `c.x ≈ 60`, `a` beze změny (tolerance 1e-6), stále `fullyDefined`; konfliktní kóta úhlopříčky → `false`, `message 'sketch.conflict'`, data beze změny; `finish` → log o **jeden** záznam delší; regenerace → jeden `SketchArtifact` s jednou oblastí (jméno = seřazená id úseček) a `makeFace` 1×; undo → featura pryč, regenerace bez skici; redo → zpět; `replayLog` do nového dokumentu = stejný `toData`; úprava skici (`edit`, `setDimension`, `finish`) → jeden záznam `feature.setParams`; úprava a `cancel` → log beze změny; tažení rohu `c` nedourčeného obdélníku (bez kót) posune `c` k cíli.
- **Hotovo když:** `npm run test:integration` a `npm run check` projdou.

### Vlna E

#### Ú15 `e2e`: akceptační scénář v prohlížeči
- **Soubory:** `e2e/m12.spec.ts` (nový); pomocné funkce smí sdílet přes `e2e/helpers.ts` (vznikl v M11).
- **Scénář** (OCCT a planegcs v prohlížeči, česky, prvky přes role a přístupné názvy; plátno přes jeho rámeček a souřadnice kliknutí relativně ke středu – prázdná scéna má po vstupu do skici počátek ve středu plátna):
  1. Nový dokument → tlačítko „Skica“ → v liště je „Úsečka“ a „Obdélník“, „Kvádr“ není; panel skici je vidět.
  2. „Obdélník“ → klik do středu plátna (snap na počátek) → klik na `střed + (120, −80)` px → panel „Stupně volnosti: 2“.
  3. „Kóta“ → klik na `střed + (60, 0)` (spodní hrana) → klik na `střed + (120, −40)` (pravá hrana) → panel „Plně určeno“, v panelu pole „Vzdálenost 1“ a „Vzdálenost 2“.
  4. Pole „Vzdálenost 1“: zapamatovat hodnotu, vyplnit dvojnásobek, Enter → po přepočtu má pole novou hodnotu a panel dál „Plně určeno“.
  5. „Hotovo“ → v Timeline „Skica 1“, žádná chyba („Chyby:“ není), v liště zase „Kvádr“.
  6. „Zpět“ → „Skica 1“ zmizí; „Znovu“ → je zpět; po uložení (zelená tečka) reload → „Skica 1“ je v Timeline; dvojklik na ni → režim skici s „Plně určeno“; „Zrušit skicu“ → režim modelování.
  7. Konzole bez chyb a bez výpisů řešiče (pokud fixtura M10 hlídá konzoli, platí i tady).
- **Hotovo když:** `npm run test:e2e` projde v Chrome i WebKit; `npm run check`, `npm run build` zelené.

### Vlna F

#### Ú16 Hlavní sezení
- Zkontrolovat kód Ú1–Ú15 proti specifikacím, propsat odchylky (12, 02, 03, 06, 07, 09, 10, 11), převést otázky implementátorů na otázky ve vaultu.
- Zkontrolovat, že `any` je jen v `src/solver-planegcs/planegcs-module.ts` (okomentované), a že `Curve2` a `ProfileCurve` se shodují bez převodu.
- `architecture-reviewer` (hlavně: `interaction` neimportuje `features/*`, `sketch` jen `core`, `solver-planegcs` jen `app`), oprava nálezů, retrospektiva, poznatky (kandidáti: planární graf a tečné hrany; souběh asynchronního tažení; kresba z dat vs. přes jádro), `/milnik konec M12`, commit.

- [x] Ú16a Oprava nálezů revize (zábrany editace v presenteru, úzké závislosti skicáře, lišta z akcí, statusKey)

## Co se naučíš

- Jak se ze soustavy vazeb stane numerický problém (stupně volnosti, redundance, konflikty) a proč se souřadnice ukládají až vyřešené (determinismus logu).
- Planární graf: polohrany, řazení hran kolem uzlu podle úhlu a křivosti, stěny a díry – a proč jméno oblasti z id hran přežije změnu kót.
- Kdy domén potřebuje vlastní modul (`sketch`) a proč režim aplikace patří do prezentační logiky, ne do pluginu.
- Asynchronní port v interaktivní smyčce: fronta příkazů a „poslední cíl vyhrává“ při tažení.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_Návrh (noční rychloakce), Pavel doplní._

**Co bylo jinak, než se čekalo**
- Spike planegcs před plánem odhalil, že balíček nemá použitelné typy (`.d.ts`) a že WASM modul má pevnou paměť. Proto adaptér s izolovaným `any` v `planegcs-module.ts` a řešič ve vlastním workeru, aby OOM nepoškodil hlavní vlákno ([[0016-planegcs-resic-vazeb|ADR 0016]]).
- R36 (žádné operace `sketch.*`, editace skici je `feature.setParams` přes `FeatureEditSession.setParams`) log zjednodušilo: celé skicování je jeden záznam a undo/redo nepotřebovalo nic nového ([[Q074 Operace skicáře v logu|Q074]]).
- Chybu `ToolManager` s aktivním nástrojem (přepnutí režimu při rozpracovaném nástroji) odhalily až nástroje skicáře – nástroje modelu ji neměly jak vyvolat.
- Revize našla logiku ve `.vue` (zábrany editace v Timeline a Prohlížeči, text stavu skici v `ui`), široké závislosti (skicář dostával celý `ViewportPort` a `ids`) a opsaný seznam vazeb v liště. Stejný typ nálezů jako po M11, takže kontrola kontraktů proti [[0010-prezentacni-model|ADR 0010]] a [[0011-programovani-proti-rozhranim|ADR 0011]] patří do kontrolního seznamu plánovače ([[Kontrolní seznam plánu proti ADR]]). Opraveno v Ú16a.
- E2E musel hledat tlačítka v rámci oblasti (lišta, panel), protože přístupná jména kolidovala (např. „Hotovo“, „Zrušit“, názvy vazeb v liště i v panelu).

**Co se osvědčilo**
- Spike před plánem: rizika knihovny (typy, paměť, výkon) byla známá dřív, než vznikly kontrakty.
- Paralelní vlny 0 a A–E: 16 úkolů, souběžné úkoly bez konfliktů ([[Paralelní implementace ve vlnách]]).
- Integrační test se skutečným řešičem v Node: chování planegcs (DoF, redundance, konflikty) ověřené deterministicky bez prohlížeče.

**Zúžení** (⚠ v [[Rozhodnutí noční rychloakce#M12 – Skicář]]): R39–R50 – snap bez vazby na křivku, oblasti bez dělení v průsečících, omezená sada vazeb a kót, kóty jen v panelu, bez undo uvnitř skicáře, skici přes tělesa, tažení jen bodu, rovina jen z Prohlížeče.
