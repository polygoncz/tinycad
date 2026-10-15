---
type: milestone
status: todo
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
started:
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
- [ ] 1. `sketch`: `bspline.ts` (de Boor, derivace, tessellace) a `interpolateSpline`
- [ ] 2. `sketch`: entity `bspline` a `fitSpline`, `Curve2`, `parseSketchData`, `removeItems`, `curve2`
- [ ] 3. `sketch`: `computeRegions` se spliny
- [ ] 4. `solver-planegcs`: spliny a vazby na ně
- [ ] 5. `kernel`, `kernel-occt`: `ProfileCurve` `bspline`, `validateFaceInput`, `FakeKernel`, hrana v OCCT
- [ ] 6. Kresba: `SketchDrawingCurve` `polyline` (`interaction`, `render`), tessellace v `sketcher`
- [ ] 7. Integrační test skica se splinem → Vysunutí
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

- **Soubory:** `src/kernel/profile.ts`, `fake-kernel.ts`, `src/kernel-occt/face.ts` (hrana B-spline; nejdřív ověřit, které konstruktory `Geom2d_BSplineCurve`/`Geom_BSplineCurve` a pole `TColgp_Array1Of…` build skutečně exportuje).
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

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
