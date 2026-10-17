---
type: milestone
status: todo
order: 42
aliases:
  - M42
  - M42 Jádro OCCT nativně
modules:
  - server
specs:
  - "[[06-geometricke-jadro]]"
  - "[[08-topologicke-pojmenovani]]"
depends_on:
  - "[[M39-kostra-serveru]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M42 – Jádro OCCT nativně

**Cíl:** Port `GeometryKernel` v C++ nad OCCT 8.0.1: primitiva, transformace, booleany, vysunutí a rotace, zaoblení a sražení, topologie, tessellace, oblasti skici, STEP.

> Hrubý plán série nativního jádra (2026-10-17). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[06-geometricke-jadro]], [[08-topologicke-pojmenovani]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M39-kostra-serveru]]

## Úkoly

- [ ] Tabulka tvarů (handle) uvnitř procesu, `ShapeEntry` přes `TopTools_IndexedMapOfShape`, uvolňování.
- [ ] Operace portu podle [[06-geometricke-jadro]] včetně historie (`Modified`, `Generated`, `IsDeleted`) a rolí ploch.
- [ ] Tessellace do plochých polí `Mesh` ([[14-protokol#Read model a sítě]]).
- [ ] Oblasti skici (`profileRegions`, `makeFace`) – zvážit `BOPAlgo` nebo `BRepAlgoAPI_Splitter`, které WASM build neměl ([[Q093 Oblasti z křížících se křivek|Q093]]).
- [ ] STEP export.
- [ ] Výjimky OCCT → `KernelErrorCode`; paměťový test (opakované kolo nezvětšuje paměť procesu), uzavření [[Q054 Únik paměti v OCCT buildu|Q054]] a [[Q055 Pád WASM jádra|Q055]].
- [ ] Kontraktová sada jádra jako sdílené případy z M38 zelená.

## Akceptační kritéria

- Kontraktová sada projde nad OCCT 8.0.1 s tolerancemi z M38.
- Paměťový test je zelený nebo únik vysvětlený a ohraničený.

## Co se naučíš

Nativní OCCT 8.0.1 a migrace ze 7.x, správa paměti `Handle(Standard_Transient)`, srovnání s WASM.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
