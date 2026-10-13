---
type: milestone
status: todo
order: 7
aliases:
  - M7
  - M7 OCCT adaptér
modules:
  - kernel-occt
specs:
  - "[[06-geometricke-jadro]]"
depends_on:
  - "[[M06-regenerace]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-12
---
# M7 – OCCT adaptér

**Cíl:** skutečné geometrické jádro OpenCascade ve WASM, ve Web Workeru, za portem `GeometryKernel`. Kvádr se počítá i tesseluje v OCCT.

**Specifikace:** [[06-geometricke-jadro|06 – geometrické jádro]], [[0002-occt-wasm-ve-workeru|ADR 0002]]

**Navazuje na:** [[M06-regenerace]]

## Úkoly

- [ ] **Spike (časově omezený, ~1 večer na variantu):** vyzkoušet `opencascade.js`, `replicad-opencascadejs` a nastínit vlastní build přes Emscripten. Kritéria: velikost, dostupnost `BRepPrimAPI_MakeBox`, `BRepMesh_IncrementalMesh`, `BRepAlgoAPI_*` s historií, `STEPControl_Writer`, funkčnost v Node pro testy, ve Vite workeru. Výsledek zapsat jako ADR 0009.
- [ ] `OcctKernelImpl` (běží uvnitř workeru, testovatelný i přímo v Node): tabulka handle, `makeBox` (+ `roles` pro plochy), `boundingBox`, `release`, `liveHandleCount`.
- [ ] Tessellace: `BRepMesh_IncrementalMesh`, průchod ploch přes `TopExp::MapShapes`, triangulace s respektováním orientace plochy, normály, `faceRanges`; polyline hran z `BRep_Tool::PolygonOnTriangulation`, `edgeRanges`.
- [ ] Disciplína uvolňování OCCT objektů (`try/finally` + `.delete()`), pomocník `using`-like scope.
- [ ] `occt.worker.ts` + `OcctKernelClient` přes `core/rpc`, `ready` promise, transfer bufferů.
- [ ] Integrační testy: kontraktové testy z M5 proti `OcctKernelImpl`; `validateMeshData`; žádné úniky handle.
- [ ] Vite: konfigurace workeru a WASM (cesta k `.wasm`, případně `optimizeDeps.exclude`).
- [ ] Ruční ověření: dočasná dev stránka, která v prohlížeči spustí worker, vytvoří kvádr a vypíše počet trojúhelníků a čas.

## Akceptační kritéria

- Kontraktové testy jádra projdou pro `FakeKernel` i `OcctKernelImpl`.
- Kvádr: 6 ploch, 12 hran, `faceRanges` pokrývá všechny trojúhelníky.
- Worker v prohlížeči neblokuje hlavní vlákno (UI reaguje během inicializace WASM).

## Co se naučíš

OCCT z pohledu JS/WASM (embind, správa paměti), Vite + workery + WASM, rozdíl mezi desktopovým a webovým nasazením stejného jádra.

## Retrospektiva

_(vyplnit po dokončení)_
