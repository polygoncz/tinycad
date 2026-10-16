---
type: milestone
status: doing
order: 30
aliases:
  - M30
  - M30 Geometrie skici v OCCT
modules:
  - kernel
  - kernel-occt
  - sketch
  - features
  - regen
  - interaction
  - sketcher
  - app
specs:
  - "[[12-skicar]]"
  - "[[06-geometricke-jadro]]"
  - "[[07-regenerace]]"
  - "[[10-interakce]]"
depends_on:
  - "[[M29-spliny]]"
started: 2026-10-16
finished:
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M30 – Geometrie skici v OCCT
**Cíl:** oblasti, křížení a průsečíky křivek skici počítá jádro OCCT místo TypeScriptu ([[0028-geometrie-skici-v-jadre|ADR 0028]]). Uživatel nic nového nevidí; skici, oblasti, vysunutí a jména ploch fungují stejně, jen nad jednou geometrií. Je to základ pro trim, zaoblení a offset.

**Specifikace:** [[12-skicar#Geometrie skici v jádře (M30)]], [[06-geometricke-jadro#Stav po M30]], [[12-skicar#Oblasti (profily)]], [[06-geometricke-jadro]], [[07-regenerace#Builder featury]], [[10-interakce#Kresba skici]]

**Navazuje na:** [[M29-spliny|M29]]. Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]]. První v stopě A, protože na něm stojí [[M33-trim-extend-split|M33]], [[M34-zaobleni-a-srazeni-ve-skice|M34]], [[M35-offset|M35]] a [[M37-text-ve-skice|M37]].

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

