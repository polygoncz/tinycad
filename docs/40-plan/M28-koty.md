---
type: milestone
status: todo
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
started:
finished:
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
- [ ] 1. `sketch`: nové druhy kót a `placement` v modelu, `parseSketchData`, `measure`, `dimensionFor`
- [ ] 2. `solver-planegcs`: nové druhy kót
- [ ] 3. `sketch`: `dimension-placement.ts` (`dimensionTarget`, `placeDimension`, `movePlacement`, `defaultPlacement`)
- [ ] 4. `sketcher`: `SketchDimensionView` s `placement`, nástroj Kóta s kótou na myši, `moveDimension`/`endMoveDimension`
- [ ] 5. `ui`: `dimensionLayout` z `placement`, nové druhy, tažení popisku, stupně u úhlu
- [ ] 6. e2e `m28.spec.ts`, propsání do spec 10 a 11

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

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
