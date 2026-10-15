---
type: milestone
status: doing
order: 27
aliases:
  - M27
  - M27 Oblouky a kružnice
modules:
  - sketch
  - sketcher
  - ui
specs:
  - "[[12-skicar]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M26-snapper-a-auto-vazby]]"
started: 2026-10-15
finished:
tags:
  - milnik
created: 2026-10-15
updated: 2026-10-15
---
# M27 – Oblouky a kružnice

**Cíl:** kružnice a oblouky jde zadat stejnými způsoby jako ve Fusionu; každý způsob vytvoří odpovídající vazby (tečnost, sdílené body).

**Specifikace:** [[12-skicar#Oblouky a kružnice (M27)]], [[12-skicar#Režim skicáře (sketcher)]], [[10-interakce#Nástroje a akce skicáře]], [[11-ui#Komponenty]]

**Navazuje na:** [[M26-snapper-a-auto-vazby|M26]] – tečné nástroje a výběr křivek používají snapper a inferenci tečnosti.

## Rozsah

Pavel 2026-10-15: „Zadávání oblouků a kružnic různými způsoby (inspiruj se ve Fusion).“

Rozhodnutí v sezení 2026-10-15 (brainstorming), Pavel vybral všechny nabídnuté způsoby:
- **Kružnice:** střed + bod (existuje), 2 body (průměr), 3 body, 2 tečny (ke dvěma křivkám, poloměr myší), 3 tečny.
- **Oblouk:** střed + začátek + konec (existuje), 3 body (začátek, bod na oblouku, konec), tečný z konce existující křivky.
- **Polyline:** tah z posledního bodu přepne na tečný oblouk, pak se pokračuje úsečkami (jako Fusion).
- Datový model se **nemění** (`circle`, `arc`); mění se jen nástroje, výpočet počáteční polohy (opsaná/vepsaná kružnice) a vznikající vazby.
- Nástroje se v liště sdruží do rozbalovacích skupin (Kružnice ▾, Oblouk ▾) jako ve Fusionu.

## Úkoly

- [x] 0. Kontrakt ve spec 12 (gesta, vazby, degenerované případy) a implementační plán
- [x] 1. Konstrukce v `sketch` (`circleFrom2`, `circleFrom3`, `arcFrom3`, `tangentArcFrom`, `tangentCircle`, `endTangent`)
- [ ] 2. Rodiny nástrojů v liště (`ToolDescriptor.family`, `ToolbarItem.variants`, dělené tlačítko v `Toolbar.vue`)
- [ ] 3. Nástroje kružnic (2 body, 3 body, 2 tečny, 3 tečny)
- [ ] 4. Nástroje oblouků (3 body, tečný)
- [ ] 5. Tečný oblouk v polyline
- [ ] 6. e2e `m27.spec.ts`, propsání do spec 10 a 11

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Kontrakt je v [[12-skicar#Oblouky a kružnice (M27)]]. Úkoly 1 a 2 jsou na sobě nezávislé (jiné moduly) a běží souběžně; 3–5 stojí na obou.

### 1. Konstrukce

- **Soubory:** nový `src/sketch/construct.ts`, export v `index.ts`; 2D pomůcky z `sketch/vec2.ts`.
- **Testy:** `test/unit/sketch/construct.test.ts` podle seznamu ve spec (tabulkově, tečnost výsledku ověřit vzdálenostmi).
- **Hotovo když:** `npm run check` zelený.

### 2. Rodiny nástrojů v liště

- **Soubory:** `src/interaction/tools.ts` (`family`), `toolbar-model.ts` (`variants`, naposledy aktivovaná varianta), `src/ui/components/Toolbar.vue` (dělené tlačítko, nabídka variant), `ui/toolbar-fit.ts`, i18n (`aria-label` šipky).
- **Testy:** `test/unit/interaction/toolbar-model.test.ts` (rodina = jedna položka, varianta, `active`), `renderToString` lišty.
- **Hotovo když:** `npm run check` zelený, stávající e2e lišty (`m19-1-toolbar`) projdou.

### 3. Nástroje kružnic

- **Soubory:** nové `src/sketcher/sketch-tools/circle2p-tool.ts`, `circle3p-tool.ts`, `circle-tangent-tool.ts` (2t i 3t), registrace v `sketch-tools.ts` s `family: 'circle'`, i18n popisků; `circle-tool.ts` dostane `family`.
- **Testy:** `test/unit/sketcher/sketch-tools/` – každý nástroj (entity, vazby, `required`, degenerovaný vstup, Esc, náhled).
- **Hotovo když:** `npm run check` zelený.

### 4. Nástroje oblouků

- **Soubory:** nové `arc3p-tool.ts`, `arc-tangent-tool.ts`, registrace s `family: 'arc'`, i18n.
- **Testy:** jako u 3; navíc prohození konců při `ccw === false`, navazující křivka tečného oblouku.
- **Hotovo když:** `npm run check` zelený.

### 5. Tečný oblouk v polyline

- **Soubory:** `line-tool.ts` (stisk a tah z posledního bodu), případně `common.ts` (`clickTool` s tahem).
- **Testy:** tah → oblouk + tečna, řetěz pokračuje z konce oblouku, tah bez předchozí křivky nic, Esc během tahu.
- **Hotovo když:** `npm run check` zelený.

### 6. e2e a spec

- **Soubory:** `test/e2e/m27.spec.ts`; [[10-interakce]] (tabulka nástrojů, rodiny v liště) a [[11-ui]] (dělené tlačítko).
- **Hotovo když:** e2e projdou, `npm run check` zelený, spec odpovídá kódu.

## Akceptační kritéria

- Každý nástroj vytvoří geometrii, kterou řešič přijme (`'ok'`) a jejíž vazby odpovídají gestu (např. 2 tečny → 2× `tangent`, 3 body přes existující body → 3× `pointOnCurve`).
- Degenerovaný vstup (tři body na přímce, tečny bez řešení, konec tečného oblouku na přímce tečny) nic nevytvoří a nástroj zůstane aktivní.
- Tah z posledního bodu polyline vytvoří tečný oblouk a kreslení pokračuje úsečkou z jeho konce.
- Kružnice a oblouky jsou v liště dvě dělená tlačítka (Kružnice ▾, Oblouk ▾) s naposledy použitou variantou.

## Co se naučíš

- Konstrukce kružnic z podmínek (Apolloniova úloha pro tři tečny) a proč ji v CAD stačí odhadnout a dořešit řešičem.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Souběžná stopa, [[Roadmapa#Souběžné stopy (pokus od M25)|pravidla]]: místo deníku sem zapisuje průběh; hlavní sezení ho při sloučení přenese do deníku.)_

- **2026-10-15, start:** `main` 98e8366 (sloučená stopa A s M25 a M26) natažen fast-forwardem. Kontrakt v [[12-skicar#Oblouky a kružnice (M27)]]. Rozhodnutí stopy k revizi:
  - A17: počáteční poloha tečných kružnic je numerický odhad (Gauss–Newton nad středem a poloměrem, u dvou křivek se slabým tahem ke kurzoru); přesnou tečnost dořeší řešič z povinných vazeb `tangent` – to je i učební cíl milníku (Apolloniova úloha se v CAD neřeší uzavřeným vzorcem).
  - A18: rozbalovací skupina = `ToolDescriptor.family`; tlačítko ukazuje naposledy aktivovanou variantu (jako Fusion), stav se neukládá. Zkratky zůstávají `C` a `A` na dosavadních nástrojích.
  - A19: body kliknuté nástroji 2p/3p nejsou entity (kružnice má jen střed a poloměr); vazbu dostane jen klik přichycený na existující bod (`pointOnCurve`). Vazby, které definují gesto (`tangent`, `pointOnCurve`), jsou povinné (`required`).
  - A20: `sketch.arc3p` má pořadí kliků začátek, konec, bod na oblouku (Fusion); oblouk po směru se v datech uloží prohozením konců.
  - A21: tečný oblouk v polyline vzniká stiskem a tahem z posledního bodu (Fusion); uvolnění ho zapíše.
- **2026-10-15, úkol 1** (konstrukce): hotovo, 36 tabulkových testů. A22: `tangentCircle` má po Levenberg–Marquardtu druhou fázi – projekci na tečné kružnice (Gauss–Newton s nejmenší normou nad rezidui tečnosti); slabý člen ke kurzoru jinak posune minimum o ~λ a tolerance tečnosti by odmítla běžná zadání. Propsáno do spec 12. `endTangent` úsečky/oblouku nulové délky a kružnice → null.

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