Pavel v [[Q088 Geometrie skici v TypeScriptu nebo v OCCT#Znovuotevření 2026-10-16|Q088]] zvolil přesun **celé** geometrie skici do OCCT, ne jen nových operací.

Rozhodnutí v sezení 2026-10-16 ([[Q092 Hranice geometrie skici v TS a v OCCT|Q092]]):
- Artefakt skici nese **obrysy oblastí** z jádra; kresba skic z regenerace je převezme. Editovaná skica oblasti nekreslí (beze změny), takže nic nezaostává.
- Snapper a náhledy nástrojů zůstávají v TS. Skicář volá jádro přes úzký port `SketchGeometry` v `sketch`, který implementuje `app`; v M30 vznikne prázdný a předaný, metody přidá M33.
- TS algoritmus oblastí se přesune do `FakeKernel`; jeho testy se stanou kontraktovou sadou jádra.
- **Chování beze změny:** křížení = žádné oblasti. Oblasti z křížících se křivek: [[Q093 Oblasti z křížících se křivek|Q093]] (M33).

## Úkoly

- [x] Rozhodnout [[Q092 Hranice geometrie skici v TS a v OCCT|Q092]] a dopsat kontrakt do spec 06 a 12.
- [x] Port `profileRegions`, typy a `FakeKernel` s přesunutým algoritmem.
- [x] `kernel-occt`: oblasti v OCCT (po prototypu).
- [x] `regionCurves`, builder skici a artefakt s obrysy.
- [x] Kresba oblastí z artefaktu a port `SketchGeometry`.
- [x] Spec podle skutečnosti, dodatek k [[0017-modul-sketch-a-skicar|ADR 0017]], regresní testy.

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Kontrakt je v [[12-skicar#Geometrie skici v jádře (M30)]] a [[06-geometricke-jadro#Stav po M30]]. Úkoly 2 a 3 na sobě nezávisí (oba stojí na 1) a mohou běžet souběžně.

### 1. Port, typy a FakeKernel

- **Soubory:** `src/kernel/profile.ts` (`ProfileRegion`, `ProfileRegions`, kontrola vstupu `profileRegions` – sdílí čtení křivek s `parseFaceInput`, ale nulová délka se vynechá a `id` je povinné a unikátní), `kernel.ts` (`SketchOps.profileRegions`), nový `kernel/fake-regions.ts` (přesun `src/sketch/regions.ts` přes `git mv`, aby zůstala historie; vstup `ProfileCurve[]` místo `SketchData`), `fake-kernel.ts`, `testing.ts` (kontraktová sada), `index.ts`; průchozí metoda v `kernel-occt` (`client.ts`, `protocol.ts`, `worker-impl.ts`, `occt-kernel-impl.ts` **dočasně** `'operation-failed'` „not implemented“), `regen/tracking-kernel.ts`, `app/testing.ts`.
- **Testy:** `test/unit/sketch/regions.test.ts` se přesune do kontraktové sady `describeGeometryKernelContract` (případy beze změny, vstup přes `regionCurves`-ekvivalent v testu); nové případy kontroly vstupu (chybějící/duplicitní `id`, nekonečné číslo, nulová délka se vynechá). Kontraktová sada pro OCCT má případy `profileRegions` dočasně přeskočené (jeden `skipIf` s komentářem „do úkolu 2“).
- **Hotovo když:** kontraktová sada projde s fake, `npm run check` je zelený. `sketch/regions.ts` v tomto úkolu ještě zůstává kopií pro builder a kresbu (smaže ho úkol 4).

### 2. Oblasti v `kernel-occt`

- **Prototyp nejdřív** ([[Primitivum knihovny ověř prototypem před kontraktem]]): předpřipravený build nemá `BOPAlgo_Builder` ani `BOPAlgo_Tools`. Ověřit dvě cesty a vybrat jednu, výsledek zapsat do *Průběhu stopy* a do spec 06 (adaptér):
  - a) `BRepAlgoAPI_Splitter`: velká rovinná plocha rozdělená všemi hranami → plochy; zahodit plochy, které se dotýkají okraje; jména z historie (`Modified` hran → id). Křížení zvlášť (b).
  - b) křížení přes `Geom2dAPI_InterCurveCurve` po dvojicích (průsečík mimo sdílený koncový uzel → `crossing`), stěny vlastním sestavením z hran (jako fake) a díry/plochy přes `BRepBuilderAPI_MakeFace` + `BRepGProp`.
- **Soubory:** nový `src/kernel-occt/regions.ts`, `occt-kernel-impl.ts` (napojení), `face.ts` (sdílená stavba hrany z `ProfileCurve`, pokud je potřeba ji vytknout).
- **Testy:** kontraktová sada s OCCT (přeskočení z úkolu 1 pryč) a test adaptéru: obdélník s kruhovou dírou, dvě sousední oblasti se společnou hranou, spline jako strana, křížení dvou úseček, dotyk konce s vnitřkem, spline křížící sám sebe.
- **Hotovo když:** kontraktová sada projde s fake i OCCT, `npm run check` a `npm run test:integration` zelené.

### 3. Křivky oblastí, builder a artefakt

- **Soubory:** `src/sketch/geometry.ts` (`regionCurves`, typ `SketchRegion` přesunutý z `regions.ts`), `index.ts` (export `regionCurves`, `SketchRegion`; `computeRegions` a `RegionsResult` zatím zůstávají), `src/features/sketch/builder.ts` (`profileRegions` místo `computeRegions`), `src/regen/state.ts` (`SketchArtifact.outlines`).
- **Testy:** `test/unit/sketch/geometry.test.ts` (`regionCurves`: konstrukční křivky ne, id u všech, spline jako `bspline`); test builderu s `FakeKernel` (`callCount('profileRegions') === 1`, `outlines` ve stejném pořadí a se stejnými jmény jako `regions`, křížení → varování a žádné plochy).
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 4. Kresba z artefaktu, port `SketchGeometry`, úklid

- **Soubory:** `src/sketcher/sketch-drawing.ts` (`artifactDrawing(plane, entities, regions)` bez výpočtu), `src/app/regen-pipeline.ts` (předá `artifact.outlines`), nový `src/sketch/geometry-port.ts` (`SketchGeometry` bez metod) a export, `src/sketcher/sketch-session.ts` a `sketch-editor.ts` (závislost `geometry` vedle `solver`), kompoziční kořen v `app` (implementace nad klientem jádra, zatím prázdná); smazat `src/sketch/regions.ts` a exporty `computeRegions`, `RegionsResult`.
- **Testy:** `test/unit/sketcher/sketch-drawing.test.ts` (oblasti z argumentu, pořadí, polygony z obrysů včetně splinu), testy `app` s fake jádrem (skica z regenerace má vyplněné oblasti).
- **Hotovo když:** testy projdou, `npm run check` je zelený a v `src/` nic nevolá `computeRegions`.

### 5. Regrese, spec a ADR

- **Soubory:** integrační test „dokument z M29 (skica s dírou, splinem, vysunutím) dá po M30 stejná jména oblastí a ploch“ v `test/integration/`; e2e beze změny musí projít; spec 06 (adaptér: zvolená cesta z úkolu 2), spec 12 (*Oblasti (profily)* odkáže na jádro), dodatek k [[0017-modul-sketch-a-skicar|ADR 0017]] odkazem na [[0028-geometrie-skici-v-jadre|ADR 0028]].
- **Hotovo když:** `npm run check`, `npm run test:integration` a `npm run test:e2e` zelené, spec odpovídá kódu.

## Akceptační kritéria

- Všechny dosavadní testy oblastí (jména, díry, křížení, spliny) projdou nad jádrem.
- Dokumenty z předchozích verzí dají stejné oblasti a stejná topologická jména ploch.
- E2e: skica s otvorem a splinem → vysunutí funguje jako dřív.

## Co se naučíš

Jak přesunout výpočet za port bez změny chování (kontraktové testy jako záchranná síť) a jak v OCCT z 2D hran postavit stěny s dírami, včetně přenesení jmen přes historii operace.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Zapisuje stopa: rozhodnutí s Pavlem, odchylky od plánu, výsledky testů. Hlavní sezení to při sloučení přenese do deníku.)_

**2026-10-16 – prototyp OCCT cesty (úkol 2).** 16 případů z kontraktové sady + měření výkonu, obě cesty.
- Build váže `BRepAlgoAPI_Splitter` (s historií), `Geom2dAPI_InterCurveCurve` (body průsečíků, **bez parametrů**; i samoprůsečíky jedné křivky), 2D křivky přes `GC_MakeSegment2d`, `GC_MakeArcOfCircle2d`, `Geom2d_BSplineCurve`. Neváže `BOPAlgo_*`, `IntAna2d`, `GCE2d`, klasifikátory bodu v ploše (`BRepClass_FaceClassifier`, `BRepTopAdaptor_FClass2d`), `ShapeAnalysis_*`, `BRepTools_WireExplorer`. Přetížení konstruktorů bez sufixů `_1`.
- **a) Splitter:** nepozná spline křížící sám sebe (vznikne nesmyslná plocha), visící hranu nechá v ploše jako INTERNAL, trojúhelník dotýkající se obdélníku jen rohem udělá dírou (TS: 0 děr). Jména z historie a ruční řetězení drátů.
- **b) `InterCurveCurve` + vlastní polohrany:** všech 16 případů jako TS (jména, díry, křížení vč. samoprůsečíku splinu). Plocha znaménkovou Greenovou větou (Gauss nad `EvalD1`) – `MakeFace` + `BRepGProp` dává u sevřené smyčky špatný obsah (104 místo 96). Bod v oblasti paritou paprsku přes `InterCurveCurve`. S předfiltrem obálek rychlejší než TS (1860 křivek: 25 ms vs. TS 392 ms, Splitter 100 ms).
- **Návrh:** cesta b. Splitter se hodí až pro [[Q093 Oblasti z křížících se křivek|Q093]] (dělení křivek v průsečících a jména kusů z historie).
- **Pavel 2026-10-16:** „Souhlasím s cestou b (Geom2dAPI_InterCurveCurve + vlastní polohrany, plocha Greenovou větou).“

