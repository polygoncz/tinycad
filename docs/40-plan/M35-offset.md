---
type: milestone
status: todo
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
started:
finished:
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M35 – Offset
**Cíl:** nástroj Odsazení (offset): z vybrané křivky nebo řetězce křivek vznikne ekvidistanta ve zvolené vzdálenosti, počítaná v OCCT.

> Hrubý plán – před zahájením upřesnit. Sdílené typy jsou zafixované v [[12-skicar#Sdílené kontrakty série II]].

**Specifikace:** [[12-skicar]], [[06-geometricke-jadro]]

**Navazuje na:** [[M30-geometrie-skici-v-occt|M30]] (stopa A, po [[M34-zaobleni-a-srazeni-ve-skice|M34]]). Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]].

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

## Úkoly (orientačně)

- [ ] Port: offset řetězce (`BRepOffsetAPI_MakeOffset` nad drátem, `Geom2d_OffsetCurve`), výstup jako `Curve2` – úsečky, oblouky, spline (ekvidistanta splinu se aproximuje).
- [ ] Výběr řetězce: klik na křivku vybere navazující řetězec (jako Onshape), strana podle polohy myši, vzdálenost z kóty ve viewportu.
- [ ] Rozhodnout, jestli offset zůstane asociativní (vazba „odsazení“) nebo vzniknou jen nové entity s kótou vzdálenosti; nová otázka při startu.
- [ ] Spec 12, e2e.

## Akceptační kritéria

- Offset obdélníku se zaoblením dovnitř i ven dá správný uzavřený tvar; offset splinu je spline v toleranci.

## Co se naučíš

Jak OCCT řeší ekvidistanty (spojování v rozích, zánik krátkých segmentů) a jak výsledek převést zpět do parametrických dat skici.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Zapisuje stopa: rozhodnutí s Pavlem, odchylky od plánu, výsledky testů. Hlavní sezení to při sloučení přenese do deníku.)_

## Retrospektiva
