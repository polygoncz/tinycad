---
type: milestone
status: todo
order: 47
aliases:
  - M47
  - M47 Úklid a dokončení série
modules:
  - app
  - ui
  - kernel
  - kernel-occt
  - regen
  - ops
  - persistence
specs:
  - "[[01-architektura]]"
  - "[[05-persistence]]"
  - "[[06-geometricke-jadro]]"
depends_on:
  - "[[M46-klient-nad-read-modelem]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M47 – Úklid a dokončení série

**Cíl:** Z prohlížeče zmizí WASM, regenerace, operace a IndexedDB; specifikace popisují serverovou verzi.

> Hrubý plán série nativního jádra (2026-10-17). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[01-architektura]], [[05-persistence]], [[06-geometricke-jadro]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M46-klient-nad-read-modelem]]

## Úkoly

- [ ] Odstranit ze `src/` `kernel-occt`, `regen`, `ops`, `persistence` a buildery featur; upravit `.dependency-cruiser.cjs` a tabulku modulů ve spec 01.
- [ ] Odebrat `replicad-opencascadejs` a fonty, které klient už nepotřebuje; změřit velikost bundlu a čas startu před a po.
- [ ] Přepsat specifikace 01, 05, 06, 07, 09, 10, 11, 12 na serverovou verzi.
- [ ] Retrospektiva série a poznatek do `70-poznatky/` (vykuchání jádra do služby: co bylo těžké).

## Akceptační kritéria

- Klient neobsahuje OCCT ani doménu kromě modelu skici.
- `npm run check` a `npm run test:e2e:full` zelené.

## Co se naučíš

Jak dotáhnout velký přepis do konce: úklid, měření a dokumentace.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
