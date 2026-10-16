---
type: milestone
status: todo
order: 37
aliases:
  - M37
  - M37 Text ve skice
modules:
  - sketch
  - features
  - sketcher
  - render
  - ui
specs:
  - "[[12-skicar]]"
depends_on:
  - "[[M30-geometrie-skici-v-occt]]"
  - "[[M36-zrcadleni-a-pole]]"
started:
finished:
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M37 – Text ve skice
**Cíl:** nástroj Text: řetězec v daném fontu, výšce, poloze a natočení se ve skice zobrazí jako obrysy písmen, které tvoří oblasti pro vysunutí.

> Hrubý plán – před zahájením rozhodnout [[Q091 Fonty pro text ve skice|Q091]] a upřesnit. Sdílené typy jsou zafixované v [[12-skicar#Sdílené kontrakty série II]].

**Specifikace:** [[12-skicar]], [[0029-text-ve-skice-pres-opentype|ADR 0029]]

**Navazuje na:** [[M30-geometrie-skici-v-occt|M30]] (oblasti písmen s dírami počítá jádro) a [[M36-zrcadleni-a-pole|M36]] (pořadí ve stopě C). Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]].

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

Upřesnění v sezení 2026-10-16: obrysy přes knihovnu **opentype.js** v TS ([[0029-text-ve-skice-pres-opentype|ADR 0029]]), ne přes OCCT (předpřipravený build nemá fonty).

## Úkoly (orientačně)

- [ ] Rozhodnout [[Q091 Fonty pro text ve skice|Q091]]; modul pro opentype.js a pravidla v `.dependency-cruiser.cjs` a spec 01.
- [ ] Entita text (řetězec, font, výška, kotevní body), kontrola dat, převod na `Curve2` (Bézier → B-spline), id křivek písmen.
- [ ] Nástroj Text a panel pro úpravu řetězce; vazby na kotevní body.
- [ ] Oblasti a vysunutí textu, e2e (gravírování „tinycad“ do kvádru).

## Akceptační kritéria

- Text s písmeny s dírami (o, a, B) dá správné oblasti; vysunutí a odebrání funguje.
- Změna řetězce přestaví oblasti; reference na nezměněná písmena přežijí (podle kontraktu id).

## Co se naučíš

Jak fungují obrysy písmen v TrueType/OpenType (kvadratické a kubické Bézierovy křivky, směr smyček) a jak je převést do CAD geometrie.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Zapisuje stopa: rozhodnutí s Pavlem, odchylky od plánu, výsledky testů. Hlavní sezení to při sloučení přenese do deníku.)_

## Retrospektiva
