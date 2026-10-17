---
type: milestone
status: doing
order: 35
aliases:
  - M35
  - M35 Offset
modules:
  - kernel
  - kernel-occt
  - sketch
  - sketcher
specs:
  - "[[12-skicar]]"
  - "[[06-geometricke-jadro]]"
depends_on:
  - "[[M30-geometrie-skici-v-occt]]"
started: 2026-10-17
finished:
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M35 – Offset
**Cíl:** nástroj Odsazení (offset): z vybrané křivky nebo řetězce křivek vznikne ekvidistanta ve zvolené vzdálenosti, počítaná v OCCT.

**Specifikace:** [[12-skicar#Offset (M35)]], [[06-geometricke-jadro#Stav po M35]], [[12-skicar#Sdílené kontrakty série II]]

**Navazuje na:** [[M30-geometrie-skici-v-occt|M30]] (stopa A, po [[M34-zaobleni-a-srazeni-ve-skice|M34]]). Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]].

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

## Rozhodnutí při startu (Pavel 2026-10-17)

- [[Q095 Asociativita offsetu ve skice|Q095]]: **asociativní vazba `offset`** s jednou kótou `d` pro úsečky, oblouky a kružnice; offset splinu zapečený.
- Rohy offsetu ven **ostré** (prodloužení do průsečíku).
- Klik vybere **celý řetězec** (přes body, kde se potkávají právě dvě křivky).
- Dispečer: offset do rodiny `modify`; HUD nápověda (M37) pro všechny nástroje stopy A v tomto milníku.

## Úkoly

- [x] Kontrakt ([[12-skicar#Offset (M35)]], [[06-geometricke-jadro#Stav po M35]]), otázka Q095.
- [ ] Jádro: `offsetCurves`.
- [x] `sketch`: vazba a kóta `offset` (model, parse, edit, measure, poloha kóty).
- [x] Řešič planegcs: vazba `offset`.
- [ ] `sketch`: `chainOf`, `offsetEdit`, port; `app`.
- [ ] `sketcher`: kóta offsetu v kresbě, nástroj, HUD nápověda nástrojů stopy A, e2e.
- [ ] Spec podle skutečnosti.

## Implementační plán

Jeden úkol = jedno spuštění `implementer`. 1 ‖ 2, pak 3 ‖ 4, pak 5 (po natažení `main` s M37 kvůli `setHint`).

### 1. Jádro: `offsetCurves`

- **Soubory:** `src/kernel/profile.ts` (`OffsetCurve`, kontrola vstupu `parseOffsetCurvesInput`), `kernel.ts`, nový `kernel/fake-offset.ts`, `fake-kernel.ts`, `testing.ts`, `index.ts`; `kernel-occt/offset.ts` (podle prototypu: vlastní plocha, `GeomAbs_Intersection`, řetězení, `source` z `Generated`, spline přes `PointsToBSpline` stupně 3), napojení `occt-kernel-impl.ts`, `client.ts`, `protocol.ts`, `worker-impl.ts`; `regen/tracking-kernel.ts`, `app/testing.ts`, fake jádra v testech.
- **Testy:** spec 12 *Testy* (jádro) – kontraktová sada fake i OCCT, test adaptéru (zánik hrany, spline).
- **Hotovo když:** `npm run check` zelený.

### 2. `sketch`: vazba a kóta `offset`

- **Soubory:** `src/sketch/model.ts` (člen `SketchConstraint`, `DimensionKind` `'offset'` – pozor na `DIMENSION_KINDS` a místa, která je vyčerpávají), `parse.ts`, `edit.ts` (`constraintTargets`, `removeItems` po párech, `measure`), `dimension-placement.ts` (výchozí poloha, `placeDimension`/`movePlacement` pro `offset`), `index.ts`.
- **Testy:** parse každého pravidla, `removeItems` (zdroj, kopie, poslední pár), `measure` (úsečka, oblouk), poloha kóty.
- **Hotovo když:** `npm run check` zelený (vyčerpávající `switch` ve `sketcher`/`solver-planegcs` doplní minimálně – řešič `throw` „until task 3“, kresba kóty dočasně jako `pointLineDistance` prvního páru, pokud jinak neprojde typecheck; uvést ve výstupu).

### 3. Řešič planegcs: vazba `offset`

- **Soubory:** `src/solver-planegcs/solve.ts` (primitiva podle spec 12), testy `test/unit/solver-planegcs/`.
- **Testy:** offset obdélníku – změna `d` posune všechny strany, změna šířky originálu kopie sleduje; zaoblený obdélník; kružnice.
- **Hotovo když:** `npm run check` zelený.

### 4. `sketch`: řetězec a úprava dat; `app`

- **Soubory:** nový `src/sketch/offset.ts` (`chainOf`, `offsetEdit`, `Chain`), `geometry-port.ts` (`OffsetCurve2`, `SketchGeometry.offset`), `testing.ts` (fake `offset` pro úsečky), `index.ts`; `src/app/sketch-geometry.ts` (`offset` → `offsetCurves`).
- **Testy:** spec 12 *Testy* (`sketch`); výsledek projde `parseSketchData`, body před křivkami.
- **Hotovo když:** `npm run check` zelený.

### 5. `sketcher`: kóta, nástroj, nápověda, e2e

- **Soubory:** `sketch-dimensions.ts` (kresba kóty `offset`), nový `sketch-tools/offset-tool.ts`, `sketch-tools.ts` (rodina `modify` za `sketch.chamferAngle`), i18n; `setHint` + klíče `hint.*` pro trim, extend, split, fillet, chamfer, chamferAngle, offset; e2e `test/e2e/m35.spec.ts`.
- **Hotovo když:** `npm run check` a `npm run test:e2e` zelené.

## Akceptační kritéria

- Offset obdélníku se zaoblením dovnitř i ven dá správný uzavřený tvar; offset splinu je spline v toleranci.

## Co se naučíš

Jak OCCT řeší ekvidistanty (spojování v rozích, zánik krátkých segmentů) a jak výsledek převést zpět do parametrických dat skici.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Zapisuje stopa: rozhodnutí s Pavlem, odchylky od plánu, výsledky testů. Hlavní sezení to při sloučení přenese do deníku.)_

**2026-10-17 – prototyp OCCT offsetu:** `BRepOffsetAPI_MakeOffset` funguje jen nad vlastní rovinnou plochou (ze samotného drátu selže i úsečka); úsečky a oblouky vychází přesně, spline jako `OffsetCurve` (aproximace nutná), hrany výstupu neseřazené. Celá zpráva v poznámkách stopy (`stopa-a-m35-prototyp-offset.md`).

**Úkol 2 hotový** – `'offset'` na konci `DIMENSION_KINDS`, `placeDimension` ji nezná, rámec kóty oblouku v úhlu popisku zdroje.

**Úkol 3 – řešič narazil na degeneraci:** tečný spoj úsečky a oblouku kopie je dvojnásobný kořen (`p2l_distance` + bod na kružnici `r ± d` mají rovnoběžné gradienty) → `redundant`, `dof 8`, body na 7e-5. Hlavní sezení zvolilo **tečnost v bodě** místo `p2l` v takovém spoji (podle současné polohy); zaoblený obdélník pak `dof 0` bez nadbytečnosti, body na 1e-7. Přijatá omezení: tečný spoj oblouk–oblouk dál degenerovaný; strana kopie může při velké změně originálu přeskočit (jako `pointLineDistance`). Spec 12 doplněna.

## Retrospektiva
