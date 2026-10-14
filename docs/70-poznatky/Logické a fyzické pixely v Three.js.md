---
type: insight
status: seed
aliases:
  - pixelRatio v Three.js
topics:
  - render
  - three.js
sources:
  - "node_modules/three/src/renderers/WebGLRenderer.js (setViewport, setScissor)"
tags:
  - poznatek
created: 2026-10-14
updated: 2026-10-14
---
# Logické a fyzické pixely v Three.js

**Shrnutí:** API `WebGLRenderer` (`setSize`, `setViewport`, `setScissor`) bere logické (CSS) pixely a na pixely bufferu je násobí samo svým `pixelRatio`. Kdo by přepočítával sám, dostane na HiDPI dvojnásobek.

## Podrobnosti

- Renderer drží `_pixelRatio` z `setPixelRatio(devicePixelRatio)`. `setViewport(x, y, w, h)` a `setScissor(…)` uloží hodnoty a před voláním WebGL je vynásobí `_pixelRatio` a zaokrouhlí.
- Na displeji s `devicePixelRatio` 1 je chyba neviditelná, protože obě soustavy splývají. Projeví se až na Retina, kde se výřez posune a zvětší dvakrát.
- Osa y u `setViewport`/`setScissor` jde zdola (konvence WebGL), kdežto DOM a události počítají shora.
- Přímé čtení pixelů canvasu (`drawImage` z WebGL canvasu, `readPixels`) naopak pracuje ve fyzických pixelech bufferu.

## Jak to využívá tinycad

View cube v [[M17-kamera-a-view-cube|M17]] kreslí druhou scénu do rohu přes scissor ([[09-vykreslovani#View cube]]). Plán původně chtěl funkci `viewCubeRect` v pixelech bufferu. Implementátor si přečetl zdroják Three.js a před napsáním vrstvy upozornil, že by se násobilo dvakrát. `viewCubeRect` proto vrací CSS px a HiDPI řeší jediné místo, renderer. Stejně fungoval i dřívější osový kříž. Plán se dá zkontrolovat proti zdrojáku knihovny dřív, než chyba vznikne, podobně jako u [[Kontrolní seznam plánu proti ADR|kontroly plánu proti ADR]].

## Zdroje

- `node_modules/three/src/renderers/WebGLRenderer.js`, metody `setViewport` a `setScissor` (`.multiplyScalar(_pixelRatio).round()`).
