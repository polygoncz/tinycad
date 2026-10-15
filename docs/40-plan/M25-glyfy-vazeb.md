---
type: milestone
status: done
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
started: 2026-10-15
finished: 2026-10-15
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
- [x] 1. `sketcher`: `glyphViews`, `SketchState.glyphs`, přepínač `showAllConstraints`, zvýraznění entit najeté/vybrané vazby
- [x] 2. `ui`: `glyphLayout`, ikony, `SketchGlyphs.vue` v `AppShell`
- [x] 3. `ui`: sbalitelná sekce vazeb a přepínač v `SketchPanel`, i18n
- [x] 4. e2e `m25.spec.ts`, propsání do spec 10 a 11

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

- **2026-10-15, úkol 1** (`glyphViews`, `SketchState.glyphs`, `showAllConstraints`): hotovo. Rozhodnutí stopy k revizi (propsáno do [[12-skicar#Glyfy vazeb (M25)]]):
  - A1: řada glyfů (`slot`) se skládá podle **polohy kotvy** (shoda do 1e-6 mm), ne podle entity – jinak by se tečka `coincident` a `fix` na shodných bodech překrývaly (akceptační kritérium).
  - A2: vybraná nebo najetá křivka přidá do množiny viditelnosti své definiční body, takže výběr úsečky ukáže i `coincident`/`fix` na jejích koncích (jako Onshape).
  - A3: kóta glyf nemá a vybraná/najetá kóta nic nezvýrazní; `slot` čísluje jen zobrazené glyfy; úsečka nulové délky má `side` +y.
- **2026-10-15, úkol 2** (`glyphLayout`, ikony, `SketchGlyphs.vue`): hotovo. Obsluha událostí je čistá `glyphListeners` (ADR 0010), komponenta se testuje přes `renderToString`.
  - A4: navázání událostí a přepočet po změně pohledu ověří e2e (úkol 4) – projekt nemá DOM prostředí pro testy komponent a přidávat ho kvůli M25 nestojí za novou knihovnu.
  - A5: glyf, jehož `side` se na obrazovku nepromítne (rovina z hrany), se nekreslí, stejně jako nepromítnutá kotva.
- **2026-10-15, úkol 3** (panel): hotovo. Stav `open` drží sám element `<details>`, Vue ho nepřepisuje.
  - A6: když panel dává fokus poli nové kóty, sbalená sekce se sama rozbalí (jinak by fokus nešel); propsáno do spec 12.
- **2026-10-15, úkol 4** (e2e, spec 10 a 11): `m25.spec.ts` hotový, celé e2e 106/106 (chrome + webkit, `E2E_PORT=4201`). Helper `dimensionInput` sekci vazeb nejdřív rozbalí; m12, m13 a m19-2-dimensions upravené. Delete po kliku na glyf funguje bez přesunu fokusu (zkratky blokuje jen textové pole).
- **2026-10-15, revize** (`architecture-reviewer`): bez vážných porušení. Opraveno: `constraintEntities` a `definingPoints` v `sketcher` duplikovaly `constraintTargets` a `curvePoints` ze `sketch` – `sketch` je teď exportuje (znalost modelu na jednom místě, stopy M26–M29 doplňují nové druhy jen tam); třetí kopie `ccwSweep` sjednocena do `sketcher/sketch-angles.ts`; ve spec 12 opravena buňka M25 v tabulce rozšíření (glyfy nejsou v `SketchDrawing`) a doplněno pravidlo „`side` promítnutý na nulovou délku“.
- **2026-10-15, uzavření:** `npm run check` zelený (5783 unit, 35 integračních), e2e 106/106 v chrome i webkit. Commit na větev `claude/stopa-a-m25-m27-f7ea83`.

## Retrospektiva

- **Co šlo dobře:** kontrakt ve spec 12 byl dost přesný, čtyři úkoly proběhly bez návrhových zastavení; implementátor vrátil jen výkladové otázky (skládání kotev, definiční body křivek), které se vyřešily upřesněním spec (A1–A6). Vzor `dimensionViews` / `SketchDimensions` z M19.2 šel převzít skoro jedna k jedné.
- **Co drhlo:** sbalená sekce v panelu rozbila e2e, které čtou pole kót; v helperu vznikl souběh mezi automatickým rozbalením po `nextTick` a klikem testu (řešeno `toPass()`). Projekt pořád nemá DOM prostředí pro testy komponent – navázání událostí glyfů ověřuje jen e2e.
- **Souběh stop:** stopa A měnila `sketch/index.ts` (export `constraintTargets`, `curvePoints`) a spec 10/11/12 jen ve svých odstavcích; konflikty při sloučení se čekají nanejvýš v `sketch/index.ts` (exporty, které přidávají i B a C) a v `AppShell.vue` (stopa B tam může sahat kvůli kótám). Vlastní port `E2E_PORT` na worktree se osvědčil.
- **Kandidát na poznatek** (do `70-poznatky/` při sloučení, stopa poznatky nezakládá): malé množství interaktivních značek nad WebGL pohledem je jednodušší jako HTML vrstva s čistou funkcí rozložení než jako sprity ve scéně – události, přístupnost a klávesové zkratky jsou zdarma, picking netřeba rozšiřovat.
- **Pro M26:** glyfy nových vazeb (`pointOnCurve`, `midpoint`, zarovnání) = nový člen `GlyphKind`, kotva v `glyphViews`, ikona v `GLYPH_ICONS` – typecheck všechna místa ukáže.
