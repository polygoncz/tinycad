---
type: milestone
status: todo
order: 25
aliases:
  - M25
  - M25 Glyfy vazeb
modules:
  - sketcher
  - app
  - ui
specs:
  - "[[12-skicar]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M24-realisticke-zobrazeni]]"
started:
finished:
tags:
  - milnik
created: 2026-10-15
updated: 2026-10-15
---
# M25 – Glyfy vazeb

**Cíl:** vazby editované skici jsou vidět ve viewportu jako značky (glyfy) u vybraných a najetých entit jako v Onshape. Glyf jde najet myší, vybrat a smazat; seznam vazeb v panelu skici je jen sbalená sekce.

**Specifikace:** [[12-skicar#Kresba a picking]], [[09-vykreslovani#Skici]], [[10-interakce#Skicář]], [[11-ui#Komponenty]]

**Navazuje na:** [[M24-realisticke-zobrazeni|M24]] (pořadí, ne technicky). První milník série *Rozšíření skicáře* (M25–M29), viz [[12-skicar#Rozšíření skicáře (M25–M29)]]. Glyfy jsou první, protože auto-vazby ze snapperu ([[M26-snapper-a-auto-vazby|M26]]) a nové nástroje ([[M27-oblouky-a-kruznice|M27]]) bez viditelné zpětné vazby nejde rozumně ladit.

## Rozsah

Pavel 2026-10-15: „Vazby nebudeme dělat ve výpisu té sketch (ten by mě jako uživatele rozčiloval, ale je dobrý na vývoj). Tady bych se opět inspiroval ve Fusion a Onshape, kde se to znázorňuje glyfy ve viewportu.“

Rozhodnutí v sezení 2026-10-15 (brainstorming a [[Q083 Rozložení glyfů vazeb|Q083]]):
- Glyf = malá ikona druhu vazby u entity; vazba mezi dvěma entitami má glyf u obou. `coincident` se kreslí jako plná tečka.
- **Styl Onshape:** glyfy jen u vybraných a najetých entit; přepínač „Zobrazit vazby“ v panelu ukáže všechny.
- Najetí na glyf zvýrazní entity vazby, klik vybere vazbu (`SketchItemId`), Delete ji smaže.
- Glyfy kreslí **vrstva v `ui` nad pohledem** jako kóty z [[M19.2-ux-backlog|M19.2]], ne `render`; nový `PickKind` nevzniká.
- Seznam vazeb v panelu zůstane jako **sbalená sekce**.

Kontrakt: [[12-skicar#Glyfy vazeb (M25)]].

## Úkoly

- [x] 0. Rozhodnout [[Q083 Rozložení glyfů vazeb|Q083]], kontrakt ve spec 12
- [ ] 1. `sketcher`: `glyphViews`, `SketchState.glyphs`, přepínač `showAllConstraints`, zvýraznění entit najeté/vybrané vazby
- [ ] 2. `ui`: `glyphLayout`, ikony, `SketchGlyphs.vue` v `AppShell`
- [ ] 3. `ui`: sbalitelná sekce vazeb a přepínač v `SketchPanel`, i18n
- [ ] 4. e2e `m25.spec.ts`, propsání do spec 10 a 11

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Kontrakt je v [[12-skicar#Glyfy vazeb (M25)]].

### 1. `glyphViews` a stav session

- **Soubory:** nový `src/sketcher/sketch-glyphs.ts`; `sketch-session.ts` (`SketchState.glyphs`, množina viditelnosti z výběru a hoveru, zvýraznění entit vazby v kresbě), `sketch-editor.ts` (`showAllConstraints`, `setShowAllConstraints`), `index.ts` (export `SketchGlyphView`, `GlyphKind`); `src/app` jen reexport typů, pokud je `ui` potřebuje.
- **Testy:** `test/unit/sketcher/sketch-glyphs.test.ts` (podle seznamu testů ve spec), doplnit `sketch-session.test.ts` a `sketch-editor.test.ts`.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 2. Vrstva glyfů v `ui`

- **Soubory:** nové `src/ui/sketch-glyphs.ts` (`glyphLayout`), `src/ui/sketch-glyph-icons.ts` (SVG ikony všech `GlyphKind` – tvar podle Fusionu/Onshape: rovnoběžky, pravý úhel, `=`, tečna, zámek, `H`, `V`, tečka), `src/ui/components/SketchGlyphs.vue`; `AppShell.vue` (připojení vedle `SketchDimensions`).
- **Testy:** `test/unit/ui/sketch-glyphs.test.ts`, test komponenty (hover, klik, `aria-pressed`).
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 3. Panel

- **Soubory:** `SketchPanel.vue` (seznam vazeb a kót v `<details>`, výchozí sbalený; přepínač „Zobrazit vazby“), `ui/i18n/cs.ts`, `en.ts`.
- **Testy:** test panelu (sbalené ve výchozím stavu, přepínač volá `setShowAllConstraints`).
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 4. e2e a spec

- **Soubory:** `test/e2e/m25.spec.ts`; úprava e2e, které klikají na řádky vazeb (rozbalit sekci); [[10-interakce]] (`SketchState.glyphs`, `showAllConstraints`) a [[11-ui]] (`SketchGlyphs`, panel).
- **Hotovo když:** e2e projdou, `npm run check` je zelený, spec odpovídá kódu.

## Akceptační kritéria

- Výběr nebo najetí na entitu ukáže glyfy všech jejích geometrických vazeb (u `coincident` tečku); přepínač „Zobrazit vazby“ ukáže glyfy všech vazeb skici. Glyfy u téže kotvy se nepřekrývají.
- Najetí na glyf zvýrazní entity vazby; klik a Delete vazbu smaže a DOF se přepočítá.
- Seznam vazeb v panelu je ve výchozím stavu sbalený.

## Co se naučíš

- Proč je HTML/SVG vrstva nad WebGL pohledem pro malé množství interaktivních značek jednodušší než sprity ve scéně (události, přístupnost, ikony).
- Skládání značek u kotvy v pixelech z průmětu bodů modelu.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Souběžná stopa, [[Roadmapa#Souběžné stopy (pokus od M25)|pravidla]]: místo deníku sem zapisuje průběh; hlavní sezení ho při sloučení přenese do deníku.)_

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
