---
type: concept
aliases:
  - render
code: "Viewport"
module: "render"
summary: "3D pohled: Three.js scéna, kamera, picking, render na požádání."
related:
  - "[[Těleso]]"
  - "[[Handle tvaru]]"
tags:
  - pojem
created: 2026-10-12
updated: 2026-10-13
---
# Viewport

3D pohled postavený na Three.js: scéna, kamera (Z nahoru, ovládání jako Onshape), picking ploch a hran, zvýraznění, overlay pro nástroje. Vykresluje jen na požádání. O dokumentu neví nic – pracuje s [[Těleso|tělesy]] a sítěmi. Nástroje ho vidí jen přes port `ViewportPort`, který definuje `interaction` a `Viewport` ho implementuje ([[0009-platformove-nezavisla-domena|ADR 0009]]).

**V návrhu:** [[09-vykreslovani]]
**Souvisí:** [[Těleso]], [[Handle tvaru]]
