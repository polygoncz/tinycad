---
type: milestone
status: done
order: 37
aliases:
  - M37
  - M37 Text ve skice
modules:
  - sketch
  - features
  - sketcher
  - render
  - ui
specs:
  - "[[12-skicar]]"
depends_on:
  - "[[M30-geometrie-skici-v-occt]]"
  - "[[M36-zrcadleni-a-pole]]"
started: 2026-10-16
finished: 2026-10-17
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M37 – Text ve skice
**Cíl:** nástroj Text: řetězec v daném fontu, výšce, poloze a natočení se ve skice zobrazí jako obrysy písmen, které tvoří oblasti pro vysunutí.

> Upřesněno 2026-10-16 po rozhodnutí [[Q091 Fonty pro text ve skice|Q091]]: kontrakt v [[12-skicar#Text ve skice (M37)]], plán níže. Sdílené typy jsou zafixované v [[12-skicar#Sdílené kontrakty série II]].

**Specifikace:** [[12-skicar#Text ve skice (M37)]], [[0029-text-ve-skice-pres-opentype|ADR 0029]]

**Navazuje na:** [[M30-geometrie-skici-v-occt|M30]] (oblasti písmen s dírami počítá jádro) a [[M36-zrcadleni-a-pole|M36]] (pořadí ve stopě C). Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]].

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

Upřesnění v sezení 2026-10-16: obrysy přes knihovnu **opentype.js** v TS ([[0029-text-ve-skice-pres-opentype|ADR 0029]]), ne přes OCCT (předpřipravený build nemá fonty).

## Úkoly

- [x] Rozhodnout [[Q091 Fonty pro text ve skice|Q091]].
- [x] Adaptér `text-opentype`, fonty, port `TextOutliner`, pravidla závislostí.
- [x] Entita text, kontrola dat, `textCurves`, odvozená id, oblasti.
- [x] HUD nápověda nástrojů (`ToolHint`, `ToolHintHud`), naplněná u zrcadlení a polí.
- [x] Kresba, výběr, nástroj Text, `setTextParams` a panel.
- [x] Integrační test a e2e (gravírování „tinycad“), spec 01, 10, 11.

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Kontrakt: [[12-skicar#Text ve skice (M37)]].

### 1. Adaptér a fonty

- **Soubory:** `src/sketch/text.ts` (port `TextOutliner`, typy `TextFontId`, `TextContour`, `TextSegment` v `model.ts`), nový modul `src/text-opentype/` (`index.ts`, `outliner.ts`, `fonts/*.ttf` + `LICENSE`), `.dependency-cruiser.cjs` (modul `text-opentype`: `core`, `sketch`, npm `opentype.js`; importuje ho jen `app`), `package.json` (`opentype.js`), `FakeTextOutliner` v `sketch/testing.ts`.
- **Testy:** `test/unit/text-opentype/outliner.test.ts` v Node se skutečným fontem přes `fs` („o“ dá 2 smyčky, „B“ 3, mezera 0, smyčky uzavřené, `char`/`code` sedí, výška škáluje, y nahoru, `advance` roste s textem, cache fontu).
- **Hotovo když:** testy projdou, `npm run check` zelený.

### 2. Entita text

- **Soubory:** `src/sketch/model.ts` (`SketchText`, `TEXT_FONTS`, `MAX_TEXT_LENGTH`), `parse.ts`, `edit.ts` (`removeItems`, `toggleConstruction`, `constraintFor`/`dimensionFor`), `text.ts` (`textCurves`), `patterns.ts` nebo nový soubor (`derivedOwner`), `geometry.ts` (`regionCurves`, `isRegionCurve`), `isPatternSource`.
- **Testy:** `parse.test.ts`, `edit.test.ts`, `text.test.ts` (transformace, Bézier → bspline, odvozená id, úsečka nulové délky), `geometry.test.ts` (text v oblastech, konstrukční ne).
- **Hotovo když:** testy projdou, `npm run check` zelený.

### 2a. HUD nápověda nástrojů (Pavel 2026-10-16)

Pavel po zkoušce lineárního pole („po kliknutí na nástroj se nic neděje“): „Zaveďme pro tohle nějakou HUD nápovědu na horní straně viewportu.“ Kontrakt schválený Pavlem: `ToolHint` a `ToolContext.setHint` v `interaction`, `ToolManager.hint`, `AppSession.tools.hint`, `ToolHintHud.vue` ([[10-interakce#Nástroje]], [[11-ui]] bod 8a, texty v [[12-skicar#Zrcadlení a pole (M36)]]).

- **Soubory:** `interaction/tools.ts`, `tool-manager.ts`, `app` (`AppSession.tools.hint`), `ui/components/ToolHintHud.vue`, `ViewportHost.vue`, `sketcher/sketch-tools/mirror-tool.ts`, `pattern-tool.ts`, i18n.
- **Testy:** `tool-manager.test.ts` (nápověda aktivace, stará aktivace ignorována, vynulování při přepnutí), nástroje zrcadlení a polí (klíč v každém kroku), `ui` (HUD ukazuje přeložený text, `null` nic).
- **Hotovo když:** testy projdou, `npm run check` zelený.

### 3. Skicář a UI

- **Soubory:** `sketch-drawing.ts`, `sketch-tools/snap.ts` (`derivedOwner`), `sketch-tools/text-tool.ts`, `sketch-tools.ts`, `sketch-session.ts` (`setTextParams`, závislost `TextOutliner`), `sketch-editor.ts`, `app` (vytvoření outlineru, URL fontů), `ui` panel (pole Text, Font, Výška), i18n.
- **Testy:** kresba a pick textu, nástroj s `FakeViewport` a `FakeTextOutliner`, session (`setTextParams` platné/neplatné, bez řešiče), `ui` panel.
- **Hotovo když:** testy projdou, `npm run check` zelený.

### 4. Integrace a e2e

- **Soubory:** `test/integration/sketch-text-regions.test.ts` (OCCT: „oaB“ → oblasti s dírami, vysunutí, změna jiného znaku zachová jména ploch), `test/e2e/m37.spec.ts` (nástroj Text, změna řetězce v panelu, gravírování „tinycad“ do kvádru odebráním).
- **Hotovo když:** e2e projdou, `npm run check` zelený; spec 01 (modul), 10 a 11 propsané (hlavní sezení).

## Akceptační kritéria

- Text s písmeny s dírami (o, a, B) dá správné oblasti; vysunutí a odebrání funguje.
- Změna řetězce přestaví oblasti; reference na nezměněná písmena přežijí (podle kontraktu id).

## Co se naučíš

Jak fungují obrysy písmen v TrueType/OpenType (kvadratické a kubické Bézierovy křivky, směr smyček) a jak je převést do CAD geometrie.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Zapisuje stopa: rozhodnutí s Pavlem, odchylky od plánu, výsledky testů. Hlavní sezení to při sloučení přenese do deníku.)_

- **2026-10-16 start:** Pavel rozhodl [[Q091 Fonty pro text ve skice|Q091]]: tři přibalené OFL fonty (Noto Sans, Serif, Sans Mono), obrysy uložené v datech (upřesnění ADR 0029). Fonty stažené z `notofonts.github.io` (se souhlasem) a ořezané `pyftsubset` na ~25 kB.
- **Úkol 1 hotový:** port `TextOutliner`, adaptér `text-opentype` (`opentype.js` 2.0.0), `FakeTextOutliner`, spec 01 doplněná. Fonty přegenerované s `--notdef-outline` (bez něj byl `.notdef` prázdný). 19 testů se skutečnými fonty, `npm run check` zelený. Postřeh mimo stopu: `lint:deps` nekontroluje modul, který v tabulce `.dependency-cruiser.cjs` chybí – kandidát na pravidlo „každá složka `src/` je v tabulce“.
- **Úkol 2 hotový:** `SketchText`, parse, `removeItems` (kotva → text), `toggleConstruction`, `textCurves`, `derivedOwner`, větev `regionCurves`; `Curve2` přesunutý do `curve2.ts` kvůli cyklu. 6945 unit testů zelených.
- **Natažení `main` (M36 sloučený s M31, merge `2d00268`):** 4 konflikty (edit, geometry, index), `toggleConstruction` sjednocený s `isTogglable` M31 (text přepínatelný, xline ne).
- **Úkol 2a (HUD nápověda) hotový:** Pavel schválil kontrakt `ToolHint`/`setHint`/`ToolManager.hint`/`AppSession.tools.hint`, `ToolHintHud.vue`; nápovědy zrcadlení a polí po krocích. Kontrakt ohlášen hlavnímu sezení. 7170 unit, e2e 156/156.
- **Úkol 3, část skicář hotová:** kresba a pick písmen (`derivedOwner`), nástroj Text v rodině `line` za bodem (`addDrawn`, bez vazeb), `setTextParams`, `SketchEditor.text`, `fontUrl` + `createOpentypeOutliner` v `app/browser.ts` (fonty v `dist/assets`), osa zrcadlení / symetrie a kotva textu i `xline`. 7226 unit, e2e 156/156.
- **Natažení `main` s M32** bez konfliktů, jen dva nové testy potřebovaly `setHint` a `text`.
- **Úkol 3 hotový:** panel textu (sekce Text nad vazbami, fokus nového textu). 7415 unit; e2e 165/166 – jednou spadl `m19-2-rename` ve WebKitu, samostatně prošel (nestabilní, nesouvisí).
- **Natažení `main` s M33:** 7 sčítacích konfliktů; text vynechán z `isCurveEntity` (trim/extend/split, průsečíky `requestHits`). 7674 unit zelených.
- **Úkol 4 hotový:** integrační `sketch-text-regions.test.ts` nad OCCT („oaB“: 7 oblastí, díry 1/1/2, vnitřní okénka jsou samostatné oblasti; „oaB“ → „oxB“ zachová jména ploch „o“ a „B“; konstrukční text bez oblastí), e2e `m37.spec.ts` (nástroj Text a panel, gravírování „tinycad“ do kvádru 1 mm, HUD nápověda). Check 7674 unit + 44 integračních, e2e 177/178 (nestabilní `m19-2-rename` WebKit). Postřehy: výběr nástroje z menu rodiny nevrací fokus pohledu (Esc pak nástroj nevypne – existující chování, i M36); Odebrat mimo těleso nic nehlásí.
- **Revize architektury:** 1 skutečná chyba ze sloučení M33 – `curve-pick.ts` měl vlastní predikát křivky, klik na písmeno nebo kopii pole v ořezání/prodloužení/rozdělení spadl na `assertNever`; opraveno a 6 regresních testů. Dál: jediný predikát `isCurveEntity` (přesunutý do `model.ts`) všude, `derivedOwner` zkouší písmeno první, panel nevaliduje doménová pravidla, `TextParams` s povinnými poli a `Partial` v `setTextParams`.

## Retrospektiva

_Návrh k doplnění Pavlem:_
- **Uložit obrysy do dat se vyplatilo:** builder skici, regenerace ani Node testy builderu font nepotřebují; opentype.js žije jen v adaptéru a v kompozičním kořeni. Rozhodnutí v Q091 zjednodušilo celý milník víc, než se čekalo.
- **Odvozená id podruhé:** stejný vzor jako u polí (M36) – recept v datech, křivky s id `<entita>:<přípona>`, `derivedOwner` v picku. Druhý výskyt ukázal, že gramatiky id je třeba navrhnout spolu (písmeno je podmnožinou kopie).
- **Co bylo jinak:** milník přerušila HUD nápověda nástrojů (Pavlův požadavek po zkoušce polí) a tři natažení `main` (M31, M32, M33). Nejdražší byla chyba ze sloučení M33: duplicitní predikát „co je křivka“ v nové stopě – typový predikát kompilátor nekontroluje.
- **Kandidát na poznatek:** „Jediný predikát druhu entity, ideálně vyčerpávající `switch`“ – u souběžných stop nový druh entity jinak projde typecheckem a spadne za běhu.

