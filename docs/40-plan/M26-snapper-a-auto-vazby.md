---
type: milestone
status: done
order: 26
aliases:
  - M26
  - M26 Snapper a auto-vazby
modules:
  - sketch
  - solver-planegcs
  - sketcher
  - render
specs:
  - "[[12-skicar]]"
  - "[[10-interakce]]"
depends_on:
  - "[[M25-glyfy-vazeb]]"
started: 2026-10-15
finished: 2026-10-15
tags:
  - milnik
created: 2026-10-15
updated: 2026-10-15
---
# M26 – Snapper a automatické vazby

**Cíl:** kreslicí nástroje skicáře se přichytávají ke geometrii skici (body, středy, křivky, zarovnání) jako ve Fusionu a při kreslení automaticky vytvářejí odpovídající vazby, jejichž glyfy uživatel vidí předem.

**Specifikace:** [[12-skicar#Režim skicáře (sketcher)]], [[10-interakce#Nástroje a akce skicáře]]

**Navazuje na:** [[M25-glyfy-vazeb|M25]] – náhled budoucích vazeb jsou glyfy. Pokračuje [[M27-oblouky-a-kruznice|M27]], jehož tečné nástroje stojí na inferenci tečnosti.

> [!note] Hrubý plán
> Úkoly a akceptační kritéria se upřesní při startu milníku spolu se specifikací a implementačním plánem.

## Rozsah

Pavel 2026-10-15: „Snapper a také automatické doplňování vazeb při vytváření křivek.“

Rozhodnutí v sezení 2026-10-15 (brainstorming):
- **Snapper** je čistá synchronní funkce v `sketch` (`snap(kurzor, kontext) → bod, kandidáti vazeb, vodítka`); nástroje v `sketcher` ji jen volají. Testovatelná v Node bez viewportu.
- **Přichycení:** koncový bod, střed úsečky, střed kružnice a oblouku, bod na křivce, zarovnání s body (tečkovaná vodítka), mřížka jako nejnižší priorita (dnešní chování M19.2 zůstává). Počátek roviny jako dnes.
- **Automatické vazby (všechny, které Pavel vybral):** `coincident` (existuje), nové `pointOnCurve` a `midpoint`, vodorovné/svislé **zarovnání dvou bodů** (nová vazba), kolmo, rovnoběžně a tečně k navazující nebo nadjeté křivce, stejná délka / poloměr.
- Kandidátní vazby se před zápisem ověří řešičem; redundantní nebo konfliktní se **tiše zahodí** (jako Fusion), skica se kreslením nesmí rozbít.
- Inferenci potlačí podržený **Ctrl/Cmd** (konvence Fusionu; Alt už vypíná mřížku).
- Nové druhy vazeb rozšiřují `SketchConstraint`; staré dokumenty zůstávají platné, takže migrace není potřeba.

## Úkoly

- [x] 0. Rozhodnout [[Q084 Inference automatických vazeb|Q084]], kontrakt ve spec 12 a implementační plán
- [x] 1. Nové vazby `pointOnCurve`, `midpoint`, `hAlign`/`vAlign`: model, `parseSketchData`, `constraintFor`, `constraintTargets`, adaptér planegcs, `FakeSolver`, glyfy a akce Střed
- [x] 2. `snap`, `inferLine`, `inferRadius` v `sketch` (čisté funkce, tabulkové testy)
- [x] 3. Ověření kandidátů řešičem (`addGeometry` s `required`) a snapper v nástrojích `sketcher`, Ctrl/Cmd
- [x] 4. Náhled: vodítka v overlay a náhledové glyfy v `ui`
- [x] 5. e2e `m26.spec.ts`, propsání do spec 10 a 11

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Kontrakt je v [[12-skicar#Snapper a auto-vazby (M26)]].

### 1. Nové vazby

- **Soubory:** `src/sketch/model.ts` (členy unie, `GeometricConstraintKind` + `'midpoint'`), `parse.ts`, `edit.ts` (`constraintFor`, `constraintTargets`), `testing.ts` (`FakeSolver` váhy); `src/solver-planegcs/solve.ts`; `src/sketcher/sketch-glyphs.ts` (`isGlyphConstraint`), `sketch-toolbar.ts` / `sketch-actions.ts` (akce Střed); `src/ui/sketch-glyph-icons.ts` (4 ikony), `ui/i18n/cs.ts`, `en.ts`.
- **Testy:** `test/unit/sketch/parse.test.ts`, `edit.test.ts`, adaptér planegcs (bod zůstane na úsečce při tažení úsečky, `midpoint`, `hAlign`, `vAlign`, `pointOnCurve` na kružnici a oblouku), glyfy a ikony nových druhů, akce Střed.
- **Hotovo když:** `npm run check` zelený.

### 2. Snapper a inference

- **Soubory:** nové `src/sketch/snap.ts`, `src/sketch/infer.ts`, export v `index.ts`.
- **Testy:** `test/unit/sketch/snap.test.ts`, `infer.test.ts` – tabulkově podle seznamu ve spec.
- **Hotovo když:** `npm run check` zelený.

### 3. Řešič a nástroje

- **Soubory:** `src/sketcher/sketch-session.ts` (`addGeometry(add, { required })`, opakování bez sporných vazeb, nejvýš tři řešení), `sketch-tools/snap.ts` (`snapAt` přes `snap`, `tolerance` z 6 px, `placePoint` z `inferred`), `line-tool.ts`, `rectangle-tool.ts`, `circle-tool.ts`, `arc-tool.ts`.
- **Testy:** session (`FakeSolver.next` s konfliktem), nástroje s `FakeViewport` (bod na úsečce → `pointOnCurve`, kolmá úsečka → `perpendicular`, Ctrl/Cmd bez vazeb, obdélník na existující hraně sdílí body).
- **Hotovo když:** `npm run check` zelený.

### 4. Náhled

- **Soubory:** `sketch-session.ts` (`setInferencePreview`, `SketchState.inference`), nástroje (náhled při pohybu, mazání), overlay `'sketch-guides'`; `src/ui/sketch-glyphs.ts` a `SketchGlyphs.vue` (řada náhledových ikon).
- **Testy:** session a nástroje (náhled, smazání při Esc/kliku/deaktivaci), `glyphLayout` náhledu, `renderToString` komponenty.
- **Hotovo když:** `npm run check` zelený.

### 5. e2e a spec

- **Soubory:** `test/e2e/m26.spec.ts` (akceptační kritéria), případné úpravy dřívějších e2e, které teď dostanou navíc automatické vazby; [[10-interakce]] (nástroje, `snapAt`, `addGeometry`, `SketchState.inference`) a [[11-ui]] (náhledové glyfy).
- **Hotovo když:** e2e projdou, `npm run check` zelený, spec odpovídá kódu.

## Akceptační kritéria

- Kreslení obdélníku navazujícího na existující hranu vytvoří sdílené body a žádnou redundantní vazbu (`redundant` prázdné).
- Úsečka nakreslená skoro kolmo na předchozí dostane `perpendicular`; s Ctrl/Cmd ne.
- Bod položený na úsečku dostane `pointOnCurve` a při tažení úsečky na ní zůstane.

## Co se naučíš

- Inference záměru uživatele z polohy kurzoru (prahy v pixelech vs. v jednotkách modelu, priority).
- Proč se vazby nedají jen „přidat“: redundance a konflikty ve stupních volnosti.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh stopy

_(Souběžná stopa, [[Roadmapa#Souběžné stopy (pokus od M25)|pravidla]]: místo deníku sem zapisuje průběh; hlavní sezení ho při sloučení přenese do deníku.)_

- **2026-10-15, start:** Pavel rozhodl [[Q084 Inference automatických vazeb|Q084]] (všechny body podle návrhu). Kontrakt v [[12-skicar#Snapper a auto-vazby (M26)]]. Rozhodnutí stopy k revizi:
  - A7: nové vazby nevznikají novými akcemi lišty, ale konvencí Onshape: Shoda na bod + křivku → `pointOnCurve`, Vodorovná/Svislá na dva body → `hAlign`/`vAlign`; přibude jen akce Střed (`midpoint`).
  - A8: `pointOnCurve` drží bod na celé nosné přímce/kružnici (jako planegcs, Onshape, FreeCAD), ne jen na úseku.
  - A9: Ctrl/Cmd vypne všechny automatické vazby včetně dnešní vodorovné/svislé u úsečky; zůstane jen sdílený bod a `fix` počátku. Obdélník má své `horizontal`/`vertical` vždy.
  - A10: snapper přestává používat picking `render` – přichycení počítá geometricky v rovině s prahem 6 px převedeným na mm v místě kurzoru.
  - A11: všechny vazby z `addGeometry` jsou automatické; konflikt → nový pokus bez sporných, pak bez všech kromě `fix` a povinných (`required`), nejvýš tři řešení.
  - A12: stejný poloměr se porovnává s poslední kružnicí/obloukem v datech (to je „navazující“ u kružnic).
- **2026-10-15, úkol 1** (nové vazby): hotovo. Signatury planegcs sedí; `point_on_arc` drží bod na celé kružnici (A8 potvrzeno testem). Akce Střed má na liště ikonu Tabler `letter-m`. Výčty v obecných sekcích spec 12 (*Kontrola dat*, `constraintFor`) nové druhy neobsahují – podle pravidel stop je autoritativní sekce M26, sjednotit při sloučení.
- **2026-10-15, úkol 2** (`snap`, `inferLine`, `inferRadius`): hotovo; 2D pomůcky z `regions.ts` přesunuty do interního `sketch/vec2.ts`. A13: `alignBoth` ke stejnému bodu → jen `align` k bližší ose; tečna jen k oblouku navazujícímu koncem (kružnice ze snapperu tečnu nedostane); `exclude` vyřadí entitu ze všech kroků. Propsáno do spec 12.
- **2026-10-15, úkol 3** (řešič a nástroje): hotovo. `addGeometry(add, { required })` až tři pokusy; `snapAt` přes `snap`, tolerance 6 px v místě kurzoru; řetěz polyline si pamatuje své nezapsané entity, takže první bod jde trefit i před dokončením zápisu. Rozhodnutí A14 (propsáno do spec 12): `fix` a povinné vazby zůstávají ve všech pokusech; úsečka mezi body už spojenými existující úsečkou se nevytvoří (obdélník na hraně ji sdílí); zarovnání s počátkem kreslené úsečky → její `horizontal`/`vertical`; zarovnání rohu obdélníku s jiným jeho rohem se zahodí; osa + tečna zůstávají obě.
- **2026-10-15, natažení `main`** (a4e0316, sloučené stopy B a C): 23 konfliktů v 17 souborech, vyřešeno ručně – sjednocené exporty `sketch`, větve `constraintFor`/`constraintTargets`/adaptéru vedle kót a splinů, panel s `<details>` i jednotkami kót z M28, e2e `dimensionInput` asynchronní i v novém `m28.spec.ts`, odstavce spec 10 a 11 vedle sebe. Vyčerpávající `switch` ukázal přesně tři místa: `isGlyphConstraint` (nové kóty → bez glyfu), kotva glyfu splinu (zatím `null`, dodá M29 úkol 8) a průmět na spline ve snapperu (spline zatím není kandidát `onCurve`, `pointOnCurve` na spline nemá). Helper e2e `openConstraintSection` nejdřív 1 s počká na samočinné otevření sekce – klik ve chvíli, kdy ji otevírá nová kóta, ji zavřel a vzal fokus poli (padal `m28.spec.ts` v chrome). `npm run check` zelený.
- **2026-10-15, úkol 4** (náhled): hotovo. Klik i náhled počítá jedna funkce kroku nástroje (`lineStep` …), takže se nerozejdou. A15 (propsáno do spec 12): vodítka kreslí session (viewport skicáře dostane `overlay`); náhled je vodorovná řada vpravo dole od kotvy; přichycení na existující bod v náhledu nic neukáže (vazba nevzniká, Onshape tam ukazuje shodu – kandidát na zlepšení); `leave` náhled smaže.
- **2026-10-15, úkol 5** (e2e, spec 10 a 11): `m26.spec.ts` (obdélník na hraně bez redundance, skoro kolmá úsečka → Kolmost, s Ctrl/Cmd nic, bod na křivce zůstane po tažení, náhledový glyf). Starší e2e nové chování snapperu nerozbilo. Spec 10 (nástroje, `snapAt`, `addGeometry`, `SketchState.inference`) a 11 (náhled, viewport s `overlay`) propsané.
- **2026-10-15, revize** (`architecture-reviewer`): bez vážných porušení. Opraveno: A16 – konec oblouku nedostane žádné `inferred` ani vodítka (vazby pro místo kurzoru po promítnutí na kružnici neplatily; chyba byla v kontraktu, propsáno do spec 12); funkce kroku nástrojů berou `SketchData` místo celé session (ADR 0011). Ponecháno: `setInferencePreview` je ve veřejném `SketchSession`, takže ho vidí i `ui` – stejný vzor jako `previewDimension` z M28; kandidát na otázku při sloučení (užší rozhraní jen pro nástroje).
- **Mimo M26, k otázce:** Escape s fokusem v panelu (např. na `<summary>` sekce Vazby) nedojde k nástroji – klávesy nástrojů jdou jen přes `keydown` plátna. Starší chování, e2e na něj narazilo.
- **2026-10-15, uzavření:** `npm run check` zelený, e2e 118/118 v chrome i webkit (`E2E_PORT=4201`). Commit na větev `claude/stopa-a-m25-m27-f7ea83`.

## Retrospektiva

- **Co šlo dobře:** snapper a inference jako čisté funkce v `sketch` šly otestovat tabulkově v Node (stovky případů za sekundu); nástroje pak jen skládají výsledky. Jedna funkce kroku nástroje pro klik i náhled vyloučila rozjetí náhledu a zápisu. Vyčerpávající `switch` po natažení `main` přesně ukázal tři místa, kde se M26 potkává s kótami a spliny.
- **Co drhlo:** kontrakt měl díry, které vyplavaly až při implementaci (zdvojená hrana obdélníku, zarovnání s vlastním počátkem úsečky, konec oblouku) – rozhodnutí A13–A16. Natažení `main` uprostřed milníku stálo 23 ručně řešených konfliktů, většinou sousední řádky v unii vazeb, exportech a e2e helperech.
- **Souběh stop:** natáhnout `main` hned po sloučení B a C (uprostřed M26) bylo levnější než na konci – konflikty byly ještě malé a e2e ukázalo jediný souběh v helperu. Čekané konflikty při dalším sloučení: žádné, větev obsahuje `main` a4e0316.
- **Pro M27:** nové nástroje kružnic a oblouků mají stát na `snap` a funkcích kroku stejně jako dnešní; tečný oblouk potřebuje `inferLine`-obdobu pro oblouk (tečna k navazující křivce je jeho definice, ne inference).
- **Kandidát na poznatek:** inference záměru uživatele je odhad – ať smí ustoupit (řešič zahodí redundantní a sporné automatické vazby), definici tvaru (obdélník, `fix` počátku) ne.
