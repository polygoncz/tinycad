---
type: question
status: answered
area: "[[09-vykreslovani]]"
decide_by: "[[M08-vykreslovani]]"
proposal: "Perspektivní, přepínač později"
decision: "Ortografická (OrthographicCamera), přepínač na perspektivu později"
tags:
  - otazka
created: 2026-10-12
updated: 2026-10-13
---
# Q016 Ortografická nebo perspektivní kamera

**Oblast:** [[09-vykreslovani]] · **Rozhodnout do:** [[M08-vykreslovani]]

## Otázka

Výchozí kamera ve [[Viewport|viewportu]]: ortografická, nebo perspektivní?

## Možnosti a návrh

Onshape má výchozí perspektivu s přepínáním. Začneme perspektivní.

## Rozhodnutí

2026-10-13 (Pavel): **ortografická kamera** (`THREE.OrthographicCamera`), přepínač na perspektivu případně později. V CAD je ortografie běžná (rozměry se nezkreslují s hloubkou) a zjednodušuje picking hran v pixelech i zoom ke kurzoru: měřítko obrazovky je v celé scéně stejné.

Důsledky pro [[09-vykreslovani]]: zoom mění `camera.zoom`, ne vzdálenost kamery (`OrbitControls` s `zoomToCursor`). Kamera stojí dost daleko a `near`/`far` se při `fitAll()` nastaví podle obálky scény, aby se tělesa neořezávala. Při změně velikosti plátna se přepočítá `left/right/top/bottom` podle poměru stran.
