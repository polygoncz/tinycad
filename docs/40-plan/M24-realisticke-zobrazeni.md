---
type: milestone
status: todo
order: 24
aliases:
  - M24
  - M24 Realistické zobrazení
modules:
  - document
  - ops
  - persistence
  - interaction
  - render
  - app
  - ui
specs:
  - "[[03-dokument]]"
  - "[[04-operace-a-historie]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M23-postprocessing-a-ao]]"
started:
finished:
tags:
  - milnik
created: 2026-10-15
updated: 2026-10-15
---
# M24 – Realistické zobrazení

> [!note] Hrubý plán
> Úkoly a akceptační kritéria se upřesní při zahájení milníku. Nejdřív se rozhodne [[Q078 Sada materiálů těles|Q078]] a sepíše ADR o materiálu tělesa v dokumentu.

**Cíl:** [[Styl zobrazení|styl zobrazení]] dostane režim Realistic: fyzikálně založené materiály, osvětlení z environment mapy, tone mapping a kontaktní stín. [[Těleso]] má v dokumentu materiál (plast, hliník, ocel…), který jde vybrat v [[Prohlížeč|Prohlížeči]].

**Specifikace:** [[09-vykreslovani#Styl zobrazení]], [[03-dokument#Metadata těles]], [[04-operace-a-historie#Sada operací]], [[10-interakce]], [[11-ui#Komponenty]]

**Navazuje na:** [[M23-postprocessing-a-ao|M23]]

## Rozsah

**Dokument a operace** (vzor barvy z [[M15-export-a-dokonceni|M15]], [[Q073 Průhlednost a barva těles|Q073]]):
- `BodyMeta.material` (předvolba, chybí = výchozí), validace v `fromData` a v operaci, nová operace `body.setMaterial` (log, undo), verze schématu a operace podle pravidel migrace.
- `BrowserModel.materials` a `setMaterial`, `Viewport.setBodyMaterial` a znovupoužití po `sync` v `ViewportMirror` (jako barva a skrytí).

**Vykreslování:**
- `DisplayMode` dostane `'realistic'`, `DisplayPlan.faces` hodnotu `'physical'` a `DisplayPlan` část pro scénu (mřížka, světla, tone mapping, environment), kterou aplikuje viewport.
- `MeshPhysicalMaterial` podle předvolby a barvy tělesa ([[Q078 Sada materiálů těles|Q078]]), materiály sdílené podle dvojice (materiál, barva) s počtem uživatelů, jako dnes barvy.
- Environment mapa z `RoomEnvironment` přes `PMREMGenerator` (generovaná v kódu, nic se nestahuje). Tone mapping AgX jen v Realistic (změna `toneMapping` vynutí rekompilaci shaderů, proto jen při přepnutí režimu).
- Mřížka skrytá, místo ní kontaktní stín pod modelem ve výšce spodku obálky viditelných těles. Pozadí je jemný gradient.
- Hrany se v Realistic nekreslí, triangulace a AO ano (AO výchozí podle [[Q077 Technika AO|Q077]]).

**UI:** režim Realistic v menu, výběr materiálu v kontextovém menu tělesa v Prohlížeči vedle barvy.

**ADR:** materiál tělesa v dokumentu (proč předvolba, ne parametry rendereru; vztah k barvě).

## Úkoly

- [ ] Rozhodnout [[Q078 Sada materiálů těles|Q078]], sepsat ADR, doplnit spec 03, 04, 09, 10, 11 a implementační plán

## Akceptační kritéria

- _(upřesní se při zahájení)_

## Co se naučíš

- PBR: `metalness`/`roughness`, image-based lighting, PMREM a proč environment mapa potřebuje předfiltrování.
- Tone mapping a lineární barevný prostor: proč render „spálí“ světla bez tone mappingu.
- Jak přidat vlastnost tělesa skrz všechny vrstvy (dokument → operace → prezentační model → render) podruhé a co se od M15 zjednodušilo.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
