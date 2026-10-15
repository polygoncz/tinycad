---
type: insight
status: seed
aliases:
  - Multisample render target
  - MSAA a lineární prostor
topics:
  - vykreslování
  - WebGL
sources:
  - https://threejs.org/docs/#api/en/renderers/WebGLRenderTarget.samples
  - https://registry.khronos.org/webgl/specs/latest/2.0/#3.7.8
  - node_modules/three/src/renderers/webgl/WebGLTextures.js (resolve multisample, three 0.186)
tags:
  - poznatek
created: 2026-10-15
updated: 2026-10-15
---
# MSAA v render targetu

**Shrnutí:** Render target s MSAA vyhlazuje hrany jinak než plátno. Vzorky průměruje v lineárním prostoru a hloubku drží ve vlastním multisample renderbufferu, který se mezi targety sdílet nedá.

## Podrobnosti

- **Vyhlazení není zdarma:** plátno vyhlazuje díky `antialias: true` při vytvoření kontextu. Render target vyhlazuje jen tehdy, když dostane `samples` (WebGL2). Bez nich je výsledek postprocessingu zubatý.
- **Lineární průměr:** postprocessing kreslí do lineárního targetu (`HalfFloatType`) a do sRGB převádí až výstupní průchod. MSAA proto průměruje lineární hodnoty. Tmavá jednopixelová čára na světlém pozadí pak po převodu vyjde světlejší a opticky tenčí než na plátně, které průměruje už v sRGB. V tinycad pixel hrany vyšel 105 místo 88.
- **Hloubka se nesdílí:** u MSAA targetu se kreslí do multisample renderbufferů a do textur se výsledek kopíruje (resolve) až při přepnutí targetu. Když dva targety dostanou stejný `DepthTexture`, sdílí jen tuto kopii, ne renderbuffer. Druhý target proto při kreslení hloubku prvního nevidí.
- **Paměť:** RGBA16F se 4 vzorky stojí při 2880 × 1800 stovky MB. Vyplatí se target vytvářet jen tehdy, když ho efekt opravdu potřebuje.
- **Alternativa FXAA/SMAA:** vyhlazuje až z hotového obrazu a rozmazává tenké čáry. Pro CAD, kde jsou hrany to nejdůležitější, je MSAA lepší.

## Jak to využívá tinycad

Pipeline AO ([[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]], [[09-vykreslovani#Víceprůchodové vykreslování (AO)]]) má jeden target s `samples: 4`. Kvůli sdílení hloubky všechny průchody kreslí do něj, viz [[Postprocessing na místě]]. Světlejší hrany s AO jsou přijaté známé omezení z [[M23-postprocessing-a-ao|M23]]. Souvisí s [[Logické a fyzické pixely v Three.js]] (velikost targetu krát poměr pixelů).

## Zdroje

- three.js: `WebGLRenderTarget.samples`
- WebGL 2.0: multisample renderbuffery a `blitFramebuffer`
- Zdrojáky three 0.186, resolve multisample targetu
