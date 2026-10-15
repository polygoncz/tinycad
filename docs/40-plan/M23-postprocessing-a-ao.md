---
type: milestone
status: todo
order: 23
aliases:
  - M23
  - M23 Postprocessing a AO
modules:
  - render
  - app
  - ui
specs:
  - "[[09-vykreslovani]]"
  - "[[11-ui]]"
depends_on:
  - "[[M22-rezimy-zobrazeni]]"
started:
finished:
tags:
  - milnik
created: 2026-10-15
updated: 2026-10-15
---
# M23 – Postprocessing a AO

> [!note] Hrubý plán
> Úkoly a akceptační kritéria se upřesní při zahájení milníku. Nejdřív se rozhodne [[Q077 Technika AO|Q077]] a sepíše ADR o víceprůchodovém vykreslování.

**Cíl:** vykreslování viewportu umí víc průchodů (`EffectComposer`) a [[Styl zobrazení|styl zobrazení]] dostane přepínač ambient occlusion v režimech, kde dává smysl.

**Specifikace:** [[09-vykreslovani#Styl zobrazení]], [[11-ui#Komponenty]]

**Navazuje na:** [[M22-rezimy-zobrazeni|M22]]

## Rozsah

- `DisplayStyle.ao` a `DisplayPlan.ao`. AO platí jen v Shaded bez průhlednosti (a od M24 v Realistic). Jinde se přepínač ignoruje a v menu je zašedlý. Průhledné plochy nezapisují hloubku a AO z hloubkového bufferu by pod nimi kreslilo tmavé skvrny.
- `viewport.draw()`: při `ao: false` beze změny (jeden `renderer.render`, žádná cena navíc), při `ao: true` průchod přes composer: model → AO → výstup. Zvýraznění, overlay, skici, manipulátory a mřížka se dokreslí **po** AO, aby je AO neztmavilo ([[Q077 Technika AO|Q077]]). View cube dál až nakonec.
- Antialiasing: render target composeru nemá MSAA zdarma. Řeší se vzorky render targetu (WebGL2) nebo průchodem FXAA/SMAA, rozhodne se v ADR.
- Změna velikosti plátna a `devicePixelRatio` pro render targety, uvolnění při `unmount`.
- Controller v `ui` doplní pole `ao` (validace po polích z M22 starý uložený styl přečte) a menu dostane přepínač AO.
- ADR: víceprůchodové vykreslování ve viewportu (co se kreslí v jakém průchodu, kdo vlastní render targety).

## Úkoly

- [ ] Rozhodnout [[Q077 Technika AO|Q077]], sepsat ADR, doplnit spec 09 a implementační plán

## Akceptační kritéria

- _(upřesní se při zahájení)_

## Co se naučíš

- Postprocessing v Three.js: render targety, průchody, `EffectComposer`, `OutputPass` a barevný prostor.
- Jak funguje screen-space AO (hloubka a normály → odhad zastínění) a proč selhává u průhledných ploch.
- Proč render target přichází o MSAA a jak to obejít.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
