---
type: question
status: answered
area: "[[02-core]]"
decide_by: "[[M08-vykreslovani]]"
proposal: "Vlastní geometrie v core, referenční knihovna jen jako orákulum v testech"
decision: "gl-matrix 3 za fasádou v core/math (ADR 0012)"
tags:
  - otazka
created: 2026-10-13
updated: 2026-10-13
---
# Q024 Knihovna pro vektorovou matematiku

**Oblast:** [[02-core]] · **Rozhodnout do:** [[M08-vykreslovani]]

## Otázka

V [[M01-core|M1]] vznikla vlastní minimální matematika (`vec3`, `mat4`, asi 80 řádků). Brzy ale bude potřeba víc: inverze matic, roviny a souřadné systémy, paprsky a průsečíky, 2D vektory pro [[12-skicar|skicář]]. Máme použít knihovnu (obdobu GLM z C++), nebo matematiku dál psát sami?

Rozbor potřeb podle specifikací:

- **`render`** (prstenec 3): `screenToRay`, orbit kamery, raycast těles. Všechno pokryje Three.js, které tam je.
- **`interaction` a doména** (prstence 1–2, bez Three.js, [[0009-platformove-nezavisla-domena|ADR 0009]]): průsečík paprsku s rovinou skici, převod 3D ↔ 2D v rovině skici (obdoba `gp_Ax3`), 2D picking skicových entit, transformace skica → model. Tady se matematika rozroste.

Knihovny typu gl-matrix nebo wgpu-matrix umí vektory, matice a kvaterniony, ale **ne** roviny, paprsky ani souřadné systémy, tedy to, co doména potřebuje nejvíc. Navíc jsou postavené na mutaci (`out` parametr), což jde proti [[Neměnná data|neměnným datům]], a gl-matrix standardně počítá ve float32.

## Možnosti a návrh

1. **Vlastní geometrie v `core`, rozšiřovaná podle potřeby** (`vec2`, `mat4.invert`, `plane`, `frame`, `ray`).
   - \+ `core` dál nic neimportuje. + API neměnné, float64, konvence sjednocené s OCCT (`gp_Ax3`, `gp_Pln`). + Výukové: přesně to, co Pavel zná z OCCT.
   - − Vlastní kód k udržování a riziko chyb v numerice (inverze).
   - Mírnění rizika: knihovnu (např. gl-matrix) použít **jen v testech jako orákulum**, tedy porovnávat náhodné vstupy s referencí. Do produkčního kódu se nedostane.
2. **Knihovna (wgpu-matrix / gl-matrix) schovaná za naším API `vec3`/`mat4`.**
   - \+ Ověřená numerika pro matice a kvaterniony.
   - − Výjimka z pravidla „`core` neimportuje nic“ (nové ADR). − Roviny, paprsky a souřadné systémy stejně píšeme sami. − Obalování mutovatelného API do neměnného stojí kód i alokace.
3. **Nový modul `geom` (prstenec 1), který smí importovat knihovnu.**
   - \+ `core` zůstane čistý.
   - − Nový modul v tabulce [[01-architektura]] a v dependency-cruiseru, problém s rovinami a paprsky stejný jako u 2.

Návrh: **1 s orákulem v testech**. Knihovna by ušetřila hlavně inverzi matice (asi 40 řádků), ale zbytek geometrie bychom psali stejně. První potřeba přijde s viewportem a nástroji ([[M08-vykreslovani|M8]] a [[M09-interakce|M9]]).

**Pavel 2026-10-13:** knihovna, schovaná za fasádou `vec3`/`mat4` v `core` (možnost 2). Výjimku z pravidla „`core` neimportuje nic“ zdůvodní nové ADR. Před výběrem knihovny porovnat dostupné kandidáty.

## Porovnání knihoven

