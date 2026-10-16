---
type: question
status: answered
area: "[[12-skicar]]"
decide_by: "[[M29-spliny]]"
proposal: "Planegcs ponechat jako řešič vazeb; oblasti, křížení a tessellaci skici přesunout do OCCT v samostatném milníku po sérii M25–M29, dřív než přijde trim a offset."
decision: "2026-10-15: geometrie skici zůstává v TS. Znovuotevřeno 2026-10-16 před trimem a offsetem: celá geometrie skici (oblasti, křížení, průsečíky, offset) se přesune do OCCT v milníku M30 (ADR 0028); TS geometrie zůstane jen pro okamžité odpovědi pod kurzorem."
tags:
  - otazka
created: 2026-10-15
updated: 2026-10-15
---
# Q088 Geometrie skici v TypeScriptu nebo v OCCT

**Oblast:** [[12-skicar#Oblasti (profily)]], [[06-geometricke-jadro]], [[0017-modul-sketch-a-skicar|ADR 0017]] · **Rozhodnout do:** [[M29-spliny]]

## Otázka

Pavel 2026-10-15 (během souběžných stop): „Snaž se co nejvíce používat knihovnu OpenCascade.“ A dále: „Ten planegcs je možná fajn, ale bojím se toho, že až budeme dělat složitější výpočty přes OCCT, tak přijdou problémy.“

Skicář dnes počítá 2D geometrii sám v TypeScriptu: oblasti (`computeRegions`), průsečíky a detekci křížení, od [[M29-spliny|M29]] i spliny přes tessellaci. OCCT pak z oblastí staví plochy (`makeFace`). O téže topologii (co je smyčka, co se kříží) tak rozhodují dva geometrické motory s různými tolerancemi. Má geometrii skici převzít OCCT?

## Možnosti a návrh

Planegcs riziko není: vrací jen parametry (souřadnice, poloměry, řídicí body), ne topologii, a řešič vazeb pro 2D OCCT nemá. Riziko je v duplicitní 2D geometrii:
- TS a OCCT se můžou neshodnout u skoro tečných křivek nebo u splinu aproximovaného tessellací → `makeFace` selže nebo vytvoří neplatnou plochu.
- Každá další funkce skicáře (trim a dělení v průsečících, offset, převzetí hran tělesa, zaoblení ve skice) by duplicitu rozšířila; OCCT má `Geom2dAPI_InterCurveCurve` a `BOPAlgo`.

- a) **Geometrii skici do OCCT** v samostatném milníku po sérii: builder pošle hrany jádru, OCCT vrátí plochy oblastí se jmény (z historie operace) a obrysy pro kresbu; `interaction` bere oblasti z artefaktu. TS geometrie zůstane jen pro okamžité odpovědi bez stavby (snapper, náhledy, odhady pro řešič). Změna [[0017-modul-sketch-a-skicar|ADR 0017]].
- b) Totéž hned, stopa C (M29) by počkala.
- c) **Nechat TS geometrii**, OCCT maximálně v `kernel-occt`; riziko přijmout a řešit, až bude potřeba.

**Návrh:** a).

## Rozhodnutí

Pavel 2026-10-15: **c) nechat TS geometrii.**

- Skicář dál počítá oblasti, křížení a tessellaci v TypeScriptu; matematika B-spline je v `core/math` ([[Q087 Spline v řešiči a v jádře – zjištění z implementace|Q087]]).
- V `kernel-occt` se maximálně používá OCCT místo vlastní geometrie (např. `Geom_BSplineCurve` a `BRepBuilderAPI_MakeEdge` pro hrany splinu).
- Riziko neshody TS a OCCT je přijaté. Otázku je třeba **znovu otevřít před** ořezáním (trim), ekvidistantou (offset), převzetím hran tělesa do skici nebo zaoblením ve skice.

## Znovuotevření 2026-10-16

Pavel chce do skicáře trim, extend, split, zaoblení a sražení ve skice a offset ([[Roadmapa#Rozšíření skicáře II (M30–M37)]]), takže otázka se podle rozhodnutí výše otevřela znovu. Možnosti:
- **OCCT přes port jen pro nové operace:** průsečíky a offset počítá jádro, oblasti a křížení zůstanou v TS.
- **Vše v TypeScriptu:** analyticky úsečky a oblouky, spline přibližně přes tessellaci.
- **Celá geometrie do OCCT:** varianta a) výše.

Předpřipravený build má `Geom2dAPI_InterCurveCurve`, `Geom2d_OffsetCurve` a `BRepOffsetAPI_MakeOffset`. Nemá `ChFi2d_*` ani třídy fontů (`Font_BRepTextBuilder`).

**Rozhodnutí (Pavel 2026-10-16): celá geometrie skici do OCCT.** Oblasti, křížení, průsečíky a offset počítá jádro; přesun je samostatný milník [[M30-geometrie-skici-v-occt|M30]] před trimem. TS geometrie zůstane jen tam, kde je potřeba synchronní odpověď pod kurzorem (snapper, náhledy nástrojů). Zásady jsou v [[0028-geometrie-skici-v-jadre|ADR 0028]], hranice TS a OCCT upřesní [[Q092 Hranice geometrie skici v TS a v OCCT|Q092]].
