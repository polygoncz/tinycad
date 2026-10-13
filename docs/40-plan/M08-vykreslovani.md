---
type: milestone
status: todo
order: 8
aliases:
  - M8
  - M8 Vykreslování
modules:
  - render
specs:
  - "[[09-vykreslovani]]"
depends_on:
  - "[[M07-kernel-occt]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-13
---
# M8 – Vykreslování

**Cíl:** Three.js viewport, který zobrazí tělesa z regenerace, ovládá se jako Onshape a umí říct, co je pod kurzorem.

**Specifikace:** [[09-vykreslovani|09 – vykreslování]]

**Navazuje na:** [[M07-kernel-occt]]

## Úkoly

- [ ] Typy portu v `interaction`: `ViewportPort`, `HighlightPort`, `OverlayPort`, `PickResult`, `ViewPointerEvent`, `ViewKeyEvent` ([[0009-platformove-nezavisla-domena|ADR 0009]]). `render` je importuje jen jako typy.
- [ ] `Viewport implements ViewportPort`: mount/unmount, canvas, `ResizeObserver`, renderování na požádání, Z nahoru, mřížka, osový kříž, světla.
- [ ] Ovládání kamery (pravé tlačítko otáčí, prostřední posouvá, kolečko zoom ke kurzoru), `CameraController.fitAll()`, standardní pohledy (izometrie, shora, zepředu…).
- [ ] `MeshData` → `BodyView` (plochy + hrany, `polygonOffset`), `dispose`.
- [ ] Čisté funkce: diff těles pro `SceneSync`, trojúhelník → plocha (binární vyhledávání v `faceRanges`). Testy v Node.
- [ ] `SceneSync` / `BodyLayer.sync` s `MeshCache`, výměnou scény najednou a zahozením zastaralých výsledků.
- [ ] Picking ploch (raycast) a hran (vzdálenost v pixelech).
- [ ] `HighlightLayer` (hover, výběr) a `OverlayLayer` (pro náhledy nástrojů).
- [ ] Události pointeru a klávesnice → převod z DOM na `ViewPointerEvent`/`ViewKeyEvent` → `Viewport.events`.
- [ ] Dočasná dev stránka: dokument se dvěma kvádry → regenerace (OCCT) → viewport; hover zvýrazní plochu.

## Akceptační kritéria

- Dev stránka zobrazí kvádry s hranami, kamera funguje, hover zvýrazňuje správnou plochu.
- Při nečinnosti se nevykresluje (ověřit v Performance panelu).
- Změna parametru v dev stránce nevyvolá problikávání.
- `render` neimportuje `document`, `ops`, `regen`.

## Co se naučíš

Three.js (BufferGeometry, materiály, raycasting, správa GPU zdrojů), render-on-demand.

## Retrospektiva

_(vyplnit po dokončení)_
