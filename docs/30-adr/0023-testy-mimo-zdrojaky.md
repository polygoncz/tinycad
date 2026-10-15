---
type: adr
status: accepted
number: 23
aliases:
  - ADR 0023
  - Testy mimo zdrojáky
date: 2026-10-14
related:
  - "[[01-architektura]]"
  - "[[0008-hranice-modulu]]"
  - "[[M20-zpevneni-struktury]]"
supersedes:
tags:
  - adr
created: 2026-10-14
updated: 2026-10-14
---
# 0023 – Testy mimo zdrojáky

- **Stav:** Přijato (`status: accepted`, Pavel 2026-10-14)
- **Datum:** 2026-10-14
- **Souvisí:** [[01-architektura#Vrstvy a moduly]], [[0008-hranice-modulu|ADR 0008]], [[M20-zpevneni-struktury|M20]]

## Kontext

Unit testy leží vedle kódu (`foo.ts` + `foo.test.ts`). V `src/` je jich 209, takže v každé složce modulu je zhruba polovina souborů testů. Pavel chce mít `src/` jen pro produkční kód aplikace, jako je zvykem v Gradlu (`src/main` a `src/test`).

Testy jsou **white-box**: importují vnitřní soubory svého modulu, ne jen `index.ts`. Hranice modulů (dependency-cruiser) je dnes poznají podle cesty `src/<modul>/…\.test\.ts` a hluboký import do vlastního modulu jim dovolí. Rozdělení testů do projektů TypeScriptu (Node, IndexedDB, `app` a `ui` s typy DOM) se také řídí cestami.

## Rozhodnutí

- `src/` obsahuje jen produkční kód a vstupní body modulů včetně `testing.ts`. `testing.ts` zůstává v modulu, protože je to jeho druhé veřejné API (buildery, fake), ne test.
- Testy jsou v adresáři `test/` se zrcadlovou strukturou:
  - `test/unit/<modul>/…/foo.test.ts` pro `src/<modul>/…/foo.ts`,
  - `test/integration/` (dřív `tests/`),
  - `test/e2e/` (dřív `e2e/`, Playwright).
- Testy importují přes alias `@/` (`@/interaction/feature-editor`), ne relativními cestami.
- **Test v `test/unit/<modul>/` patří modulu `<modul>`.** Pravidla dependency-cruiseru pro testovací kód se mapují z `test/unit/<modul>/` na modul `<modul>`, takže test smí totéž co dnes: hluboké importy do vlastního modulu, `index.ts` a `testing.ts` povolených modulů a `vitest`. Produkční kód z `test/` neimportuje nikdy.

## Zvažované alternativy

- **Ponechat testy vedle kódu:** test je u souboru, který testuje, a přesun souboru vezme test s sebou. `src/` je ale dvakrát delší a produkční kód se v něm hůř čte.
- **Podsložka `__tests__/` v modulu:** pravidla hranic by se skoro neměnila, ale testy by zůstaly v `src/`, což Pavel nechce.

## Důsledky

- (+) `src/` je jen aplikace. Produkční tsconfigy nemusí testy vylučovat.
- (+) Struktura odpovídá Gradlu a Kotlinu, které Pavel zná.
- (−) Přesun nebo přejmenování zdrojového souboru vyžaduje přesunout i test na zrcadlové místo. Hlídá to jen konvence (případně skript v `lint:deps`).
- (−) Pravidla dependency-cruiseru a čtyři projekty TypeScriptu (`tsconfig.test*.json`) se musí přepsat z cest `src/**/*.test.ts` na `test/unit/**`.
