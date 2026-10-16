---
type: milestone
status: todo
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
started:
finished:
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M33 – Trim, extend, split
**Cíl:** nástroje Ořezat (trim), Prodloužit (extend) a Rozdělit (split) nad úsečkami, kružnicemi, oblouky a spliny; průsečíky počítá jádro.

> Hrubý plán – před zahájením upřesnit. Sdílené typy jsou zafixované v [[12-skicar#Sdílené kontrakty série II]].

**Specifikace:** [[12-skicar]], [[06-geometricke-jadro]]

**Navazuje na:** [[M30-geometrie-skici-v-occt|M30]] (průsečíky v jádře, stopa A). Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]].

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

## Úkoly (orientačně)

- [ ] Kontrakt: co se stane s vazbami a kótami ořezané křivky (zachovat, přenést na část, smazat), id nových částí (stabilita jmen ploch).
- [ ] Trim: klik nebo tah přes úseky, náhled úseku pod kurzorem ([[Q092 Hranice geometrie skici v TS a v OCCT|Q092]]); kružnice → oblouk.
- [ ] Extend: prodloužení konce k nejbližší křivce ve směru tečny (úsečka, oblouk; spline podle možností OCCT).
- [ ] Split: rozdělení křivky v průsečících nebo v bodě; nové body s vazbou `pointOnCurve`/`coincident`.
- [ ] Spec 12, e2e.

## Akceptační kritéria

- Trim, extend a split fungují pro všechny dvojice druhů křivek včetně splinu.
- Vazby a kóty se chovají podle kontraktu; skica po operaci projde `parseSketchData` a řešičem.

## Co se naučíš

Topologická operace nad parametrickými daty: kde se střetává „geometrie v OCCT“ s „vazbami v řešiči“ a jak zachovat identitu entit.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva
