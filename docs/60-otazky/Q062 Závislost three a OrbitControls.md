---
type: question
status: answered
area: "[[09-vykreslovani]]"
decide_by: "[[M08-vykreslovani]]"
proposal: "Verze do spec 09, nové ADR není potřeba, OrbitControls z three/addons"
decision: "three 0.186 + @types/three, bez nového ADR (volba v ADR 0001); OrbitControls z three/addons"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q062 Závislost three a OrbitControls

**Oblast:** [[09-vykreslovani]] · **Rozhodnout do:** [[M08-vykreslovani]]

## Otázka

`three` zatím v `package.json` není. Potřebuje nová závislost vlastní ADR? A jak povolit `OrbitControls`, které leží v `three/addons/…` (`examples/jsm`), v pravidlech dependency-cruiseru?

## Možnosti a návrh

1. **Bez nového ADR.** Three.js zvolil už [[0001-jadro-v-cistem-ts|ADR 0001]], verzi zapíšeme do [[09-vykreslovani]]. `three` 0.186 (poslední k 2026-10-13) a `@types/three` 0.186 jako dev závislost. Three.js má verze `0.x`, takže každé minor vydání může rozbít API: drží se `~0.186`. `three/addons` je stejný balík `three`, pravidlo pro `render` v `.dependency-cruiser.cjs` ho povolí jako podcestu balíku.
2. **ADR pro Three.js.**
   - − Opakovalo by rozhodnutí z ADR 0001.

Návrh: **1**.

## Rozhodnutí

2026-10-13 (Pavel): **možnost 1.** Propsáno do [[09-vykreslovani]].
