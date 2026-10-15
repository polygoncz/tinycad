---
type: concept
aliases:
  - Režim zobrazení
  - Display style
code: "DisplayStyle"
module: "render"
summary: "Jak viewport kreslí tělesa: režim (Shaded, Hidden lines, Wireframe, Realistic) a přepínače hran, průhlednosti, triangulace a AO."
related:
  - "[[Viewport]]"
  - "[[Těleso]]"
tags:
  - pojem
created: 2026-10-15
updated: 2026-10-15
---
# Styl zobrazení

Neměnná hodnota `DisplayStyle`, která říká, **jak** [[Viewport|viewport]] kreslí [[Těleso|tělesa]]: režim (`shaded`, `hiddenRemoved`, `hiddenVisible`, `wireframe`, od M24 `realistic`) a nezávislé přepínače (hrany, průhlednost, triangulace, od M23 AO). Je to předvolba stránky jako téma nebo režim otáčení, ne součást dokumentu: neukládá se do logu operací a nemá undo. Čistá funkce `resolveDisplay` z ní spočítá plochý *plán vykreslení* (`DisplayPlan`). Jen podle plánu se v `render` vybírají materiály, kreslí skryté hrany a rozhoduje, jestli picking vidí skrz plochy. Od barvy tělesa (vlastnost dokumentu, [[Q073 Průhlednost a barva těles|Q073]]) se liší tím, že platí pro celou scénu.

**V návrhu:** [[09-vykreslovani#Styl zobrazení]], [[11-ui#Komponenty]]
**Souvisí:** [[M22-rezimy-zobrazeni]], [[M23-postprocessing-a-ao]], [[M24-realisticke-zobrazeni]]
