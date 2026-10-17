---
type: milestone
status: todo
order: 44
aliases:
  - M44
  - M44 Skica na serveru
  - M44 Model skici a řešič v C++
modules:
  - server
  - sketch
specs:
  - "[[12-skicar]]"
  - "[[14-protokol]]"
depends_on:
  - "[[M39-kostra-serveru]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M44 – Model skici a řešič v C++

**Cíl:** Model skici a nativní planegcs v C++ jako samostatná knihovna, ověřená sdílenými případy řešiče a odvozených entit z M38. Builder skici a opětovné řešení v handleru `setParams` jsou v [[M44.1-builder-skici-na-serveru|M44.1]].

> Hrubý plán série nativního jádra (2026-10-17). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.
>
> Rozděleno 2026-10-17 (Pavel): model skici a řešič na regeneraci nezávisí, proto běží jako souběžná stopa C hned po [[M39-kostra-serveru|M39]] ([[Roadmapa#Nativní jádro (M38–M47)]]). Původně jeden milník „Skica na serveru“ po M43.

**Specifikace:** [[12-skicar]], [[13-testovani#Sdílené testovací případy]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M39-kostra-serveru]] (build, vcpkg)

## Úkoly

- [ ] Model skici v C++ (`server/src/sketch/`): entity, vazby, vzory, text s uloženými obrysy; načtení a validace z JSON jako `parseSketchData` (kódy `sketch.invalidEntity`, `sketch.invalidConstraint`).
- [ ] Odvozené entity: kopie zrcadlení a polí (`patternCopies`), křivky písmen (`textCurves`), `regionCurves` – stejná odvozená id jako v TS.
- [ ] planegcs ze zdrojů (vendorovaný, LGPL, `server/third_party/planegcs/`), adaptér řešiče stejný jako `solver-planegcs` (stavy `ok` / `conflict` / `failed`, DOF, konfliktní a nadbytečné vazby, tažení).
- [ ] Spouštěč sdílených případů v C++ (GoogleTest) pro `sketch.solve` (včetně pevného bodu při DOF > 0) a `sketch.derived`; všech 112 případů zelených.

**Kontrakt pro ostatní stopy:** veřejné hlavičky modelu skici (typy entit a vazeb, `regionCurves`) se zafixují na startu stopy. Na nich staví [[M44.1-builder-skici-na-serveru|M44.1]].

## Akceptační kritéria

- Sdílené případy `sketch.solve` a `sketch.derived` z M38 jsou zelené v C++ i v TS.
- Knihovna skici nezávisí na regeneraci ani na OCCT (jen model, odvozené entity a řešič).

## Co se naučíš

Dva modely téže domény ve dvou jazycích a jak je udržet ve shodě.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
