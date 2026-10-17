---
type: milestone
status: todo
order: 43
aliases:
  - M43
  - M43 Regenerace a featury v C++
modules:
  - server
specs:
  - "[[07-regenerace]]"
  - "[[08-topologicke-pojmenovani]]"
depends_on:
  - "[[M40-dokument-a-operace-v-cpp]]"
  - "[[M42-jadro-occt-nativne]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M43 – Regenerace a featury v C++

**Cíl:** Regenerator s cache podle identity, mark & sweep, statusy, kotvy, topologické pojmenování a buildery všech featur kromě skici; tělesa nesou `content_version`.

> Hrubý plán série nativního jádra (2026-10-17). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[07-regenerace]], [[08-topologicke-pojmenovani]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M40-dokument-a-operace-v-cpp]], [[M42-jadro-occt-nativne]]

## Úkoly

- [ ] Regenerator: cache podle identity featury, generace, statusy, chyby featur, vstup editované featury ([[0025-vstupni-stav-editovane-featury|ADR 0025]]).
- [ ] Mark & sweep tvarů, `content_version` (`<epocha>.<n>`) při novém tvaru tělesa ([[Q100 Verze sítí v mezipaměti klienta|Q100]]).
- [ ] Topologické pojmenování ([[08-topologicke-pojmenovani]]): `nameShape`, přenos jmen, reference.
- [ ] Buildery a C++ pluginy: Box, Cylinder, Transform, Boolean, Extrude, Revolve, Fillet, Chamfer (skica v [[M44.1-builder-skici-na-serveru|M44.1]]). Schémata jsou už z [[M40-dokument-a-operace-v-cpp|M40]] v `tinycad_features`, buildery se přidají vedle nich ([[Rozhodnutí nativního jádra|N22]]); builder dostane `kernel::ModelingKernel` (N16).
- [ ] Sdílené případy regenerace z M38 zelené (objemy, obálky, jména, kotvy, statusy).

## Akceptační kritéria

- Sdílené případy regenerace všech featur kromě skici projdou.
- Property test: regenerace s cache = regenerace od nuly.

## Co se naučíš

Regenerace s cache a topologické pojmenování nad nativním OCCT, pluginy v C++.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
