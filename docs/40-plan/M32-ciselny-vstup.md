---
type: milestone
status: todo
order: 32
aliases:
  - M32
  - M32 Číselný vstup
modules:
  - sketcher
  - interaction
  - render
  - ui
specs:
  - "[[12-skicar]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M31-nove-kreslici-nastroje]]"
started:
finished:
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M32 – Číselný vstup
**Cíl:** při kreslení jde zadat délku, úhel, poloměr nebo souřadnice z klávesnice místo kliknutí; zadaná hodnota se stane kótou.

> Hrubý plán – před zahájením rozhodnout [[Q090 Číselný vstup při kreslení|Q090]] a upřesnit. Sdílené typy jsou zafixované v [[12-skicar#Sdílené kontrakty série II]].

**Specifikace:** [[12-skicar#Režim skicáře (sketcher)]], [[10-interakce]], [[11-ui#Komponenty]]

**Navazuje na:** [[M31-nove-kreslici-nastroje|M31]] (stejné nástroje, stopa B). Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]].

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

Část „možnost zadat bod“, kterou Pavel upřesnil jako nástroj Bod **i** číselný vstup.

## Úkoly (orientačně)

- [ ] Rozhodnout [[Q090 Číselný vstup při kreslení|Q090]] (styl Fusion, nebo Onshape; souřadnice; vznik kót).
- [ ] Společný model vstupu v `sketcher` (pole, Tab, zamčení hodnoty) a vrstva v `ui` u kurzoru.
- [ ] Napojení na nástroje: úsečka, obdélníky, kružnice, oblouky, drážky, bod.
- [ ] Zadaná hodnota → kóta z [[M28-koty|M28]].
- [ ] E2e: úsečka 50 mm pod 30° jen z klávesnice.

## Akceptační kritéria

- Entita nakreslená z klávesnice má přesně zadané rozměry a kóty v seznamu vazeb.
- Myš a klávesnice jdou kombinovat (délka z klávesnice, směr myší).

## Co se naučíš

Návrh stavového modelu vstupu nezávislého na konkrétním nástroji a jak oddělit prezentační model (`sketcher`) od vrstvy v `ui`.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva
