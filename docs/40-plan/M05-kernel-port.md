---
type: milestone
status: todo
order: 5
aliases:
  - M5
  - M5 Port geometrického jádra
modules:
  - kernel
specs:
  - "[[06-geometricke-jadro]]"
depends_on:
  - "[[M01-core]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-12
---
# M5 – Port geometrického jádra

**Cíl:** rozhraní jádra a jeho falešná implementace, aby šla postavit a otestovat regenerace dřív, než přijde OCCT.

**Specifikace:** [[06-geometricke-jadro|06 – geometrické jádro]], [[0002-occt-wasm-ve-workeru|ADR 0002]]

**Navazuje na:** [[M01-core]]

## Úkoly

- [ ] `ShapeHandle`, `ShapeResult`, `SubShapeIndex`, `ShapeHistory`, `MeshData`, `KernelError`.
- [ ] Segregovaná rozhraní: `PrimitiveOps` (zatím jen `makeBox`), `MeshOps`, `QueryOps` (`boundingBox`), `LifecycleOps`; `GeometryKernel` jako jejich spojení. Ostatní (`TransformOps`, `BooleanOps`, …) se přidají v milnících, které je potřebují.
- [ ] `FakeKernel`: kvádry jako AABB, `tessellate` (12 trojúhelníků, 6 ploch, 12 hran), počítání živých handle, `failNext`.
- [ ] Kontraktové testy `GeometryKernel` (budou se spouštět i proti OCCT v M7).
- [ ] Pomocná funkce `validateMeshData` (rozsahy pokrývají všechny trojúhelníky, délky polí sedí) – použije se v testech obou implementací.

## Akceptační kritéria

- `FakeKernel` projde kontraktovými testy.
- `kernel` importuje jen `core`.

## Co se naučíš

Interface segregation, návrh portu tak, aby šel implementovat jak triviálně (fake), tak reálně (OCCT).

## Retrospektiva

_(vyplnit po dokončení)_
