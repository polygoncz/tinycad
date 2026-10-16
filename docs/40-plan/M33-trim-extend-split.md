---
type: milestone
status: doing
order: 33
aliases:
  - M33
  - M33 Trim, extend, split
modules:
  - kernel
  - kernel-occt
  - sketch
  - sketcher
  - render
specs:
  - "[[12-skicar]]"
  - "[[06-geometricke-jadro]]"
depends_on:
  - "[[M30-geometrie-skici-v-occt]]"
started: 2026-10-16
finished:
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M33 – Trim, extend, split
**Cíl:** nástroje Ořezat (trim), Prodloužit (extend) a Rozdělit (split) nad úsečkami, kružnicemi, oblouky a spliny; průsečíky počítá jádro.

**Specifikace:** [[12-skicar#Trim, extend, split (M33)]], [[06-geometricke-jadro#Stav po M33]], [[12-skicar#Sdílené kontrakty série II]]

**Navazuje na:** [[M30-geometrie-skici-v-occt|M30]] (průsečíky v jádře, stopa A). Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]].

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

## Rozhodnutí při startu (Pavel 2026-10-16)

- [[Q093 Oblasti z křížících se křivek|Q093]]: křížení dál bez oblastí, skicář vyznačí body křížení.
- Id a vazby: kus se **začátkem** křivky drží id; vazby zůstávají u něj, nesmyslné zmizí; nový konec v řezu `pointOnCurve` k řezající křivce (nebo její koncový bod).
- Ořezaný `fitSpline` se stane `bspline` (přesný kus z jádra).
- Extend jen úsečka a oblouk; spline jen jako hranice.

## Úkoly

