---
type: spec
status: draft
order: 13
aliases:
  - Testovací strategie
  - Spec 13
modules: []
milestones: []
tags:
  - spec
created: 2026-10-12
updated: 2026-10-12
---
# 13 – Testovací strategie

> **Pojmy:** [[Port a adaptér]], [[Determinismus operací]], [[Mark and sweep]]

Testy jsou součástí návrhu, ne dodatek. Architektura je postavená tak, aby se většina logiky dala testovat **bez prohlížeče a bez OCCT**.

## Úrovně

| Úroveň | Co | Nástroj | Kdy běží |
|---|---|---|---|
| Unit | `core`, `document`, `ops`, `regen` (s `FakeKernel`), `persistence` (s `MemoryDocumentStore` a `fake-indexeddb`), `interaction`, čisté funkce z `render` | Vitest (Node) | vždy, `npm test` |
| Kontraktové | stejná sada testů pro všechny implementace portu (`FakeKernel` × `OcctKernelImpl`, `MemoryDocumentStore` × `IdbDocumentStore`) | Vitest | vždy (OCCT verze v integrační sadě) |
| Integrační | `kernel-occt` s reálným WASM v Node | Vitest, projekt `integration` | `npm run test:integration` |
| Property-based | replay logu, undo/redo, regenerace bez úniků handle | fast-check | vždy |
| E2E smoke | otevřít aplikaci, vytvořit kvádr, změnit parametr, undo, reload | Playwright, Chrome (`channel: 'chrome'`) a WebKit (Safari) | od M10, `npm run test:e2e` |

## Klíčové invarianty (property-based)

1. **Replay:** pro libovolnou sekvenci operací a undo/redo: přehrání logu od prázdného dokumentu = živý dokument.
2. **Inverze:** pro každou operaci `apply(op)` a pak `apply(inverse)` = původní dokument.
3. **Snapshot:** snapshot k `seq` + zbytek logu = přehrání celého logu.
4. **Cache regenerace:** výsledek regenerace s cache = výsledek regenerace od nuly (porovnání stavů z `FakeKernel`).
5. **Úniky:** po libovolné sekvenci změn a regenerací je počet živých handle v jádru roven počtu handle ve stavech cache.

## Konvence

- Test leží vedle kódu: `foo.ts` → `foo.test.ts`. Integrační testy v `tests/`.
- Testovací data (featury, dokumenty) přes malé buildery: `aBox({ height: 20 })`, `aDocument().with(aBox()).build()`.
- ID v testech ze `SequentialIdGenerator` → čitelné snapshoty.
- Žádné mockovací frameworky pro porty – vlastní fake implementace (`FakeKernel`, `MemoryDocumentStore`), které jsou samy ověřené kontraktovými testy.

## Pokrytí

Neřešíme procenta. Pravidlo: každé veřejné API modulu má test a každá opravená chyba dostane regresní test.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
