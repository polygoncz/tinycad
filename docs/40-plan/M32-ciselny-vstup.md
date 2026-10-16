---
type: milestone
status: done
order: 32
aliases:
  - M32
  - M32 Číselný vstup
modules:
  - sketcher
  - interaction
  - render
  - ui
specs:
  - "[[12-skicar]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M31-nove-kreslici-nastroje]]"
started: 2026-10-16
finished: 2026-10-16
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M32 – Číselný vstup
**Cíl:** při kreslení jde zadat délku, úhel, poloměr nebo souřadnice z klávesnice místo kliknutí; zadaná hodnota se stane kótou.

> Upřesněno 2026-10-16 po rozhodnutí [[Q090 Číselný vstup při kreslení|Q090]]; kontrakt v [[12-skicar#Číselný vstup (M32)]].

**Specifikace:** [[12-skicar#Číselný vstup (M32)]], [[12-skicar#Režim skicáře (sketcher)]], [[10-interakce]], [[11-ui#Komponenty]]

**Navazuje na:** [[M31-nove-kreslici-nastroje|M31]] (stejné nástroje, stopa B). Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]].

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

Část „možnost zadat bod“, kterou Pavel upřesnil jako nástroj Bod **i** číselný vstup.

## Úkoly

- [x] Rozhodnout [[Q090 Číselný vstup při kreslení|Q090]] (styl Fusion, nebo Onshape; souřadnice; vznik kót).
- [x] Model vstupu a Tab na plátně.
- [x] Vstup v `clickTool`, vrstva v `ui`, úsečka, bod a přímka.
- [x] Obdélníky, kružnice a oblouk.
- [x] Drážky.
- [x] E2e a spec.

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Kontrakt: [[12-skicar#Číselný vstup (M32)]]. Úkoly 3 a 4 na sobě nezávisí (stojí na 2), sahají do různých souborů nástrojů – souběžně v izolovaných worktree.

### 1. Model vstupu a Tab na plátně

- **Soubory:** `src/sketcher/numeric-input.ts` (`InputField`, `NumericInput`, `emptyInput`, `inputKey`, `lockedValues`, `previewValues`), `src/interaction/viewport-port.ts` (`ViewKeyEvent.consume?`), `tool-manager.ts` (volá `consume` u zpracované klávesy), `src/render/viewport.ts` (`consume` = `preventDefault`).
- **Testy:** `numeric-input.test.ts` tabulkově podle spec; `tool-manager` (consume u vrstvy, nástroje, `unhandledKey`; nezpracovaná bez consume).
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 2. Vstup v `clickTool`, vrstva v `ui`, úsečka, bod a přímka

- **Soubory:** `src/sketcher/sketch-tools/common.ts` (`ClickHandlers.inputFields`, `constrain`, `measure`; vstup v `clickTool`), `sketch-session.ts` (`SketchState.numericInput`, nastavování jako náhled vazeb), `line-tool.ts`, `point-tool.ts`, `xline-tool.ts` (pole `x`/`y`, `length`/`angle`, kóty), `src/ui/sketch-input.ts` (`inputLayout`), `src/ui/components/SketchInput.vue`, `AppShell.vue`, i18n `sketch.input.*`.
- **Testy:** `clickTool` (pořadí kláves, omezený bod bez snapperu, náhled vs. klik, Enter, nový krok); úsečka (50 mm pod 30° → `distance` 50; 0° → `horizontal`; úhel k předchozí úsečce → `angle`), bod a přímka z X/Y; `inputLayout`; `SketchInput.vue`.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 3. Obdélníky, kružnice a oblouk

- **Soubory:** `rectangle-tool.ts`, `rectangle-center-tool.ts`, `rectangle3p-tool.ts`, `circle-tool.ts`, `arc-tool.ts`.
- **Testy:** pole každého kroku, `constrain`, kóty v datech a `required` (obdélník 40 × 20, kružnice ⌀ 30, oblouk R 10 s úhly).
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 4. Drážky

- **Soubory:** `slot-tool.ts` (případně `shape.ts`).
- **Testy:** pole každého kroku pro tři druhy, kóty (`distance`, `diameter`), `required`.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 5. E2e a spec

- **Soubory:** `test/e2e/m32.spec.ts` (úsečka 50 mm pod 30° jen z klávesnice, délka z klávesnice a směr myší, obdélník 40 × 20, kružnice ⌀ 30, první bod z X/Y), spec 10 (`ViewKeyEvent.consume`, `ClickHandlers`) a 11 (`SketchInput.vue`).
- **Hotovo když:** e2e projdou, `npm run check` je zelený, spec odpovídá kódu.

## Akceptační kritéria

- Entita nakreslená z klávesnice má přesně zadané rozměry a kóty v seznamu vazeb (úhly podle pravidla ve spec).
- Myš a klávesnice jdou kombinovat (délka z klávesnice, směr myší).

## Co se naučíš

Návrh stavového modelu vstupu nezávislého na konkrétním nástroji a jak oddělit prezentační model (`sketcher`) od vrstvy v `ui`.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Zapisuje stopa: rozhodnutí s Pavlem, odchylky od plánu, výsledky testů. Hlavní sezení to při sloučení přenese do deníku.)_

- **B5 (2026-10-16, Pavel):** [[Q090 Číselný vstup při kreslení|Q090]] – Fusion, kóta z každé zadané hodnoty, X/Y jen prvního bodu bez kót, hlavní nástroje, jen čísla.
- **B6 (Pavel):** psaná hodnota je jen náhled, zamkne ji `Tab` nebo `Enter` (jako Fusion); klik myší bere jen zamčené hodnoty.
- **B7 (Pavel):** úhel = směr od osy x; 0/180° → `horizontal`, 90/270° → `vertical`; u úsečky řetězu s předchozí úsečkou kóta `angle` mezi nimi; jinak a úhly oblouku bez kóty (vazba úhlu k ose roviny v datech není).
- **B8 (návrh stopy):** pole jsou štítky u kurzoru, ne `<input>` – fokus zůstává v pohledu; Tab na plátně drží `ViewKeyEvent.consume` (`preventDefault`).
- **Úkol 1 hotový:** `sketcher/numeric-input.ts` (50 tabulkových testů), `ViewKeyEvent.consume` (`ToolManager`, `render/view-events.ts`). Upřesnění krajních případů (Shift, `-` uprostřed, Tab s neplatným textem) dopsané do spec. `npm run check` zelený (6924 testů).
- **Úkol 2 hotový:** vstup v `clickTool` (`ToolMods`, `SnapMode.input` → `freeTarget`), `SketchState.numericInput`, `SketchInput.vue`, úsečka/bod/přímka s kótami. **B9 (rozhodnutí stopy podle akceptačního kritéria):** zamčený úhel vynechá automatické osy, rovnoběžnost, kolmost a tečnost, zamčená délka vynechá `equal` (`withoutLocked`) – jinak by řešič zadaný rozměr posunul. API propsané do spec 10, 11, 12. `npm run check` zelený (6996 testů).
- **Úkol 4 hotový:** drážky (3 druhy) s poli a povinnými kótami (`distance`, `diameter`), 16 testů; `sweep` modulo 360° a úhel začátku oblouku bez kóty dopsané do spec.
- **Úkol 3 hotový:** obdélníky (3 druhy), kružnice a oblouk s poli a povinnými kótami (`rectangle-input.ts`, `withTyped`), 24 testů. Po kontrole doplněno: dopočítané rohy se zadaným rozměrem se nepřichytí k blízkému bodu (`computedTolerance`, test). Zamčený průměr/poloměr vypne `equal` (B9).
- **Úkol 5 hotový:** e2e `m32.spec.ts` (5 scénářů × 2 prohlížeče: úsečka 50 mm pod 30° jen klávesnicí, délka + směr myší, obdélník 40 × 20, kružnice ⌀ 30, bod na 12,5; 7 s mřížkou); celé e2e 158/158. **B10 (rozhodnutí stopy):** délka/průměr s kurzorem přesně v předchozím bodě má výchozí směr +x (jako Fusion) místo tichého degenerovaného kroku.
- **Architektonická revize:** bez porušení ADR; 6 nálezů (duplicity mezi nástroji: kóta vzdálenosti, `withTyped`, `sweep`/poloměr, pole kroků a normála; `equal` přes `withoutLocked`; nevyužitý parametr `session` háčků) – opraveno, sdílené pomůcky v `common.ts` (propsáno do spec 12), `SketchInput` ve stromu komponent spec 11. `npm run check` zelený (7037 testů), e2e m31 + m32 22/22.
- **Natažení `main`:** jen deník a tabulka id ve spec 12, bez konfliktů. `npm run check` zelený (7037 unit, 41 integračních), celé e2e 158/158.

## Retrospektiva

_(Návrh stopy, Pavel doplní nebo upraví.)_

**Splnění kritérií:** entita z klávesnice má přesné rozměry a kóty – e2e `m32.spec.ts` (úsečka 50 mm pod 30° jen klávesnicí: body na 6 desetinných míst a jediná kóta 50; obdélník 40 × 20; kružnice ⌀ 30; bod na 12,5; 7) a unit testy každého nástroje; myš a klávesnice dohromady – zamčená délka a směr myší (e2e i unit).

**Co bylo jinak, než se čekalo:**
- „Každá zadaná hodnota = kóta“ narazila na úhel: vazba úhlu k ose roviny v datech není, takže úhel bez reference jen umístí geometrii (B7). Pravidlo vzniklo až při návrhu tabulky polí, ne v [[Q090 Číselný vstup při kreslení|Q090]].
- Zamčená hodnota se bila s automatickými vazbami z M26 (osa do 3°, `equal` do 2 %) a s přichycením dopočítaných rohů – řešič by zadaný rozměr posunul. Pravidlo „zamčené má přednost“ (B9) a `computedTolerance` přišly až z implementace a kontroly.
- Tab na plátně: prohlížeč ho bere pro fokus a `render` dřív `preventDefault` nevolal – malá změna portu (`ViewKeyEvent.consume`).
- Souběžné úkoly 3 a 4 si každý napsal vlastní pomůcky (`sweep`, poloměr, normála, kóta vzdálenosti); revize je sjednotila do `common.ts`.

**Co se osvědčilo:**
- Napojení přes `ToolMods.input` → `snapAt` vrací volný cíl: nástroje dostaly omezený bod bez vlastní logiky přeskočení snapperu.
- Model vstupu jako čistá funkce (50 tabulkových testů) a `ui` jen kreslí stav – stejný vzor jako náhled vazeb z M26.
- Rozhodnout s Pavlem dvě věci, které mění chování (zamykání Tabem, úhel bez kóty), a krajní případy (výchozí směr +x, `sweep` modulo 360°) řešit podle akceptačních kritérií a zapisovat jako B-rozhodnutí.