**2026-10-16 – úkol 1 hotový** (commit `dc55727`). Upřesnění spec 06 z implementace:
- Tolerance plochy splinu v kontraktové sadě 1e-3 místo 1e-4: fake spline tessellací s tolerancí `1e-4 · měřítko` a chyba plochy vychází až 3·10⁻⁴. Kontrakt výsledku se nemění, jen přísnost porovnání.
- Kontrolu vstupu sdílí obě implementace přes `parseProfileRegionsInput` z `kernel` (vzor `validateFaceInput`); spline nulové délky = všechny póly v jednom bodě; `profileRegions(null)` → `'invalid-input'`; obrácení splinu obecně `a + b − k`.
- Oblouk ze skici s nestejnými poloměry teď `profileRegions` odmítne (dřív až `makeFace`) → featura skici chybná jako dřív, jen o krok dřív. Řešič drží poloměry s přesností mnohem lepší než `1e-7`, prakticky nenastane.
- `kernel/vec2.ts` je kopie 2D pomůcek ze `sketch/vec2.ts` (kernel nesmí importovat sketch); kandidát na přesun do `core/math` – nechávám na revizi.

**2026-10-16 – úkoly 2 a 3 hotové** (souběžně v izolovaných worktree, sloučené jedním commitem).
- Úkol 2: `kernel-occt/regions.ts` cestou b. Křížení přes `Geom2dAPI_InterCurveCurve` jen pro dvojice s překrytými obálkami (řazení podle x), samoprůsečík splinu zvlášť; plocha Greenovou větou (5bodový Gauss–Legendre nad `D1`); bod v oblasti paritou paprsku pod iracionálním úhlem, při průchodu uzlem nebo tečném dotyku další směr (zlatý úhel, nejvýš 8 pokusů); smyčky výsledku ze vstupních křivek, ne z OCCT. Tolerance `1e-7 · max(1, |souřadnice|)` (fake slučuje uzly při `1e-9`; kontrakt hranu tolerance nezkouší). Mřížka 840 úseček 49 ms, 1860 úseček 110 ms. Kontraktová sada projde s fake i OCCT (přímo i přes worker).
- Úkol 3: `regionCurves` filtruje vyčerpávajícím `switch` (ne „vše kromě bodu“), aby nová entita stopy B nebo C musela rozhodnout, jestli ohraničuje oblasti – typový predikát typecheck nekontroluje. Plán tvrdil, že úkol 3 je na úkolu 2 nezávislý; ve skutečnosti integrační testy (součást `npm run check`) bez OCCT `profileRegions` padají, proto sloučení až po obou.

