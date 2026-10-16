---
type: milestone
status: todo
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
started:
finished:
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M34 – Zaoblení a sražení ve skice
**Cíl:** zaoblení (fillet) a sražení (chamfer) mezi dvěma křivkami skici: vznikne oblouk nebo úsečka, sousední křivky se ořežou a vzniknou vazby (tečnost, poloměr, vzdálenost).

> Hrubý plán – před zahájením upřesnit. Sdílené typy jsou zafixované v [[12-skicar#Sdílené kontrakty série II]].

**Specifikace:** [[12-skicar]]

**Navazuje na:** [[M33-trim-extend-split|M33]] (ořezání sousedních křivek, stopa A). Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]].

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

Předpřipravený build nemá `ChFi2d_*`; zaoblení úseček a oblouků je analytické, u splinu se použijí průsečíky ekvidistant z jádra ([[M35-offset|M35]] nebo `Geom2d_OffsetCurve` už tady).

## Úkoly (orientačně)

- [ ] Konstrukce zaoblení a sražení (úsečka–úsečka, úsečka–oblouk, oblouk–oblouk; spline přes jádro).
- [ ] Nástroj: výběr dvou křivek nebo klik na společný roh, poloměr/vzdálenost z kóty ve viewportu.
- [ ] Vazby: tečnost na obou stranách, kóta poloměru, u sražení dvě vzdálenosti nebo vzdálenost a úhel.
- [ ] Spec 12, e2e.

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
