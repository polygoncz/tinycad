---
type: question
status: answered
area: "[[13-testovani]]"
decide_by: "[[M08-vykreslovani]]"
proposal: "Čisté funkce v souborech bez importu three, testy v Node beze změny konfigurace"
decision: "Čisté funkce render bez importu three, testované v Node; žádný nový tsconfig"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q061 Testy render v Node

**Oblast:** [[13-testovani]] · **Rozhodnout do:** [[M08-vykreslovani]]

## Otázka

Typy Three.js (`@types/three`) odkazují na DOM (`HTMLCanvasElement`, `WebGLRenderingContext`). Testy běží v Node pod `tsconfig.test.json`, který knihovnu DOM schválně nemá. Jak testovat logiku v `render` ([[09-vykreslovani#Testy]])?

## Možnosti a návrh

1. **Čisté funkce v souborech, které neimportují `three`** (diff těles, trojúhelník → plocha, polyline → úsečky, převod událostí na hodnotách, ne na DOM typech). Testují se v Node beze změny konfigurace.
   - \+ Žádná nová konfigurace. + Hranice „co se testuje“ = hranice souboru, vynucuje ji překladač.
   - − Kód s Three.js se ověřuje ručně na dev stránce.
2. **Nový projekt `tsconfig.test-render.json` s DOM** (jako u IndexedDB) a prostředí `jsdom`/`happy-dom`.
   - − WebGL tam stejně neběží, takže by se testovaly hlavně konstrukce objektů. Režie bez velkého přínosu.

Návrh: **1**. Smoke test v prohlížeči (Playwright) zůstává na později.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1.** Propsáno do [[09-vykreslovani#Testy]].
