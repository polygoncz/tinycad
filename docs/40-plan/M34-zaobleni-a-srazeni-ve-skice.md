---
type: milestone
status: doing
order: 34
aliases:
  - M34
  - M34 Zaoblení a sražení ve skice
modules:
  - sketch
  - sketcher
  - kernel
  - kernel-occt
specs:
  - "[[12-skicar]]"
depends_on:
  - "[[M33-trim-extend-split]]"
started: 2026-10-16
finished:
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M34 – Zaoblení a sražení ve skice
**Cíl:** zaoblení (fillet) a sražení (chamfer) mezi dvěma křivkami skici: vznikne oblouk nebo úsečka, sousední křivky se ořežou a vzniknou vazby (tečnost, poloměr, vzdálenost).

**Specifikace:** [[12-skicar#Zaoblení a sražení ve skice (M34)]], [[06-geometricke-jadro#Stav po M34]], [[12-skicar#Trim, extend, split (M33)]]

**Navazuje na:** [[M33-trim-extend-split|M33]] (ořezání sousedních křivek, stopa A). Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]].

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

Předpřipravený build nemá `ChFi2d_*`; zaoblení úseček a oblouků je analytické, u splinu se použijí průsečíky ekvidistant z jádra ([[M35-offset|M35]] nebo `Geom2d_OffsetCurve` už tady).

## Rozhodnutí při startu (Pavel 2026-10-16)

- Roh po zaoblení a sražení zůstane jako **virtuální ostrý roh** (bod s `pointOnCurve` k oběma křivkám), kóty na roh přežijí.
- Oblouk zaoblení: **tečnosti + kóta poloměru**, kóta se hned otevře k úpravě.
- **Jen úsečka a oblouk** (spline později s tečností oblouk–spline v řešiči).
- Sražení: **dvě vzdálenosti i vzdálenost + úhel**. Bez číselného vstupu (M32) mají dvě vzdálenosti při vytvoření stejnou hodnotu a kóty nejsou svázané; varianta s úhlem jen k úsečce. Nové id `sketch.chamferAngle` v rodině `fillet`.

## Úkoly

- [x] Kontrakt ([[12-skicar#Zaoblení a sražení ve skice (M34)]], [[06-geometricke-jadro#Stav po M34]]).
- [ ] Jádro: `filletArc` (fake, OCCT, kontraktová sada).
- [ ] `sketch`: `cornerOf`, `filletEdit`, `chamferEdit`, port `fillet`.
- [ ] `app` port, `rewrite` s otevřením kóty, nástroje v liště, e2e.
- [ ] Spec podle skutečnosti.

## Implementační plán

Jeden úkol = jedno spuštění `implementer`. Úkoly 1 a 2 souběžně (2 má fake port), 3 na obou.

### 1. Jádro: `filletArc`

- **Soubory:** `src/kernel/profile.ts` (`FilletArc`, kontrola vstupu), `kernel.ts`, nový `kernel/fake-fillet.ts` (analyticky), `fake-kernel.ts`, `testing.ts` (kontraktová sada), `index.ts`; `kernel-occt`: nový `fillet.ts` (`Geom2d_OffsetCurve` nad `Geom2d_Line`/`Geom2d_Circle`, `InterCurveCurve`, `ProjectPointOnCurve`; sdílet `geom2d.ts`), `occt-kernel-impl.ts`, `client.ts`, `protocol.ts`, `worker-impl.ts`; `regen/tracking-kernel.ts`, `app/testing.ts`, fake jádra v testech.
- **Testy:** podle spec 12 *Testy* (jádro) proti fake i OCCT.
- **Hotovo když:** kontraktová sada projde s obojím, `npm run check` zelený.

### 2. `sketch`: úpravy dat

- **Soubory:** `src/sketch/geometry-port.ts` (`FilletArc`, `SketchGeometry.fillet`), nový `fillet.ts` (`cornerOf`, `filletEdit`, `chamferEdit`, typy požadavků), `trim.ts` (`SketchEdit.edit?`), `index.ts`, `testing.ts` (fake `fillet` analyticky pro úsečky), `app/sketch-geometry.ts` dočasně „not implemented“ pro `fillet`.
- **Testy:** podle spec 12 *Testy* (`sketch`); invariant: výsledek projde `parseSketchData`, body před křivkami.
- **Hotovo když:** `npm run check` zelený.

### 3. Port v `app`, session, nástroje, e2e

- **Soubory:** `src/app/sketch-geometry.ts` (`fillet` → `filletArc`), `sketcher/sketch-session.ts` (`rewrite(…, opts?: { edit })`), nové `sketch-tools/fillet-tool.ts`, `chamfer-tool.ts` (obě varianty), `sketch-tools.ts` (rodina `fillet`, skupina `modify`), i18n; e2e `test/e2e/m34.spec.ts`.
- **Testy:** nástroje s fake portem (náhled, klik na roh, dvě křivky, příliš velký poloměr nic, otevření kóty); e2e podle spec 12.
- **Hotovo když:** `npm run check` a `npm run test:e2e` zelené.

## Akceptační kritéria

- Zaoblení rohu obdélníku: oblouk tečný k oběma stranám, změna kóty poloměru drží tvar.
- Zaoblení dvou nesousedních křivek je ořeže k bodům dotyku.

## Co se naučíš

Rozdíl mezi zaoblením ve skice (2D, vazby) a zaoblením hran tělesa ([[M14-topologicke-pojmenovani|M14]], 3D, OCCT `BRepFilletAPI`).

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Zapisuje stopa: rozhodnutí s Pavlem, odchylky od plánu, výsledky testů. Hlavní sezení to při sloučení přenese do deníku.)_

## Retrospektiva
