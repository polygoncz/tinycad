---
type: milestone
status: done
order: 19
aliases:
  - M19
  - M19 Manipulátor ve stylu Fusion
modules:
  - interaction
  - render
  - app
  - ui
  - features/transform
  - features/extrude
specs:
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
  - "[[07-regenerace]]"
depends_on:
  - "[[M18-manipulatory]]"
started: 2026-10-14
finished: 2026-10-14
tags:
  - milnik
created: 2026-10-14
updated: 2026-10-14
---
# M19 – Manipulátor ve stylu Fusion

**Cíl:** manipulátor Transformace jako Move ve Fusion 360. Šipky, čtverce pro posun v rovině, oblouky rotace a středový bod. Lišta režimů (Volný, Posun, Rotace, Nastavit pivot) a editovatelné pole hodnoty jezdí s manipulátorem. Rotace má tři úhly.

**Specifikace:** [[0022-rezimy-a-hud-manipulatoru|ADR 0022]], [[10-interakce#Manipulátory (M18)]] (včetně [[10-interakce#Režimy a HUD (M19)]]), [[09-vykreslovani#Vzhled od M19 (styl Fusion)]], [[11-ui]] (odrážka M19 u Manipulátorů v *Kompoziční kořen* a pravidlo 8), [[07-regenerace#Builder featury]] (Transform v3)

**Navazuje na:** [[M18-manipulatory|M18]] (abstrakce kotev a úchytů)

## Rozhodnutí (2026-10-14, s Pavlem)

- **Z Fusion se přebírá všechno:** oblouky místo kružnic, rovinné čtverce a volný střed, režimy, nastavení pivotu, editovatelné pole hodnoty.
- **Rotace jako tři úhly** `rx`, `ry`, `rz` (Transformace v3). Oblouky leží v kardanovém rámci, aby tah otáčel přesně podle oblouku.
- **Lišta režimů je u manipulátoru**, ne v dialogu. Výchozí režim je **Volný** (všechny úchyty najednou).
- **Režim Rotace** ukazuje celé kružnice, Volný jen čtvrtkruhy.
- **Režim Nastavit pivot:** tah posouvá pivot a těleso zůstává na místě. Klik na plochu nebo hranu modelu přichytí pivot do bodu zásahu.

## Úkoly

- [x] 1. `interaction`: nové druhy úchytů a matematika (bez změny API)
- [x] 2. `interaction` + přizpůsobení: `frame`, režimy, `pickPoint`, HUD, port, Extrude a Transformace na nové API
- [x] 3. `render`: glyfy ve stylu Fusion, picking nových druhů, `project`, `viewChanged`
- [x] 4. `features/transform`: schéma v3, migrace, režimy, kardanové oblouky, čočka pivotu
- [x] 5. `app` + `ui`: `AppSession.manipulator`, `ManipulatorHud.vue`
- [x] 6. Ruční ověření, revize, uzavření
- [x] 7. Opravy z revize architektury

## Implementační plán

### Společná pravidla (platí pro každý úkol)

- Kontrakt ve spec doslova, čísla ze spec. Mezi ně patří velikosti glyfů v tabulce [[09-vykreslovani#Vzhled od M19 (styl Fusion)]], posun pole (96 a 88 px) a lišty (110 px).
- Vektory přes `vec3`, `mat4` a `quat` z `@/core` ([[0012-gl-matrix-za-fasadou|ADR 0012]]). Čisté soubory `render` patří do pravidla `render-pure-files-without-three`.
- Neměnná data, žádné `any`, angličtina v kódu, TDD, `npm run check` zelený.

### Na co si dát pozor

1. **Rovina bodového tahu** se zafixuje při stisku. Bez toho by se posun během tahu „rozjížděl“ při každém `viewChanged` (úkol 2).
2. **Esc u úchytu pivotu** vrací tři klíče: `pivot`, `pivotPoint` a `translate` (úkoly 2 a 4).
3. **Klik vs. tah v režimu s `pickPoint`:** klik zapíše pivot, tah po modelu nic nedělá (`CLICK_TOLERANCE_PX`) (úkol 2).
4. **Kardanové oblouky:** po tahu `rz` se oblouky Y a X natočí s ním. Test nesmí počítat s osami světa (úkol 4).
5. **Migrace přes dvě verze:** dokument v1 → v3 (úkol 4, přehrání logu).
6. **HUD při animaci kamery:** `viewChanged` chodí každý snímek, `ui` přepočítá jen polohy, ne `hud` (úkol 5).

### 1. Nové druhy úchytů a matematika

- **Soubory:** `src/interaction/manipulators.ts` (typy `PlanarHandle`, `PointHandle`, `ScalarHandle`, `Patch`, `ManipulatorMode`, `ManipulatorFrame`, `extent`, `dashed`, `displayScale`), `src/interaction/manipulator-drag.ts` (+ test).
- **Kontrakt:** [[10-interakce#Deskriptor a úchyty (`manipulators.ts`)]], [[10-interakce#Matematika tažení (`manipulator-drag.ts`, čisté funkce)]] (`planarParam`, `pointParam`).
- **Rozsah:**
  - Jen přidat nové typy a funkce. `ManipulatorDescriptor` a `handles()` zůstávají, aby zbytek kódu fungoval beze změny. Změna API je až v úkolu 2.
  - `AngularHandle.extent` a `displayScale` přidat jako **volitelné**, povinné je udělá úkol 2.
- **Testy:**
  - `planarParam`: rovina XY shora i šikmo, báze `u`, `v` otočená o 30°, pohled z hrany → `null`.
  - `pointParam`: bod na paprsku nejbližší k `position`, i se šikmým paprskem.
- **Hotovo když:** `npm run check` je zelený.

### 2. Režimy, `pickPoint`, HUD a přechod na nové API

- **Soubory:**
  - `interaction`: `src/interaction/manipulators.ts`, `src/interaction/manipulator-controller.ts` (+ test), `src/interaction/viewport-port.ts` (`HandleView` s novými druhy, `zero`, `extent`, `dashed`; bez `setLabel`; `ViewportPort.project`, `ViewChangedEvent`), `src/interaction/testing.ts` (`FakeViewport`: `prepareProject`, emit `viewChanged`, bez `manipulatorLabel`), `src/interaction/index.ts`.
  - Pluginy: `src/features/extrude/manipulators.ts` (+ test: `frame`, `displayScale: 2`) a `src/features/transform/manipulators.ts` (+ test: zatím jen převod na `frame` s jedním režimem, kružnice `extent: 'full'`; režimy přinese úkol 4).
  - `render`: `src/render/viewport.ts` a `src/render/manipulator-layer.ts` dostanou minimální přizpůsobení. Pryč štítek, `project` a `viewChanged` zatím s prázdnou implementací (`null` a bez událostí). Nové druhy úchytů se zatím přeskočí, glyfy přinese úkol 3.
  - `app`: `src/app/session.ts` (bez `formatValue`, controller s `pick`), `src/app/browser.ts`, `src/app/testing.ts`, testy. `ui`: `src/ui/App.vue` (bez `formatValue`).
- **Kontrakt:** [[10-interakce#`ManipulatorController` (`manipulator-controller.ts`)]] (tabulka událostí včetně `pickPoint`), [[10-interakce#Režimy a HUD (M19)]], [[10-interakce#Port (`viewport-port.ts`)]], [[10-interakce#Port viewportu]] (`project`, `viewChanged`).
- **Testy:** odrážky `manipulator-controller` (M19) v [[10-interakce#Testy]]. K tomu Extrude `displayScale` a stávající testy M18 převedené na `frame`.
- **Hotovo když:** `npm run check` a e2e jsou zelené. V aplikaci se manipulátor chová jako v M18, jen bez štítku.

### 3. `render`: glyfy ve stylu Fusion

- **Soubory:** `src/render/manipulator-pick.ts` (+ test), `src/render/manipulator-layer.ts`, `src/render/viewport.ts` (`project`, `viewChanged` ve `draw`).
- **Kontrakt:** [[09-vykreslovani#Vzhled od M19 (styl Fusion)]].
- **Testy (Node, `manipulator-pick`):**
  - `projectHandles`: čtvrtkruh (16 segmentů od `zero` k `axis × zero`), kružnice 64, čtverec (4 rohy 26–46 px), bod (střed, poloměr), šipka 14–98 px.
  - Skrytí čtverce z hrany.
  - `pickHandle`: bod má přednost, bod uvnitř čtverce, nejbližší z čar, shoda → dřívější.
  - `handleBounds` pro nové druhy.
  - Detekce změny kamery pro `viewChanged` jako čistá funkce (stejný stav → žádná událost).
- **Ručně** (po úkolu 5): vzhled podle náčrtu, čárkování v režimu pivotu, obě palety.
- **Hotovo když:** `npm run check` je zelený.

### 4. Transformace v3

- **Soubory:** `src/features/transform/{schema,builder,manipulators,messages,index}.ts`, `transform.test.ts`.
- **Kontrakt:**
  - **Params** v pořadí `bodies`, `pivot`, `pivotPoint`, `translate`, `rx`, `ry`, `rz`. Tři pole `angle` s výchozí hodnotou 0 a popisky `transform.rx`, `transform.ry`, `transform.rz` (cs „Rotace X/Y/Z“, en „Rotation X/Y/Z“). `axis` a `angle` zanikají i s texty.
  - **`migrate(1, raw)`** projde v1 → v2 → v3. **`migrate(2, raw)`** nastaví `r<axis> = angle`, ostatní úhly 0, a odebere `axis` a `angle`. Data, která nejsou objekt, odmítne výjimkou. Data v2 s neznámou nebo chybějící `axis` propustí beze změny a chybu ohlásí `validate` na featuře (rozhodnutí 2026-10-14: jedna chybná featura nerozbije načtení dokumentu).
  - **Builder:** `R = Rz · Ry · Rx` (`mat4.rotationAxisAngle`), `m = T(translate) · T(p) · R · T(−p)`. Kotva jen pro `bodiesCenter` (beze změny).
  - **Režimy** v pořadí:

    | id | label | icon |
    |---|---|---|
    | `free` | `transform.mode.free` (cs „Volný“, en „Free“) | `arrows-move` |
    | `move` | `transform.mode.move` (cs „Posun“, en „Move“) | `arrows-up-down` |
    | `rotate` | `transform.mode.rotate` (cs „Rotace“, en „Rotate“) | `rotate-clockwise` |
    | `pivot` | `transform.mode.pivot` (cs „Nastavit pivot“, en „Set pivot“) | `focus-2`, `picksPoint: true` |

  - **`frame`:** `p` stejně jako v M18 (`origin`, `pivotPoint`, kotva), `c = p + translate`, `center = c`.
    - **Posun** (`free`, `move`):
      - `tx`/`ty`/`tz`: `linear`, světové osy, `value = translate[i]`.
      - `txy`/`tyz`/`tzx`: `planar` v `c`, `u`/`v` = první a druhá osa, `tint` = osa normály (`z`, `x`, `y`), `value` = dvě složky `translate`.
      - `tc`: `point` v `c`, `tint: 'neutral'`, `value = translate`.
    - **Rotace** (`free` jako čtvrtkruhy, `rotate` jako celé kružnice): `rz` má osu `Z` a `zero` `X`, `ry` má osu `Rz·Y` a `zero` `Rz·Z`, `rx` má osu `Rz·Ry·X` a `zero` `Rz·Ry·Y`. `value` = příslušný úhel, `toParams(v) = { r<k>: v }`.
    - **Pivot** (`pivot`): `px`/`py`/`pz`, `pxy`/`pyz`/`pzx` a `pc` jako u posunu, ale `dashed: true` a čočka pivotu. Hodnota je složka `c` (nebo `c` celé) a z nového `c'` platí `p' = p + R⁻¹(c' − c)`, `t' = t + (I − R)(p − p')`. `toParams` vrátí `{ pivot: 'point', pivotPoint: p', translate: t' }`.
  - **`pickPoint(params, anchors, 'pivot', point)`** = čočka pivotu s `c' = point`. V jiném režimu `null`.
- **Testy:**
  - migrace v2 → v3 pro každou osu, v1 → v3 a přehrání logu v1/v2;
  - pořadí `Rz·Ry·Rx` na asymetrickém kvádru;
  - id a počty úchytů v každém režimu, `extent` podle režimu, `dashed` jen v pivotu;
  - kardanové osy po `rz = 90°` (osa `ry` je `−X`);
  - planar a point `toParams`;
  - **pivot:** s `rx = 30°`, `rz = 45°` posun `px` o 5 mm postaví builderem stejnou obálku tělesa jako předtím a úchyty stojí v `c'`;
  - `pickPoint` mimo režim pivotu dá `null`;
  - kotva nezávisí na `translate` ani úhlech.
- **Hotovo když:** `npm run check` a e2e (`m11.spec.ts`) jsou zelené.

### 5. `app` + `ui`: HUD

- **Soubory:** `src/app/session.ts` (+ test, `AppSession.manipulator`), `src/app/index.ts` (typy), `src/app/testing.ts`, `src/ui/components/ManipulatorHud.vue` (nový), `src/ui/components/ViewportHost.vue`, `src/ui/manipulator-hud.ts` (+ test, čisté funkce `fieldPosition` a `toolbarPosition`), `src/ui/i18n/{cs,en}.ts` (`manipulator.field.label`).
- **Kontrakt:** [[11-ui]] (odrážka M19 u Manipulátorů a pravidlo 8).
- **Testy:**
  - `app`: `hud` po otevření Transformace má 4 režimy. `setMode('rotate')` změní pohledy (3 kružnice). `setValue` zapíše `translate`.
  - `ui`: `fieldPosition` (směr, splývající průměty → vpravo, offset), `toolbarPosition` (posun dovnitř plochy).
- **Hotovo když:** `npm run check` a `npm run test:e2e` jsou zelené.

### 6. Ověření a uzavření

- Ruční ověření v prohlížeči (hlavní sezení):
  - všechny 4 režimy;
  - tah čtverce a středu;
  - tah oblouku po předchozí rotaci (kardan);
  - pivot tahem i klikem na model, těleso stojí, pak rotace kolem nového pivotu;
  - pole: tah ukazuje hodnotu, psaní + Enter, Esc;
  - lišta jezdí při orbitu;
  - Extrude: pole se symetrickým vysunutím;
  - tmavý režim.
- `architecture-reviewer`, opravy, uzavření, deník.

### 7. Opravy z revize architektury

- **Soubory:** `src/ui/manipulator-hud.ts` (+ test), `src/ui/components/ManipulatorHud.vue`, `src/ui/components/params/field-values.ts` (+ test), `src/interaction/manipulator-controller.ts` (+ test), `src/interaction/regen-status-port.ts` nebo kde je `HudField`.
- **Kontrakt:** [[11-ui]] pravidlo 8 (`hudLayout`, `fieldCommit`), `HudField.kind` v [[10-interakce#Režimy a HUD (M19)]], pravidlo 7 (bez `formatHandleValue`).
- **Testy:** `hudLayout` (skrytí lišty a pole mimo plochu, odsazení podle `kind`), `fieldCommit` (nezměněný text, neplatný text, stupně → radiány), controller plní `kind`.
- **Hotovo když:** `npm run check` a e2e jsou zelené a `ManipulatorHud.vue` neobsahuje výpočty polohy ani rozhodování o zápisu.

## Akceptační kritéria

- Ve výchozím režimu Volný jsou vidět šipky, čtverce, středový bod a čtvrtkruhy. V režimu Rotace celé kružnice, v Posunu jen posun. Lišta režimů jezdí s manipulátorem.
- Tah čtvercem posouvá ve dvou osách, tah středem v rovině pohledu.
- Rotace má tři úhly. Oblouk otáčí přesně podle sebe i po předchozí rotaci jiné osy.
- V režimu Nastavit pivot tah i klik na model posune střed otáčení a těleso stojí.
- Pole u úchytu ukazuje hodnotu při tahu a po něm do něj jde napsat číslo.
- Staré dokumenty (Transformace v1 a v2) se po načtení postaví stejně jako dřív.
- `npm run check` a `npm run test:e2e` jsou zelené.

## Co se naučíš

- Kardanové (Eulerovy) úhly: proč osa oblouku závisí na úhlech vnějších os.
- Čočka s vyrovnáním: jak posunout pivot, aniž se pohne výsledek (`t' = t + (I − R)(p − p')`).
- Rozdělení HUD: `interaction` dodá polohu ve světě, `ui` promítne na obrazovku.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

**Co šlo dobře**
- Abstrakce z M18 unesla velké rozšíření: dva nové druhy úchytů, režimy, klik na model a HUD. Controller přitom neví nic o Transformaci. Pivot je čistá čočka (`t' = t + (I − R)(p − p')`) a v prohlížeči těleso při přichycení pivotu opravdu stojí.
- Pořadí „přidat vedle, pak přepnout API najednou“ (úkoly 1 a 2) udrželo zelený `npm run check` po každém úkolu.
- Kardanové oblouky fungují tak, jak má: po rotaci Z se oblouky X a Y otočí s tělesem.

**Co bylo jinak, než se čekalo**
- Při psaní spec M19 vyplavala chyba v M18. Transformace s pivotem `origin` nebo `point` nevracela kotvy a manipulátor zmizel. Pravidlo „builder s manipulátorem vrací kotvy vždy“ je teď ve spec 07.
- Lišta 24 px od středu ležela přes úchyty. Ve spec jsem nepočítal s dosahem glyfů (98 px), oprava na 110 px přišla až z ručního ověření v prohlížeči.
- Revize našla logiku rozvržení a zápisu ve `.vue` (ADR 0010). Přesunula se do čistých funkcí `hudLayout` a `fieldCommit`.
- Čtyři rozhodnutí z implementace jsem propsal do spec:
  - příznak režimu `picksPoint` místo sondy;
  - migrace v2 s neplatnou `axis` propustí data, chybu ohlásí `validate`;
  - `HudField.kind` místo odvozování druhu úchytu z jednotky;
  - skrytí kružnice viděné z hrany.

**Co dál**
- Lišta u pravého okraje plochy zajíždí pod plovoucí dialog featury. Ořez počítá s plochou viewportu, ne s panely nad ní.
- Pole u úhlového úchytu částečně překrývá kružnice. Pomohlo by odsazení podle `extent`, nebo pole za obvodem kružnice.
- Velikost glyfů (šipka 98 px) může působit malá. Rozměry jsou konstanty v tabulce spec 09, doladí se podle Pavlova dojmu.
- Revolve: kotva osy a úhlový úchyt (třetí ověření abstrakce).
