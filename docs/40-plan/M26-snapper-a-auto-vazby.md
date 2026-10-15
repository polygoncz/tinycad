---
type: milestone
status: todo
order: 26
aliases:
  - M26
  - M26 Snapper a auto-vazby
modules:
  - sketch
  - solver-planegcs
  - sketcher
  - render
specs:
  - "[[12-skicar]]"
  - "[[10-interakce]]"
depends_on:
  - "[[M25-glyfy-vazeb]]"
started:
finished:
tags:
  - milnik
created: 2026-10-15
updated: 2026-10-15
---
# M26 – Snapper a automatické vazby

**Cíl:** kreslicí nástroje skicáře se přichytávají ke geometrii skici (body, středy, křivky, zarovnání) jako ve Fusionu a při kreslení automaticky vytvářejí odpovídající vazby, jejichž glyfy uživatel vidí předem.

**Specifikace:** [[12-skicar#Režim skicáře (sketcher)]], [[10-interakce#Nástroje a akce skicáře]]

**Navazuje na:** [[M25-glyfy-vazeb|M25]] – náhled budoucích vazeb jsou glyfy. Pokračuje [[M27-oblouky-a-kruznice|M27]], jehož tečné nástroje stojí na inferenci tečnosti.

> [!note] Hrubý plán
> Úkoly a akceptační kritéria se upřesní při startu milníku spolu se specifikací a implementačním plánem.

## Rozsah

Pavel 2026-10-15: „Snapper a také automatické doplňování vazeb při vytváření křivek.“

Rozhodnutí v sezení 2026-10-15 (brainstorming):
- **Snapper** je čistá synchronní funkce v `sketch` (`snap(kurzor, kontext) → bod, kandidáti vazeb, vodítka`); nástroje v `sketcher` ji jen volají. Testovatelná v Node bez viewportu.
- **Přichycení:** koncový bod, střed úsečky, střed kružnice a oblouku, bod na křivce, zarovnání s body (tečkovaná vodítka), mřížka jako nejnižší priorita (dnešní chování M19.2 zůstává). Počátek roviny jako dnes.
- **Automatické vazby (všechny, které Pavel vybral):** `coincident` (existuje), nové `pointOnCurve` a `midpoint`, vodorovné/svislé **zarovnání dvou bodů** (nová vazba), kolmo, rovnoběžně a tečně k navazující nebo nadjeté křivce, stejná délka / poloměr.
- Kandidátní vazby se před zápisem ověří řešičem; redundantní nebo konfliktní se **tiše zahodí** (jako Fusion), skica se kreslením nesmí rozbít.
- Inferenci potlačí podržený **Ctrl/Cmd** (konvence Fusionu; Alt už vypíná mřížku).
- Nové druhy vazeb rozšiřují `SketchConstraint`; staré dokumenty zůstávají platné, takže migrace není potřeba.

## Úkoly

- [ ] Rozhodnout [[Q084 Inference automatických vazeb|Q084]], upřesnit spec a implementační plán
- [ ] Nové vazby `pointOnCurve`, `midpoint`, zarovnání bodů: model, `parseSketchData`, `constraintFor`, adaptér planegcs
- [ ] `snap` a inference v `sketch` (čisté funkce, tabulkové testy)
- [ ] Ověření kandidátů řešičem a zápis v nástrojích `sketcher`
- [ ] Kresba vodítek a náhledových glyfů
- [ ] e2e

## Akceptační kritéria

- Kreslení obdélníku navazujícího na existující hranu vytvoří sdílené body a žádnou redundantní vazbu (`redundant` prázdné).
- Úsečka nakreslená skoro kolmo na předchozí dostane `perpendicular`; s Ctrl/Cmd ne.
- Bod položený na úsečku dostane `pointOnCurve` a při tažení úsečky na ní zůstane.

## Co se naučíš

- Inference záměru uživatele z polohy kurzoru (prahy v pixelech vs. v jednotkách modelu, priority).
- Proč se vazby nedají jen „přidat“: redundance a konflikty ve stupních volnosti.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Souběžná stopa, [[Roadmapa#Souběžné stopy (pokus od M25)|pravidla]]: místo deníku sem zapisuje průběh; hlavní sezení ho při sloučení přenese do deníku.)_

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
