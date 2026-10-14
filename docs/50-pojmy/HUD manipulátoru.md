---
type: concept
aliases:
  - HUD
  - ManipulatorHud
code: "ManipulatorHud / ManipulatorHud.vue"
module: "interaction"
summary: "Lišta režimů a editovatelné pole hodnoty, které jezdí s manipulátorem nad viewportem."
related:
  - "[[Manipulátor]]"
  - "[[Prezentační model]]"
tags:
  - pojem
created: 2026-10-14
updated: 2026-10-14
---
# HUD manipulátoru

Prvky nad viewportem, které patří k [[Manipulátor|manipulátoru]]: lišta pro přepínání jeho režimů (Volný, Posun, Rotace, Nastavit pivot) a pole s hodnotou naposledy použitého úchytu, do kterého jde psát. Stav drží [[Prezentační model|prezentační model]] `ManipulatorHud` v `interaction` s polohami ve světových souřadnicích. `ui` je promítne na obrazovku a při pohybu kamery prvky přesune. Na rozdíl od glyfů úchytů, které kreslí `render` ve WebGL, je HUD běžné DOM a umí překlady a formulářové prvky.

**V návrhu:** [[10-interakce#Režimy a HUD (M19)]], [[0022-rezimy-a-hud-manipulatoru|ADR 0022]]
**Souvisí:** [[Manipulátor]], [[Viewport]]