**2026-10-16 – úkol 4 hotový.** `artifactDrawing` bere oblasti z `artifact.outlines`, `sketch/regions.ts` a jeho testy smazané (`computeRegions` v `src/` nikde). `SPLINE_TOLERANCE` přešla do `sketch/geometry.ts`. Port `SketchGeometry` je prázdné rozhraní; `app/sketch-geometry.ts` ho zatím vyrábí bez parametrů (klient jádra by v M30 byl nepoužitý argument) – M33 přidá parametr a metody. Port se předává `createSketchEditor` → `openSketchSession` vedle `solver`.

**2026-10-16 – úkol 5 a architektonická revize.**
- Regresní test `test/integration/sketch-regions-regression.test.ts` (obdélník se splinem jako stranou a kruhovou dírou, vysunutí). Literály změřené na commitu před M30 (`929fa1a`): jména oblastí, díry a všech 7 jmen ploch tělesa beze změny. Obsah oblasti se splinem je po M30 **přesnější** (851,0602 místo 851,0192, ověřeno nezávislou integrací) – dřív se počítal z tessellace; test porovnává relativně 1e-4.
- Spec 06 (nová sekce *Oblasti skici v adaptéru (M30)*), 07 (`SketchArtifact.outlines`), 08 (zdroj `id` křivek), 10 (`artifactDrawing` s oblastmi z argumentu), 12 (builder, *Oblasti (profily)*, testy, skutečnost M30), dodatek ADR 0017, doplněk ADR 0028.
- Revize `architecture-reviewer`: bez porušení ADR 0008–0011. Opraveno: obrysy v artefaktu se hluboce zmrazí v builderu (přes worker přijdou po `postMessage` měnitelné; nový test), zastaralé zmínky `computeRegions` ve spec 08, 10 a komentáři `sketch`.
- **Pro hlavní sezení (návrh, neděláno):** 2D vektorové pomůcky jsou třikrát (`sketch/vec2.ts`, kopie `kernel/vec2.ts`, `dist` v `kernel-occt/regions.ts`). Revize navrhuje `core/math/vec2.ts` (jmenný prostor `vec2` vedle `vec3`); to je nový veřejný export `core` a změna spec 02, mimo vlastnictví stopy A – vhodné po sloučení všech stop.

## Retrospektiva
