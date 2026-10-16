---
type: milestone
status: done
order: 36
aliases:
  - M36
  - M36 Zrcadlení a pole
modules:
  - sketch
  - solver-planegcs
  - sketcher
  - render
  - ui
specs:
  - "[[12-skicar]]"
depends_on:
  - "[[M29-spliny]]"
started: 2026-10-16
finished: 2026-10-16
tags:
  - milnik
created: 2026-10-16
updated: 2026-10-16
---
# M36 – Zrcadlení a pole
**Cíl:** zrcadlení podle osy, lineární a kruhové pole entit skici jako **parametrická entita**: počet, rozteč a úhel jdou změnit i po vytvoření, přímo přes vynesené kóty ve viewportu.


**Specifikace:** [[12-skicar#Zrcadlení a pole (M36)]], [[12-skicar#Data (`sketch`)]], [[12-skicar#Řešič vazeb]], [[12-skicar#Kóty (M28)]]

**Navazuje na:** [[M29-spliny|M29]]. Milník série *Rozšíření skicáře II* (M30–M37), viz [[12-skicar#Rozšíření skicáře II (M30–M37)]] a [[Roadmapa#Rozšíření skicáře II (M30–M37)]]. Stopa C; geometrii nemění, na [[M30-geometrie-skici-v-occt|M30]] nečeká.

## Rozsah

Pavel 2026-10-16: „Chtěl bych ještě dodělat do Sketch následující feature: obdélník zadaný středem a jedním krajním bodem, obdélník zadaný třemi body, možnost zadat bod, zadávat text, Construction Line, fillet a chamfer mezi dvěma hranami, trim, extend, split, offset, slot, mirror, linear a circular pattern.“

Upřesnění v sezení 2026-10-16: zrcadlení a pole jako **parametrická entita**, „plus by tam bylo dobré mít i vynesené kóty podobně jako v Onshape nebo Fusion“.

## Úkoly

- [x] Entity zrcadlení a polí, kopie, vazba symetrie.
- [x] Řešič: vazba symetrie, kopie mimo řešič.
- [x] Kresba, výběr a snapper kopií.
- [x] Nástroje a vynesené kóty.
- [x] Kopie v oblastech (*čeká na sloučení M30*).
- [x] e2e a spec.

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Rozhodnutí: [[Q089 Parametrické zrcadlení a pole ve skice|Q089]] (recept, kopie odvozené, lineární pole ve dvou směrech). Sdílené typy: [[12-skicar#Sdílené kontrakty série II]]. Stopa C při úkolu 1 dopíše do spec 12 sekci *Zrcadlení a pole (M36)* s tvarem entit (s Pavlem, jako hlavní sezení).

### 1. Entity a kopie

- **Soubory:** `src/sketch/model.ts` (`SketchMirror` – zdroje a osa; `SketchLinearPattern` – zdroje, směr 1 a volitelný směr 2, každý počet ≥ 2 a rozteč > 0, směr jako úhel nebo referenční úsečka – rozhodne stopa; `SketchCircularPattern` – zdroje, středový bod, počet ≥ 2, celkový úhel; vazba `symmetric`; `GEOMETRIC_CONSTRAINT_KINDS`), `parse.ts` (zdroje jsou křivky nebo body skici, ne jiné pole), `edit.ts` (`removeItems`: smazání zdroje ho z receptu vyřadí, prázdné zdroje smažou entitu; smazání osy nebo středu smaže entitu; `constraintFor('symmetric', [a, b, osa])`), nový `src/sketch/patterns.ts` (`patternCopies(data)` → kopie jako `SketchCurve`/body s odvozenými id `<id>:<index>.<zdroj>`, mřížka `i-j`; originál = index 0 se nekopíruje).
- **Testy:** `parse.test.ts`, `edit.test.ts`, `patterns.test.ts` (zrcadlení úsečky, oblouku – obrácená orientace, splinu; lineární 1 a 2 směry; kruhové 360° vs. menší úhel; stabilní id při změně rozteče, při změně počtu zmizí jen poslední).
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 2. Řešič

- **Soubory:** `src/solver-planegcs/solve.ts` (`symmetric` → `symmetric_ppl`; entity polí do řešiče nevstupují – osa a střed jsou běžné entity).
- **Testy:** `solve.test.ts` (tažený bod drží symetrii, stupně volnosti), kopie se po tažení zdroje přepočítají (test session).
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 3. Kresba, výběr a snapper kopií

- **Soubory:** `src/sketcher/sketch-drawing.ts` (kopie s odvozenými id a stylem zdroje, u editované i regenerované skici), překlad odvozeného id na id entity pole při najetí a výběru (vzor `__poles:`), `src/sketch/snap.ts` (kopie jako geometrie bez identity: přichycení polohou, bez automatické vazby), glyfy (kopie žádné).
- **Testy:** `sketch-drawing.test.ts`, test výběrového nástroje (klik na kopii vybere pole), `snap.test.ts`.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 4. Nástroje a vynesené kóty

- **Soubory:** `src/sketcher/sketch-tools/mirror-tool.ts`, `pattern-tool.ts` (lineární a kruhové), `sketch-tools.ts` (skupina `modify`, rodina `pattern`), vynesené kóty parametrů (počet, rozteč, úhel) v `SketchState` vedle kót a jejich editace (popisek → nová hodnota parametru jedním `setParams`), `ui` vrstva popisků (vzor `SketchDimensions.vue`), i18n.
- **Testy:** nástroje s `FakeViewport` (výběr zdrojů, osa nebo směr, Enter, Esc), session (změna počtu přes popisek), `ui` (editace popisku).
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 5. Kopie v oblastech – *čeká na sloučení M30*

- **Soubory:** `src/sketch/geometry.ts` (`regionCurves` přidá nekonstrukční kopie z `patternCopies`).
- **Testy:** `geometry.test.ts`; integrační test: skica s kruhovým polem děr → vysunutí, jména ploch `face:side:<id>:<index>.<zdroj>`, změna rozteče zachová vysunutí.
- **Hotovo když:** M30 je v `main` a natažené, testy projdou, `npm run check` je zelený.

### 6. e2e a spec

- **Soubory:** `test/e2e/m36.spec.ts` (zrcadlení podle přímky, lineární pole ve dvou směrech, kruhové pole, změna počtu přes vynesenou kótu), spec 12, 10 a 11.
- **Hotovo když:** e2e projdou, `npm run check` je zelený, spec odpovídá kódu.

## Akceptační kritéria

- Změna počtu nebo rozteče přes kótu ve viewportu přestaví kopie; změna originálu se propíše do kopií.
- Oblasti z kopií mají stabilní jména (vysunutí přežije změnu rozteče).

## Co se naučíš

Odvozená geometrie v parametrickém modelu: kdy data nesou výsledek a kdy jen recept, a co to dělá s identitou entit.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Zapisuje stopa: rozhodnutí s Pavlem, odchylky od plánu, výsledky testů. Hlavní sezení to při sloučení přenese do deníku.)_

- **2026-10-16 start:** Pavel rozhodl směr lineárního pole jako **úhel** (parametr `angle` u každého směru, vynesená kóta), ne referenční úsečku. Kontrakt v [[12-skicar#Zrcadlení a pole (M36)]]. Doplněno bez otázky (k potvrzení Pavlem): `MAX_PATTERN_COUNT = 100`, kruhové pole se znaménkem úhlu a krokem `angle/count` u plného kruhu, jinak `angle/(count−1)`; vynesené kóty jen u vybraného pole; kopie bodů jsou součástí kopií (sdílené body → uzavřené oblasti). Osa zrcadlení a symetrie zatím jen úsečka, `xline` přibude po sloučení M31.
- **Úkol 1 hotový:** `patterns.ts` (23 testů), parse, `removeItems` do ustálení, `symmetric` už i v adaptéru planegcs (`p2p_symmetric_ppl`, vynutil typecheck) a s glyfem. Při sloučení M30: stopa A maže `sketch/regions.ts`, kde úkol 1 upravil soukromý `isCurve` – konflikt vyřešit přijetím smazání. `npm run check` zelený (6602 testů).
- **Úkol 2 hotový:** jen testy (adaptér už z úkolu 1): symetrie drží při tažení i s volnou osou, pole nemění stupně volnosti, kopie se po tažení zdroje přepočítají (test session). `FakeSolver` váží `symmetric` 2. Postřeh: planegcs u neúplně určené skici dává výsledek závislý na předchozích řešeních (rozdíl ~1e-6 i jiná větev) – testy poloh jen u úplně určených skic.
- **Úkol 3 hotový:** kopie v kresbě (editovaná i regenerovaná skica), `entityAt` překládá kopii na pole, snapper bere kopie jako anonymní geometrii uvnitř `snap()` (bez změny API). Upřesnění do spec 12 (styl kopií, `point: null`, bez zarovnání ke kopiím). `npm run check` zelený (6624 testů).
- **Úkol 4, část sketcher hotová:** Pavel rozhodl průběh nástrojů *zdroje → Enter → osa/střed* a směr 2 přes popisek počtu `1×`. Nástroje `mirror-tool.ts`, `pattern-tool.ts`, skupina `modify` (zavedla stopa C, pokud se sloučí první), `sketch-pattern-dimensions.ts`, `setPatternParam` bez řešiče (fronta `writeInTurn`). 6655 testů zelených. Zbývá `ui` popisků.
- **Úkol 4 hotový:** `ui` popisků (`SketchPatternDimensions.vue` v `AppShell`), editace jedním klikem. `npm run check` zelený (6673 testů).
- **Úkol 6 hotový:** `test/e2e/m36.spec.ts` (zrcadlení, mřížka 3 × 2 přes popisek `1×`, kruhové pole, počet 3 → 5 i po reloadu), celé e2e 144/144 zelené; spec 10 a 11 propsané. Postřeh: po potvrzení popisku Enterem není fokus ve viewportu, Esc nástroje funguje až po kliku na plátno (stejně jako u kót M28).
- **Natažení `main` s M30 (merge `013c44c`):** konflikty v `regions.ts` (přijato smazání/přesun), `sketch-drawing.ts`, spec 10, testech; `isRegionCurve` dostal větve polí. Check zelený.
- **Úkol 5 hotový:** `regionCurves` přidá nekonstrukční kopie; integrační test nad OCCT `sketch-pattern-regions.test.ts` (deska s kruhovým polem děr, plochy `face:side:cp:1.k`… přežijí změnu úhlu). Check 6835 unit + 42 integračních, e2e 144/144.
- **Revize architektury:** bez vážných porušení; 4 drobné nálezy opraveny (krok kruhového pole, platnost parametrů a zdroje polí měl `sketcher` zopakované – teď `circularStep`, `patternParamsValid`, `isPatternSource` v `sketch`; zmrazený výsledek `withPatternParam`).

## Retrospektiva

_Návrh k doplnění Pavlem:_
- **Recept místo výsledku se vyplatil:** kopie jako čistá funkce `patternCopies(data)` daly kresbu, výběr, snapper i oblasti skoro zadarmo – všechny vrstvy už uměly běžné `SketchEntity`, stačilo je přidat. Řešič se vůbec neměnil (kromě vazby `symmetric`).
- **Vyčerpávající `switch` jako kontrakt mezi stopami:** `isRegionCurve` ze stopy A (M30) po sloučení okamžitě vynutil rozhodnutí pro nové entity; typecheck nahradil domluvu.
- **Co bylo jinak:** úkol 4 (nástroje + vynesené kóty) byl na jeden běh implementátora velký, rozdělil se na `sketcher` a `ui`. Revize našla duplikovaná doménová pravidla v `sketcher` – implementátor je napsal, protože `sketch` neexportoval jedinou pravdu; příště při spec rovnou určit, kde pravidlo žije.
- **Kandidát na poznatek:** „Odvozená geometrie jako čistá funkce nad vyřešenými daty“ (stabilní id z receptu, kopie bez identity ve snapperu a vazbách).
