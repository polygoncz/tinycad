---
type: insight
status: seed
aliases:
  - WebGL lineWidth
  - Fat lines
topics:
  - vykreslování
  - WebGL
sources:
  - https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/lineWidth
  - https://threejs.org/examples/#webgl_lines_fat
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Tlusté čáry ve WebGL

**Shrnutí:** WebGL kreslí čáry prakticky vždy 1 px široké, ať je `linewidth` jakýkoli. Širší čáru je potřeba nakreslit jako pruh trojúhelníků v obrazovkových souřadnicích.

## Podrobnosti

- Specifikace dovoluje implementacím podporovat jen šířku 1 a na většině platforem (ANGLE na Windows, macOS) to tak je. `LineBasicMaterial.linewidth` v Three.js proto nemá viditelný účinek.
- Three.js má v `three/addons/lines/` třídy `LineSegments2`, `LineSegmentsGeometry` a `LineMaterial`: každý segment je instance obdélníku, který vertex shader roztáhne na danou šířku v pixelech.
- `LineMaterial` potřebuje znát **rozlišení plátna** (`resolution`), jinak šířku nespočítá. Při každé změně velikosti se musí aktualizovat.
- Pro běžné hrany těles 1 px stačí. Tlusté čáry se vyplatí tam, kde čára leží na jiné čáře (zvýraznění hrany), jinak zanikne.

## Jak to využívá tinycad

Zvýraznění hrany v `HighlightLayer` ([[09-vykreslovani#Vrstvy pro interakci]]) má 3 px. Chyba se ukázala až v prohlížeči během [[M08-vykreslovani|M8]].

## Zdroje

- MDN: `WebGLRenderingContext.lineWidth()`
- three.js example `webgl_lines_fat`
