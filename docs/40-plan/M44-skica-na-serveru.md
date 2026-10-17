---
type: milestone
status: todo
order: 44
aliases:
  - M44
  - M44 Skica na serveru
modules:
  - server
  - sketch
  - sketcher
specs:
  - "[[12-skicar]]"
  - "[[14-protokol]]"
depends_on:
  - "[[M43-regenerace-v-cpp]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M44 – Skica na serveru

**Cíl:** Model skici, nativní planegcs a builder skici v C++; server při každém `setParams` skici skicu znovu vyřeší a jeho výsledek platí.

> Hrubý plán série nativního jádra (2026-10-17). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[12-skicar]], [[14-protokol]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M43-regenerace-v-cpp]]

## Úkoly

- [ ] Chování podle [[Q103 Skica, kterou server nevyřeší|Q103]]: nevyřešená skica → `SKETCH_NOT_SOLVED` a dokument beze změny; vyřešená se uloží v řešení serveru a klient ho převezme bez tolerance.
- [ ] Model skici v C++: entity, vazby, validace, `regionCurves`, odvozené entity (zrcadlení, pole, písmena textu z uložených obrysů).
- [ ] planegcs ze zdrojů (vendorovaný, LGPL), adaptér řešiče stejný jako v `solver-planegcs`.
- [ ] Builder skici (oblasti, plochy, artefakt pro `SketchView`).
- [ ] Opětovné řešení v handleru `feature.setParams` skici, chyba `SKETCH_NOT_SOLVED` (klíč `sketch.notSolved` i v `messages` skicáře).
- [ ] Sdílené případy řešiče a skic z M38 zelené v C++ i v TS.

## Akceptační kritéria

- Skici všech druhů entit z M25–M37 dají v C++ stejné oblasti a souřadnice jako v TS (v toleranci).

## Co se naučíš

Dva modely téže domény ve dvou jazycích a jak je udržet ve shodě.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
