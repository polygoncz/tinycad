---
type: insight
status: seed
aliases:
  - Tone mapping v postprocessingu
  - AgX v shaderu materiálu
topics:
  - vykreslování
  - Three.js
sources:
  - node_modules/three/src/renderers/webgl/WebGLPrograms.js (výběr toneMapping, three 0.186)
  - node_modules/three/src/renderers/shaders/ShaderChunk/tonemapping_fragment.glsl.js
  - https://threejs.org/docs/#api/en/renderers/WebGLRenderer.toneMapping
tags:
  - poznatek
created: 2026-10-15
updated: 2026-10-15
---
# Tone mapping a render target

**Shrnutí:** Three dělá tone mapping v shaderu materiálu jen při kreslení na plátno. Při kreslení do render targetu ho nechává na výstupním průchodu, který pak zasáhne celý obraz. Když má tone mapping platit jen pro část scény, patří do shaderu jejích materiálů.

## Podrobnosti

- **Kde three tone mapping zapne:** `WebGLPrograms` nastaví `toneMapping` materiálu podle `renderer.toneMapping` jen tehdy, když je aktuální render target `null` (plátno) nebo XR. Do render targetu kreslí lineárně a `OutputPass` pak křivku použije na všechno.
- **Proč nejde tone mapping „na místě“:** násobení (AO) jde udělat blendingem nad pixelem, který už v targetu je. Tone mapping je nelineární křivka, kterou blending nevyjádří. Shader by tedy musel číst barvu z targetu, do kterého zapisuje, a to je zakázaný feedback loop. Výměna dvou targetů (ping-pong) zase ztratí hloubku, viz [[Postprocessing na místě]].
- **Řešení v materiálu:**
  - `onBeforeCompile` vloží `ShaderChunk.tonemapping_pars_fragment` za `#include <common>` a nahradí `#include <tonemapping_fragment>` voláním `AgXToneMapping(...)`.
  - Expozici dodá vlastní uniforma. Uniformy materiálu se nahrávají až po těch, které nastavuje renderer, takže vlastní hodnota vyhraje.
  - `customProgramCacheKey` odliší program od běžného materiálu.
  - `renderer.toneMapping` zůstává `NoToneMapping`, takže ostatní objekty (UI ve scéně) mají přesné barvy.
- **Cena:** kód závisí na textu shader chunků. Kanárkový test v Node ověří, že chunky ve fyzikálním shaderu existují. Efekt, který přijde po materiálu (AO), pak pracuje s už tone-mapovanými barvami.

## Jak to využívá tinycad

Režim Realistic: tělesa s `MeshPhysicalMaterial` mají AgX v shaderu, výběr, skici a manipulátory zůstávají v barvách palety a Realistic bez AO kreslí bez composeru ([[0027-material-telesa-a-scena-realistic|ADR 0027]], [[Q082 Scéna režimu Realistic|Q082]], [[09-vykreslovani#Realistic]]). Navazuje na [[MSAA v render targetu]].

## Zdroje

- Zdrojáky three 0.186: `WebGLPrograms.js`, `tonemapping_fragment`, `tonemapping_pars_fragment`
- Dokumentace three.js: `WebGLRenderer.toneMapping`
