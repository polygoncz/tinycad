---
type: milestone
status: done
order: 28
aliases:
  - M28
  - M28 Kóty
modules:
  - sketch
  - solver-planegcs
  - features
  - sketcher
  - render
  - ui
specs:
  - "[[12-skicar]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M24-realisticke-zobrazeni]]"
started: 2026-10-15
finished: 2026-10-15
tags:
  - milnik
created: 2026-10-15
updated: 2026-10-15
---
# M28 – Kóty

**Cíl:** jeden nástroj Kóta jako ve Fusionu: druh kóty určí výběr a poloha myši, kóta při vytváření visí na myši a vždy leží v rovině skici. Hotovou kótu jde přetáhnout a její poloha se ukládá.

**Specifikace:** [[12-skicar#Data (`sketch`)]], [[09-vykreslovani#Skici]], [[10-interakce#Nástroje a akce skicáře]], [[11-ui#Komponenty]]

**Navazuje na:** [[M27-oblouky-a-kruznice|M27]] (pořadí). Staví na kótách ve viewportu z [[M19.2-ux-backlog|M19.2]] (D4).

## Rozsah

Pavel 2026-10-15: „Kóty se mohou přetahovat podobně jako ve Fusion a vždy leží v rovině sketch.“ K novým druhům kót: „Jednička, ale zohlednit to také při vytváření kóty, ať je to intuitivní.“

Rozhodnutí v sezení 2026-10-15 (brainstorming):
- **Nové druhy kót:** vodorovná a svislá vzdálenost, zarovnaná vzdálenost (dnešní `distance`), vzdálenost bod–přímka, úhel mezi úsečkami (s volbou kvadrantu), průměr vs. poloměr.
- **Vytvoření:** po výběru entit kóta visí na myši; poloha myši volí druh (např. nad/pod úsečkou → vodorovná, vedle → svislá, ve směru úsečky → zarovnaná; u kružnice průměr/poloměr; u úhlu kvadrant) i umístění popisku. Klik ji položí a otevře editaci hodnoty. Vytvoření a pozdější přetažení sdílí jednu čistou funkci umístění.
- **Přetažení** hotové kóty mění jen polohu popisku (ne druh, kromě kvadrantu úhlu – rozhodne se ve spec). Poloha je 2D v rovině skici.
- Poloha kóty patří do dat skici (přežije uložení); jak přesně, je [[Q085 Poloha kóty v datech|Q085]].

Kontrakt: [[12-skicar#Kóty (M28)]].

## Úkoly

- [x] 0. Rozhodnout [[Q085 Poloha kóty v datech|Q085]], kontrakt ve spec 12
- [x] 1. `sketch`: nové druhy kót a `placement` v modelu, `parseSketchData`, `measure`, `dimensionFor`
- [x] 2. `solver-planegcs`: nové druhy kót
- [x] 3. `sketch`: `dimension-placement.ts` (`dimensionTarget`, `placeDimension`, `movePlacement`, `defaultPlacement`)
- [x] 4. `sketcher`: `SketchDimensionView` s `placement`, nástroj Kóta s kótou na myši, `moveDimension`/`endMoveDimension`
- [x] 5. `ui`: `dimensionLayout` z `placement`, nové druhy, tažení popisku, stupně u úhlu
- [x] 6. e2e `m28.spec.ts`, propsání do spec 10 a 11

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Kontrakt je v [[12-skicar#Kóty (M28)]]. Úkoly 2 a 3 na sobě nezávisí a mohou běžet souběžně.

### 1. Model a kontrola dat

- **Soubory:** `src/sketch/model.ts` (`DimensionKind`, nové členy `SketchConstraint`, typy `LinearPlacement`, `RadialPlacement`, `AngularPlacement`, `DimensionPlacement`, `DimensionConstraint`), `parse.ts`, `edit.ts` (`measure` všech druhů; `dimensionFor` dál vrací zarovnanou vzdálenost a poloměr – výběr druhu dělá úkol 3), `index.ts`.
- **Testy:** `test/unit/sketch/parse.test.ts`, `edit.test.ts` doplnit podle spec.
- **Hotovo když:** testy projdou a `npm run check` je zelený (vyčerpávající `switch` v adaptéru a v `sketcher` doplnit tak, aby nové druhy prošly typy – v adaptéru dočasně `'failed'`, opraví úkol 2).

### 2. Adaptér planegcs

- **Soubory:** `src/solver-planegcs/solve.ts`.
- **Testy:** `test/unit/solver-planegcs/solve.test.ts` (skutečný planegcs): každý druh drží hodnotu po tažení bodu, `hDistance` se znaménkem podle polohy, úhel ve všech čtyřech kombinacích příznaků, `diameter` u kružnice i oblouku, `placement` vrácený beze změny.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 3. Umístění kóty

- **Soubory:** nový `src/sketch/dimension-placement.ts`, `index.ts`.
- **Testy:** `test/unit/sketch/dimension-placement.test.ts` – tabulkové testy podle spec.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 4. Skicář

- **Soubory:** `src/sketcher/sketch-dimensions.ts` (pohled s `placement`, výchozí poloha, náhled), `sketch-tools/dimension-tool.ts` (cíl → kóta na myši → klik zapíše, Esc zruší), `sketch-session.ts` (`moveDimension(id, x, y)`, `endMoveDimension()`, náhled v `SketchState.dimensions`).
- **Testy:** `sketch-dimensions.test.ts`, `dimension-tool.test.ts`, `sketch-session.test.ts` (tažení bez řešiče, jeden zápis).
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 5. `ui`

- **Soubory:** `src/ui/sketch-dimensions.ts` (`dimensionLayout` z `placement`, úhel obloukem, `⌀`, `°`), `components/SketchDimensions.vue` (tah popisku → `moveDimension`, puštění → `endMoveDimension`, klik bez tahu = výběr), `SketchPanel.vue` (úhel ve stupních), i18n.
- **Testy:** `test/unit/ui/sketch-dimensions.test.ts`, test komponenty (tah vs. klik).
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 6. e2e a spec

- **Soubory:** `test/e2e/m28.spec.ts` (vodorovná kóta myší, přetažení, uložení a načtení polohy, dokument bez `placement`); úprava e2e M19.2 kót, pokud se změní poloha; [[10-interakce]] a [[11-ui]].
- **Hotovo když:** e2e projdou, `npm run check` je zelený, spec odpovídá kódu.

## Akceptační kritéria

- U úsečky dá jeden nástroj podle polohy myši vodorovnou, svislou i zarovnanou kótu; u kružnice průměr i poloměr; u dvou úseček úhel ve zvoleném kvadrantu.
- Přetažená kóta zůstane na místě po uložení a načtení dokumentu a po změně kótovaných rozměrů se posune s geometrií.
- Dokument z doby před M28 se načte a jeho kóty se kreslí na výchozím místě.

## Co se naučíš

- Jak CAD ukládá „měkká“ data (poloha popisku) vedle „tvrdých“ (hodnota vazby) a proč je relativní poloha robustnější.
- Úhlová vazba v řešiči a nejednoznačnost kvadrantu.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Souběžná stopa, [[Roadmapa#Souběžné stopy (pokus od M25)|pravidla]]: místo deníku sem zapisuje průběh; hlavní sezení ho při sloučení přenese do deníku.)_

**2026-10-15**
- Start M28 ve worktree stopy B. Úkol 1 (model, `parseSketchData`, `measure`) hotový. Do [[12-skicar#Kóty (M28)]] propsáno: `DimensionPlacement`, `DimensionConstraint`, příznaky úhlu jen `true`, kaskáda mazání nových kót, vzorec měření úhlu.
- Před úkolem 3 upřesněna spec: `dimensionTarget` pro všechny výběry, vzorce odvození polohy z kurzoru a **výchozí poloha v mm úměrná geometrii** (0,2 × hodnota, 1,25 × poloměr, 0,5 × kratší úsečka) místo pevných 24 px z M19.2 – čistá funkce v `sketch` nezná zoom. Ke schválení Pavlem.
- Úkoly 2 a 3 běžely souběžně (dva implementátoři v jednom worktree, disjunktní soubory); jediná kolize byl jeden běh `npm run check`, který chytil rozpracovaný test druhého. Do spec propsáno: orientace úhlu v adaptéru (úsečky v pořadí s kladným orientovaným úhlem), degenerované případy `movePlacement`, výchozí poloměr úhlové kóty nejméně 1 mm.
- Pavel schválil výchozí polohu v mm úměrnou geometrii a rozhodl, že u vodorovné/svislé úsečky osa s nulovou hodnotou ustoupí druhé (spec původně vracela `null` – kóta by nad svislou úsečkou zmizela). Upraveno v `dimension-placement.ts` s testy.
- Před úkoly 4 a 5 doplněn do spec kontrakt pohledu: `DimensionGeometry` (světové body kresby počítá `sketcher`, `ui` jen promítá), průběh výběru nástroje jako ve Fusionu, `previewDimension`, chování tahu.
- Úkol 4 hotový. Do spec propsáno: druhá entita, která s bodem netvoří cíl, začne vlastní cíl (jako M19.2); náhled zmizí už při volání `addConstraint`; `endMoveDimension` se zařadí za běžící zápis řešiče. Implementátor tentokrát psal testy až po kódu (ne TDD) – pokrytí je dobré, ale postup stojí za připomenutí v dalším zadání.
- Úkol 5 hotový (TDD). Logika tahu vs. kliku je v čisté `ui/dimension-drag.ts` (projekt nemá `@vue/test-utils`, komponenta jen předává události). Úhel ve stupních převádějí čisté funkce v `ui/sketch-dimensions.ts`. Přerušený tah (`pointercancel`) polohu zapíše.
- Kontrola po úkolu 5 našla chybu: `setDimension` přijal úhel ≥ π a data by pak neprošla `parseSketchData` (skica by zmizela). Opraveno v session s testem.
- **Pro hlavní sezení (mimo mou sekci vaultu):** `CLICK_TOLERANCE_PX` se přesunula do `interaction/constants.ts`, aby ji `ui` smělo použít (lint:deps); [[01-architektura]] ve výčtu obsahu `constants.ts` ji zatím nemá – doplnit při sloučení.
- Ruční test s Pavlem: „Kóty fungují super“, jen číslo přes kótovací čáru je nečitelné → čáry se kolem popisku přeruší (`withLabelGap` v `ui/sketch-dimensions.ts`, s testy).
- Úkol 6: `test/e2e/m28.spec.ts` (vodorovná kóta myší, tah, uložení a načtení polohy; dokument bez `placement` přes export → úprava JSON → import). Nástroj Kóta už kótu nepokládá prvním klikem a hrany obdélníku dostávají vodorovnou/svislou vzdálenost, proto upraveny `helpers.ts` (`drawDimensionedRectangle` pokládá kótu klikem vedle hrany) a m12, m13, m19-2-dimensions (názvy řádků „Vodorovná vzdálenost 1“). Celé e2e 108/108 (Chrome, WebKit). Propsáno do [[10-interakce]] a [[11-ui]].
- `architecture-reviewer`: žádné porušení hranic modulů ani prstenců. Opraveno: `CLICK_TOLERANCE_PX` všude z `interaction/constants.ts` (bez reexportu ze `select-tool.ts`); `isDimension` a `DIMENSION_KINDS` ze `sketch` místo `'value' in c` (vazba stopy C s polem `value` by se tiše stala kótou); `PLACEMENT_KIND` typovaný přes `DimensionKind` (nový druh kóty shodí typecheck); `defaultPlacement` u `pointLineDistance` k úsečce nulové délky bez NaN; spec 10/11 doplněna o `screenToRay` ve viewportu skicáře; rezervované id náhledu `'__preview'` zapsáno do spec 12. Nechal jsem a předkládám Pavlovi: převod stupňů a rozlišení tahu/kliku jsou v `ui` (podle spec 11 záměrně; revize navrhuje zvážit přesun do `sketcher` kvůli [[0010-prezentacni-model|ADR 0010]]); vektorové pomůcky jsou zdvojené mezi `sketch/dimension-placement.ts` a `sketcher/sketch-dimensions.ts`.
- **Pro sloučení:** konflikty čekám v `sketch-session.ts` a `SketchPanel.vue` (stopa A), v `model.ts`, `parse.ts`, `solve.ts` (stopa C, nové větve na stejných místech unie a `switch`), v `test/e2e/helpers.ts` (`drawDimensionedRectangle` teď pokládá kótu druhým klikem – e2e stop A a C, které ho volají, to dostanou zadarmo, ale vlastní kliky nástrojem Kóta se musí upravit) a v [[01-architektura]] (výčet `constants.ts`). Kód stopy A, který čte `row.value` nebo volá `setDimension`, musí u úhlu projít `toShownValue`/`fromShownValue`.

## Retrospektiva

- **Co bylo jinak, než se čekalo:** kontrakt ve spec 12 stačil na model a řešič, ale ne na umístění a kresbu: před úkoly 3–5 bylo potřeba dopsat vzorce odvození polohy z kurzoru, výchozí polohu (v mm, ne v px – čistá funkce nezná zoom), průběh výběru nástroje a typ `DimensionGeometry`. Kde jsem kontrakt dopsal předem, implementátor se nevracel s otázkami; kde ne (degenerované případy), vrátil přesné otázky.
- **Pavel při ručním testu** našel jedinou věc – číslo přeškrtnuté kótovací čárou. Jednotkové testy layoutu ji chytit nemohly, protože testovaly souřadnice, ne čitelnost. Ruční test před e2e se vyplatil.
- **Chyba nalezená kontrolou, ne testy:** `setDimension` přijal úhel ≥ π a data by pak neprošla `parseSketchData`. Invariant kontroly dat se musí hlídat i na všech místech zápisu, nejen při čtení.
- **Souběh dvou implementátorů v jednom worktree** (úkoly 2 a 3) fungoval: disjunktní soubory, jediný artefakt byl jeden běh `npm run check` s rozpracovaným testem druhého.
- **Obecné poznatky** (hlavní sezení je může přesunout do `70-poznatky/`): (1) uložená „měkká“ data zobrazení (poloha kóty) držet relativně ke geometrii a výchozí hodnotu úměrnou geometrii, ne pixelům; (2) neorientovaná hodnota v modelu + orientovaná vazba v řešiči → adaptér volí orientaci z aktuální geometrie, jinak řešič „překlopí“ řešení; (3) rozlišovat varianty unie podle `kind`, ne podle tvaru (`'value' in c`) – při souběžném přidávání variant se tvar může shodovat.