Stav k 2026-10-13. Ověřeno staženým balíčkem: typy přeložené `tsc` proti `readonly` n-tici, velikost změřená bundlerem `rolldown` po vytřesení pro sadu add, sub, scale, dot, cross, length, normalize, invert, multiply, rotace kolem osy, translace, transformace bodu, lookAt a perspective. Inverze vyzkoušená na singulární matici.

| Knihovna | Verze, poslední vydání | Stažení/týden | Styl API | float64 | `readonly` vstupy | Singulární inverze | Bundle (gzip) | Závislosti |
|---|---|---|---|---|---|---|---|---|
| **gl-matrix** | 3.4.4, 2025-08 | 10,7 M | funkce, povinný výstupní parametr `out` | ano, s vlastním `out` polem (`create()` dává float32) | ano (`ReadonlyVec3`) | `null` | **1,8 kB** | 0 |
| **wgpu-matrix** | 3.4.2, 2026-02 | 0,24 M | funkce, `dst` volitelný | ano (`vec3n`, `mat4n`) | ano | tiše `Infinity`/`NaN` | 9,7 kB (varianty z továrny, špatně se vytřásá) | 0 |
| **@thi.ng/vectors + matrices** | 8.7 / 3.0, 2026-08 | 8 tis. | funkce, `out` může být `null` | ano | ano (`ReadonlyVec`) | `undefined` | 2,3 kB | 8 + 4 (ekosystém thi.ng) |
| **@math.gl/core** | 4.1.0, 2024-09 | 1,3 M | proměnné třídy (`extends Array`), metody vrací `this` | ano | – | – | – | 1 |

Vyřazené:

- **gl-matrix 4** (beta od roku 2023): třídy dědí z `Float32Array`, tedy float32.
- **Three.js math, Babylon.js**: proměnné třídy. Three.js patří do `render` (prstenec 3), Babylon je obrovský.
- **math.gl**: proměnné třídy s řetězením jdou proti [[Neměnná data|neměnným datům]], dlouho bez vydání.
- **glm-js** (opuštěný 2017), **@vicimpa/glm** (GPL-3.0), **ts-matrix**, **vecti** (jen 2D), **mathjs** (obecná symbolická matematika).

Doplňkové knihovny (jiná otázka, ne náhrada):

- **@flatten-js/core**: 2D geometrie (úsečka, oblouk, kružnice, polygon, průsečíky, vzdálenosti). Kandidát pro 2D picking ve [[12-skicar|skicáři]] (M12).
- **ml-matrix**: obecná lineární algebra (SVD, vlastní čísla), např. pro proložení roviny body. Zatím nepotřebujeme.

Žádná z porovnávaných knihoven nemá rovinu, souřadný systém (obdobu `gp_Ax3`) ani průsečík paprsku s rovinou v podobě, kterou potřebujeme. Ty napíšeme nad fasádou sami.

Návrh: **gl-matrix 3.4.4**.

- Nejmenší po vytřesení, nejrozšířenější a prověřená léty.
- Hlavní nevýhodu, povinný parametr `out`, schová fasáda. `out` je u nás vždy nové pole `[0, 0, 0]`, a tím zároveň dostaneme float64.
- Má `readonly` typy vstupů jako my a singulární matici hlásí `null`, ne tichým `NaN`.
- Riziko: verze 3 se už jen udržuje a verze 4 uvízla v betě. Pro stabilní matematiku to nevadí, fasáda dovolí knihovnu vyměnit (například za wgpu-matrix) bez zásahu mimo `core/math/`.

## Rozhodnutí

2026-10-13: **gl-matrix 3.4 za fasádou `vec3`/`mat4` v `src/core/math/`**. Zdůvodnění a důsledky jsou v [[0012-gl-matrix-za-fasadou|ADR 0012]], propsáno do [[02-core]] a [[01-architektura]]. Orákulum v testech není potřeba, numeriku dělá sama knihovna. Stávající testy `vec3`/`mat4` ověřují, že fasáda drží naše konvence.