- [x] Kontrakt: vazby a kóty ořezané křivky, id nových částí ([[12-skicar#Trim, extend, split (M33)]]).
- [x] Jádro: `curveIntersections`, `curveSegment` (fake, OCCT, kontraktová sada).
- [x] `sketch`: port `SketchGeometry`, parametr křivky, `cutsOf`, `trimEdit`/`extendEdit`/`splitEdit`.
- [x] `app`: `SketchGeometry` nad jádrem.
- [x] Session: cache průsečíků, body křížení, `rewrite`.
- [x] Nástroje Trim, Extend, Split v liště.
- [x] Spec podle skutečnosti, e2e.

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Kontrakt: [[12-skicar#Trim, extend, split (M33)]], [[06-geometricke-jadro#Stav po M33]]. Úkoly 1 a 2 na sobě nezávisí (sdílí jen definici parametru `t` ze spec) a mohou běžet souběžně; 3 stojí na 1 a 2; 4 na 2; 5 na 3 a 4.

### 1. Jádro: průsečíky a kusy křivek

- **Soubory:** `src/kernel/profile.ts` (`CurveIntersection`, kontrola vstupu `curveSegment`), `kernel.ts` (`SketchOps.curveIntersections`, `curveSegment`), `fake-regions.ts` nebo nový `kernel/fake-curves.ts` (průsečíky z algoritmu oblastí, kus splinu vkládáním uzlů), `fake-kernel.ts`, `testing.ts` (kontraktová sada), `index.ts`; `kernel-occt`: nový `curves.ts` (sdílí stavbu 2D křivek a předfiltr obálek s `regions.ts` – vytknout), `occt-kernel-impl.ts`, `client.ts`, `protocol.ts`, `worker-impl.ts`; `regen/tracking-kernel.ts`, `app/testing.ts`, fake jádra v testech.
- **Nejdřív ověřit** (krátký test adaptéru): `Geom2dAPI_ProjectPointOnCurve` dá parametr bodu průsečíku; `Geom2d_BSplineCurve.Segment` na kopii (`Copy()`), uzly a póly kusu.
- **Testy:** podle spec 12 *Testy* (jádro) v kontraktové sadě proti fake i OCCT.
- **Hotovo když:** kontraktová sada projde s obojím, `npm run check` zelený.

### 2. `sketch`: parametr křivky a úpravy dat

- **Soubory:** `src/sketch/geometry-port.ts` (`CurveHit`, metody `SketchGeometry`), nový `curve-param.ts` (`pointAt`, `nearestParam`, `piecePolyline`), nový `trim.ts` (`cutsOf`, `trimEdit`, `extendEdit`, `splitEdit`, `SketchEdit`, typy požadavků a `IdSource` – navrhne implementátor podle vzoru nástrojů, hlavní sezení schválí), `index.ts`, `testing.ts` (`createFakeSketchGeometry` s metodami: průsečíky úseček, oblouků a kružnic analyticky, `segment` úsečky a oblouku; spline `invalid`).
- **Testy:** podle spec 12 *Testy* (`sketch`): každý řádek tabulky Trim, Extend, Split a každé pravidlo dat; výsledek vždy projde `parseSketchData`.
- **Hotovo když:** testy projdou, `npm run check` zelený.

### 3. `app`: `SketchGeometry` nad jádrem

- **Soubory:** `src/app/sketch-geometry.ts` (`createSketchGeometry(kernel: () => GeometryKernel)`; `Curve2` → `ProfileCurve` bez převodu, `CurveIntersection` → `CurveHit`), `session.ts` (předat klienta jádra).
- **Testy:** `test/unit/app/sketch-geometry.test.ts` s `FakeKernel` (průsečíky, kus, chyba jádra → odmítnutý `Promise`).
- **Hotovo když:** `npm run check` zelený.

### 4. Session: průsečíky, body křížení, `rewrite`

- **Soubory:** `src/sketcher/sketch-session.ts` (cache `hits()` k verzi dat, poslední vyhrává; `SKETCH_CROSSINGS_OVERLAY_ID`; `rewrite(next, added)`), `src/interaction` (`OverlayStyle` `'warning'`), `src/render` (barva stylu `'warning'`).
- **Testy:** `test/unit/sketcher/sketch-session.test.ts` (cache se přepočítá po zápisu, starší odpověď se zahodí, body křížení jen mimo sdílené konce, `rewrite` při konfliktu bez `added`); render styl.
- **Hotovo když:** `npm run check` zelený.

### 5. Nástroje Trim, Extend, Split

- **Soubory:** nové `src/sketcher/sketch-tools/trim-tool.ts`, `extend-tool.ts`, `split-tool.ts`; `sketch-tools.ts` (rodina `trim`, skupina `modify` – pokud ji v `main` ještě nezavedla jiná stopa, zavést), `constants.ts`, i18n (`tool.trim`, `tool.extend`, `tool.split`, klávesa `T`).
- **Testy:** nástroje s `FakeSketchGeometry` (náhled kusu, klik → jeden zápis, bez `hits` nic, extend bez průsečíku nic); e2e podle spec 12 *Testy*.
- **Hotovo když:** `npm run check` a `npm run test:e2e` zelené.

### 6. Spec podle skutečnosti

- Spec 12 a 06 podle kódu, regresní e2e celé série zelené.

## Akceptační kritéria

- Trim, extend a split fungují pro všechny dvojice druhů křivek včetně splinu.
- Vazby a kóty se chovají podle kontraktu; skica po operaci projde `parseSketchData` a řešičem.

## Co se naučíš

Topologická operace nad parametrickými daty: kde se střetává „geometrie v OCCT“ s „vazbami v řešiči“ a jak zachovat identitu entit.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Zapisuje stopa: rozhodnutí s Pavlem, odchylky od plánu, výsledky testů. Hlavní sezení to při sloučení přenese do deníku.)_

**2026-10-16 – úkoly 1 a 2** (souběžně v izolovaných worktree).
- Úkol 1: OCCT ověřeno – `Geom2dAPI_ProjectPointOnCurve` dá parametr průsečíku, `Geom2d_BSplineCurve.Segment` na `Copy()` (pole OCCT od 1). OCCT hlásí tečný dotyk jako krátký „společný úsek“ (u kružnice ještě rozdělený ve švu) – adaptér rozliší skutečný překryv podle mezery uvnitř úseku. Fake počítá průsečíky splinu vzorkováním + Newton (tessellace nestačí na bodovou toleranci). Stavba 2D křivek a předfiltr obálek vytknuté do `kernel-occt/geom2d.ts`, sdílí je oblasti i průsečíky. Hlavní sezení zúžilo `curveSegment` kružnice na `to < from + 2π` (celá otáčka = oblouk nulové délky).
- Úkol 2: typy požadavků a `IdSource` navrhl implementátor, schváleno (spec 12). Hlavní sezení rozhodlo dvě díry: řezy se stejným bodem v jedné úpravě dávají jeden bod (smyčka splinu); `tangent` úsečky a splinu přejde ke kusu se sdíleným koncem.
- `npm run check` po sloučení: 6867 unit, 41 integračních testů.

**2026-10-16 – úkoly 3 a 4** (souběžně).
- Úkol 3: `createSketchGeometry(() => supervisor.kernel())` – jádro se bere při každém volání, bez jádra odmítne.
- Úkol 4: session drží průsečíky k verzi pole entit (poslední vyhrává), body křížení v overlayi `sketch-crossings` stylem `'warning'`, `rewrite(next, added)`. Spec chtěla varování v konzoli při chybě portu – `sketcher` (prstenec 2) `console` nemá, varování vypuštěno ze spec. Barva `'warning'` zatím `palette.axes[0]`; vlastní klíč `ScenePalette` (spec 09) je návrh pro hlavní sezení.
- `npm run check`: 6895 unit, 41 integračních.

**2026-10-16 – úkol 5.** Nástroje `trim-tool.ts`, `extend-tool.ts`, `split-tool.ts` + sdílené `curve-pick.ts`; session vystavuje port `geometry`. E2e `test/e2e/m33.spec.ts` (ořezat přesah → oblast a vysunutí, prodloužit ke kružnici, rozdělit úsečku): 142/142.
- **Nalezená chyba z úkolu 2:** `trimEdit` dával nové body za křivku, která je používá; `parseSketchData` to přijme, ale planegcs vrátí `failed`. Opraveno (body před křivkami) a doplněno jako pravidlo dat 4 ve spec 12. Unit testy s `FakeSolver` to chytit nemohly – zachytilo to až e2e se skutečným řešičem.
- **Pro hlavní sezení:** skupina `modify` je v liště skicáře mezi `draw` a `constrain` – spec 11 (pořadí skupin Toolbaru) to zatím neuvádí, stopa A ji nemění. Robustnější by byl adaptér planegcs nezávislý na pořadí entit (u splinů už je) – případná otázka mimo M33.

## Retrospektiva
