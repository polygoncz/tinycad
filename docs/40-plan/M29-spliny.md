---
type: milestone
status: doing
order: 29
aliases:
  - M29
  - M29 Spliny
modules:
  - sketch
  - solver-planegcs
  - features
  - kernel
  - kernel-occt
  - sketcher
  - render
specs:
  - "[[12-skicar]]"
  - "[[06-geometricke-jadro]]"
  - "[[09-vykreslovani]]"
depends_on:
  - "[[M28-koty]]"
started: 2026-10-15
finished:
tags:
  - milnik
created: 2026-10-15
updated: 2026-10-15
---
# M29 – Spliny

**Cíl:** skica umí kubické B-spline křivky, zadané přes řídicí body (NURBS) nebo přes body, kterými křivka prochází (fit point). Spliny se kreslí, táhnou, mají vazby a ohraničují oblasti pro Vysunutí a Rotaci.

**Specifikace:** [[12-skicar#Data (`sketch`)]], [[12-skicar#Oblasti (profily)]], [[12-skicar#Řešič vazeb]], [[06-geometricke-jadro]], [[09-vykreslovani#Skici]]

**Navazuje na:** [[M28-koty|M28]] (pořadí). Spliny jsou na konci série, protože jako jediné sahají přes všechny vrstvy až do jádra; snapper ([[M26-snapper-a-auto-vazby|M26]]) a glyfy ([[M25-glyfy-vazeb|M25]]) je pak jen rozšíří o nový druh křivky.

## Rozsah

Pavel 2026-10-15: „Je potřeba přidat další typy křivek: … NURBS, kubickou křivku.“ Upřesnění v sezení: kubická křivka = **spline přes body** (Fusion *Fit Point Spline*, Onshape *Spline*), NURBS = spline přes řídicí body (Fusion *Control Point Spline*).

Rozhodnutí v sezení 2026-10-15 (brainstorming):
- **Jedna matematika, dva druhy entit** (upřesněno při kontraktu): `bspline` (řídicí body jsou body skici) a `fitSpline` (fit body jsou body skici, řídicí body jsou vyřešené souřadnice v entitě, protože regenerace řešič nevolá). Pro oblasti a jádro jedna varianta `Curve2`/`ProfileCurve` `bspline`.
- **Řešič:** planegcs `bspline` (+ `point_on_bspline`, `bspline_control_point`); jak držet fit-point spline, je [[Q086 Spline přes body v řešiči|Q086]].
- **Oblasti:** křížení a plochy splinů přes aproximaci polyline s tolerancí; jména oblastí z id křivek zůstávají ([[08-topologicke-pojmenovani|08]]).
- **Jádro:** `ProfileCurve` dostane variantu B-spline, `kernel-occt` ji postaví přes `Geom2d_BSplineCurve` (předpřipravený build ji má, ověřeno 2026-10-15 v typech), `FakeKernel` aproximací.
- **Kresba:** tessellace splinu v `sketcher` do nové varianty kresby `polyline`, kterou `render` kreslí a pickuje jako řadu úseček.

Kontrakt: [[12-skicar#Spliny (M29)]].

## Úkoly

- [x] 0. Rozhodnout [[Q086 Spline přes body v řešiči|Q086]], kontrakt ve spec 12
- [x] 1. `sketch`: `bspline.ts` (de Boor, derivace, tessellace) a `interpolateSpline`
- [x] 2. `sketch`: entity `bspline` a `fitSpline`, `Curve2`, `parseSketchData`, `removeItems`, `curve2`
- [x] 3. `sketch`: `computeRegions` se spliny
- [x] 4. `solver-planegcs`: spliny a vazby na ně
- [x] 5. `kernel`, `kernel-occt`: `ProfileCurve` `bspline`, `validateFaceInput`, `FakeKernel`, hrana v OCCT
- [x] 6. Kresba: `SketchDrawingCurve` `polyline` (`interaction`, `render`), tessellace v `sketcher`
- [x] 7. Integrační test skica se splinem → Vysunutí
- [ ] 8. Nástroje splinu (až po sloučení M26), e2e `m29.spec.ts`, propsání do spec 06, 09, 10, 11

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Kontrakt je v [[12-skicar#Spliny (M29)]]. Pořadí: 1 → 2 → (3, 4, 5, 6 souběžně) → 7; úkol 8 až po sloučení stopy A (M25–M27) do `main`.

### 1. Matematika B-spline

- **Soubory:** nový `src/sketch/bspline.ts`, `index.ts`.
- **Testy:** `test/unit/sketch/bspline.test.ts` – hodnoty a derivace proti ručně spočítaným (lineární, kvadratický, kubický), krajní body = krajní řídicí body, tessellace v toleranci, `interpolateSpline` prochází body pro 2, 3, 4 a 7 bodů, nekonečné vstupy odmítne.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 2. Entity

- **Soubory:** `src/sketch/model.ts`, `geometry.ts` (`Curve2` `bspline`, `curve2` pro oba druhy), `parse.ts`, `edit.ts` (`removeItems`; `constraintFor` nabídne `tangent` úsečka–spline jen na konci, ostatní s splinem `null`), `index.ts`. Vyčerpávající `switch` jinde (regions, adaptér, kresba) doplnit tak, aby prošly typy: regions dočasně spline ignorují, adaptér vrátí `'failed'`, kresba nekreslí – opraví úkoly 3, 4, 6.
- **Testy:** `parse.test.ts`, `edit.test.ts`, `geometry.test.ts` podle spec.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 3. Oblasti

- **Soubory:** `src/sketch/regions.ts`.
- **Testy:** `test/unit/sketch/regions.test.ts` – obdélník se stranou ze splinu, uzavřený spline, spline křížící úsečku, díra ze splinu, stabilita jména.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 4. Řešič

- **Soubory:** `src/solver-planegcs/solve.ts`.
- **Testy:** `solve.test.ts` (skutečný planegcs) podle spec; ověřit, že `point_on_bspline` s pevným parametrem drží fit bod při tažení.
- **Hotovo když:** testy projdou a `npm run check` je zelený. Pokud planegcs něco z kontraktu neumí, vrátit otázku, ne obcházet.

### 5. Jádro

- **Soubory:** `src/kernel/profile.ts`, `fake-kernel.ts`, `src/features/sketch/builder.ts` (odstranit dočasné `as ProfileLoop` z úkolu 2), `src/kernel-occt/face.ts` (hrana B-spline; nejdřív ověřit, které konstruktory `Geom2d_BSplineCurve`/`Geom_BSplineCurve` a pole `TColgp_Array1Of…` build skutečně exportuje).
- **Testy:** `test/unit/kernel/profile.test.ts`, kontraktové testy jádra (plocha profilu se splinem ≈ plocha z tessellace v obou implementacích, role `edge:<id>`).
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 6. Kresba

- **Soubory:** `src/interaction/viewport-port.ts` (`SketchDrawingCurve` `polyline`), `src/render/sketch-drawing.ts` a `sketch-pick.ts`, `src/sketcher/sketch-drawing.ts` (spline → `polyline`, řídicí lomená čára `bspline` jako `construction`).
- **Testy:** `test/unit/render/sketch-drawing.test.ts`, `sketch-pick.test.ts`, `test/unit/sketcher/sketch-drawing.test.ts`.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 7. Integrační test

- **Soubory:** `test/integration/sketch-spline.test.ts` – skica s profilem z úseček a splinu (data, ne nástroj) → regenerace s OCCT → Vysunutí, boční plocha `face:side:<id splinu>`.
- **Hotovo když:** `npm run test:integration` a `npm run check` jsou zelené.

### 8. Nástroje (po sloučení M26)

- Upřesní se po sloučení stopy A: nástroje `sketch.spline` a `sketch.fitSpline` nad snapperem z M26, glyfy a snapy pro spline (kotvy, bod na splinu).

## Akceptační kritéria

- Uzavřený profil z úseček a splinu jde vysunout; boční plocha splinu má jméno `face:side:<id>`.
- Spline přes body prochází zadanými body i po tažení jednoho z nich.
- Křížící se spline a úsečka hlásí `crossing` jako u ostatních křivek.

## Co se naučíš

- B-spline a NURBS: uzlový vektor, řídicí body, de Boorův algoritmus, interpolace bodů.
- Jak se volná křivka mapuje mezi řešičem vazeb (planegcs) a B-rep jádrem (OCCT).

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Souběžná stopa, [[Roadmapa#Souběžné stopy (pokus od M25)|pravidla]]: místo deníku sem zapisuje průběh; hlavní sezení ho při sloučení přenese do deníku.)_

**2026-10-15**
- Úkol 1: matematika B-spline (de Boor přes derivace bázových funkcí, Piegl–Tiller A2.1/A2.3/A3.2; adaptivní tessellace po intervalech uzlů; globální interpolace). Spec upřesněna: signatury, `RangeError`, druhá derivace pro křivost, minimální a maximální hloubka půlení.
- Úkol 2: entity `bspline` a `fitSpline`, kontrola dat, `constraintFor`, `removeItems`, `curve2`. Spec upřesněna: pravidla clamped uzlů, tečnost úsečka–spline jen se sdíleným koncovým bodem (pozná se z id). Dočasné větve `// M29: … (task N)` v regions, adaptéru, kresbě a `as ProfileLoop` v builderu skici.
- Úkol 4 se zastavil: planegcs `tangent_at_bspline_knot` na krajním uzlu nefunguje a wrapper přidá ke splinu s vazbou 4 nepoužité proměnné (o 4 vyšší `dof`). Založena [[Q087 Spline v řešiči a v jádře – zjištění z implementace|Q087]].
- Q087 bod 3 – Pavel: matematika B-spline do `core/math` (jmenný prostor `bspline`), kvůli `FakeKernel`. Propsáno do spec 12 a 02.
- Tolerance tessellace splinu pro oblasti `1e-4 · max(1, |souřadnice|)` (s `tol` 1e-9 by vznikly desítky tisíc úseků).
- Úkol 3: oblasti se spliny (tessellace nese směr průchodu, obrácená polohrana obrací spline). Otevřený bod: samokřížení splinu → Q087 bod 4.
- Q087 body 1 a 2 – Pavel: tečnost na konci přes `point_on_line` druhého řídicího bodu, `dof` −4 za spline s vazbou planegcs, `bspline` bez primitivu. Propsáno do spec 12. Bod 4 – Pavel: samokřížení splinu = `crossing`. Q087 rozhodnutá celá.
- Úkol 4: řešič se spliny podle Q087 (`fitSpline` jako planegcs `bspline` se skrytými řídicími body, `point_on_bspline` na pevných parametrech, tečnost přes `point_on_line_pl`, `dof` −4, hlídací test surového planegcs). Otevřené pro úkol 8: id splinu v `conflicting` není id vazby.
- Úkol 6: kresba `polyline` (render ji rozloží na úseky s jedním id, picking beze změny), řídicí lomená čára `__poles:<id>` jako `construction`. Pro úkol 8: lomená čára stíní spline při pickingu.
- Úkol 5: matematika přesunuta do `core/math/bspline.ts`, `ProfileCurve` `bspline`, validace (sevřené uzly, násobnosti – přísněji než původní zadání, aby OCCT nedostal vstup, na kterém konstruktor vyhodí výjimku), `FakeKernel` z tessellace, hrana v OCCT. Propsáno do spec 06.
- Úkol 7: integrační `sketch-spline.test.ts` (OCCT + planegcs): vysunutí profilu s `bspline` i `fitSpline`, `face:side:<id>`, objem; tažení fit bodu přes `SketchSession` → spline prochází fit body → regenerace; křížení → varování.
- Pokyn Pavla (Q088 Geometrie skici v TypeScriptu nebo v OCCT, na `main`; wikilink doplní hlavní sezení při sloučení, ve větvi stopy by neprošel `lint:vault`): v `kernel-occt` maximum z OCCT (hrana `Geom_BSplineCurve` + `BRepBuilderAPI_MakeEdge`, kontroly přes BRepCheck/ShapeAnalysis), geometrie skici zůstává v TypeScriptu.
- Ověřeno v typech buildu OCCT: `Geom_BSplineCurve(NCollection_Array1_gp_Pnt, …_double, …_int, degree)` a `BRepBuilderAPI_MakeEdge(Geom_Curve)`; hrana splinu se staví ve 3D jako ostatní hrany profilu.
- Architektonická revize úkolů 1–7: bez porušení ADR. Opraveno: spline bez tessellace v oblastech → `assert` místo tichého `?? []`; tolerance tessellace jedna konstanta `SPLINE_TOLERANCE` ze `sketch` pro oblasti i kresbu. Otevřené pro úkol 8 / sloučení: id splinu v `SolveResult.conflicting` je id entity přetypované na `SketchConstraintId` – rozšířit kontrakt `SolveResult` (sdílený se stopou B), proto ne ve stopě. Vědomá výjimka z pravidel stopy: změna spec 02 (B-spline v `core`), schválil Pavel v Q087.
- **Očekávané konflikty při sloučení:** `src/sketch/parse.ts` (`constraintValid`: `refTargets` a předčasné `return true` pro tečnost úsečka–spline – po stopě B ověřit, že neobchází nové kontroly kót), `src/sketch/model.ts` (komentář u `tangent` uvnitř unie `SketchConstraint`, kterou mění stopa B), `src/sketch/edit.ts` (`withoutConstruction`, `curvePoints` – větve vedle větví stopy A), `src/solver-planegcs/solve.ts` (`dof`, smyčka v `toPrimitives` vedle `constraintPrimitives` stopy B), `src/sketch/index.ts`, `src/interaction/viewport-port.ts` (unie `SketchDrawingCurve`, glyfy stopy A).
- Stav: úkoly 1–7 hotové, `npm run check` (5893 unit, 39 integračních) zelený. Úkol 8 čeká na sloučení M26.

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
