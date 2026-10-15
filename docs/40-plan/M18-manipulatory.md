---
type: milestone
status: done
order: 18
aliases:
  - M18
  - M18 Manipulátory
modules:
  - regen
  - interaction
  - plugin-api
  - render
  - app
  - ui
  - features/transform
  - features/extrude
specs:
  - "[[07-regenerace]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M17.1-rezim-otaceni]]"
started: 2026-10-14
finished: 2026-10-14
tags:
  - milnik
created: 2026-10-14
updated: 2026-10-14
---
# M18 – Manipulátory

**Cíl:** při otevřeném dialogu featury jdou její parametry měnit tažením [[Manipulátor|úchytů]] ve viewportu. Transformace dostane šipky posunu a kružnice rotace s nastavitelným středem otáčení, Extrude šipku vzdálenosti. Abstrakce je obecná: další featura (Revolve) potřebuje jen [[Kotva manipulátoru|kotvu]] z builderu a deklaraci úchytů v pluginu.

**Specifikace:** [[0021-manipulatory-kotvy-z-regenerace|ADR 0021]], [[07-regenerace#Kotvy manipulátorů (M18)]], [[10-interakce#Manipulátory (M18)]], [[09-vykreslovani#Manipulátory]], [[11-ui#Plugin featury (plugin-api)]], [[11-ui#Kompoziční kořen (app)]]

**Navazuje na:** [[M17.1-rezim-otaceni|M17.1]] (kamera a picking), [[M13-extrude-revolve|M13]] (Extrude), [[M11-dalsi-entity|M11]] (Transformace)

## Rozhodnutí (2026-10-14, s Pavlem)

- **Přístup:** kotvy z regenerace + deklarace úchytů v pluginu + obecný controller v `interaction` ([[0021-manipulatory-kotvy-z-regenerace|ADR 0021]]). Zamítnuto: geometrické dotazy v `interaction`, hotové úchyty z builderu, vlastní nástroj pro každou featuru.
- **Střed otáčení Transformace** je nastavitelný v dialogu (`pivot`: střed těles / počátek / bod), výchozí je střed obálky vybraných těles. Migrace v1 → v2 dá `origin`, aby se staré dokumenty nezměnily.
- **Rotace:** vždy tři kružnice. Tah za kružnici jiné osy nastaví `axis` a úhel začne od 0. Předchozí úhel se zahodí, schéma zůstává s jednou rotací.
- **Rozsah:** Transformace + Extrude (vzdálenost). Revolve později.
- **Tažení:** přichytávání ke kroku (1 mm, 5°, Shift = jemně), štítek s hodnotou u kurzoru, Esc zruší tažení a vrátí původní hodnoty.

## Úkoly

- [x] 1. `regen`: kotvy ve výstupu builderu, v cache a v `RegenResult`
- [x] 2. `interaction`: typy úchytů a matematika tažení
- [x] 3. `interaction` + `plugin-api`: registr manipulátorů a pole pluginu
- [x] 4. `interaction`: `ManipulatorController`, směrování v `ToolManager`, testovací porty
- [x] 5. `render`: `ManipulatorLayer`, picking, štítek, zachycení ukazatele
- [x] 6. `features/transform`: schéma v2, migrace, pivot, kotva, manipulátor
- [x] 7. `features/extrude`: kotva a manipulátor vzdálenosti
- [x] 8. `app` + `ui`: zapojení, `formatValue`, ruční ověření, revize
- [x] 9. Opravy z revize architektury

## Implementační plán

### Společná pravidla (platí pro každý úkol)

- Kontrakt je ve spec doslova (sekce v **Specifikace** výše). Čísla se berou ze spec: krok 1 mm a 5°, `PARALLEL_LIMIT` 0,999, `EDGE_ON_LIMIT` 0,02, 80 px, 60 px, 8 px a 6 px, `HANDLE_HIDE_COS` 0,98, posun štítku 16 px, `renderOrder` 4.
- Vektory jen přes fasádu `vec3`/`mat4` z `@/core` ([[0012-gl-matrix-za-fasadou|ADR 0012]]).
- Čisté soubory `render` bez `three` se přidají do pravidla `render-pure-files-without-three` v `.dependency-cruiser.cjs`.
- Doménová data neměnná, kotvy a úchyty zmrazené. Žádné `any`. Komentáře a identifikátory anglicky.
- TDD, na konci každého úkolu zelený `npm run check`.

### Na co si dát pozor (krajní případy bez vlastního úkolu)

1. **Úhlový tah přes ±π:** absolutní úhel skočí o 2π. Řeší ho `unwrapDelta` (úkol 2), test s tahem přes 400°.
2. **Regenerace selže uprostřed tažení** (snapshot bez kotev featury): tažení pokračuje se zmrazenými kotvami (úkol 4).
3. **Esc u kružnice jiné osy** musí vrátit `axis` i `angle` (úkol 4, test se dvěma klíči).
4. **Dialog se zavře během tažení** (Enter = OK, klik na Zrušit): tažení skončí bez zápisu do zavřené session. Zápis by vyhodil výjimku (úkol 4).
5. **Stará data Transformace:** dokument i záznamy logu z verze 1 se po migraci postaví stejně jako dřív (úkol 6, přehrání logu).
6. **Symetrické vysunutí:** šipka stojí v `distance/2`, štítek ukazuje celé `distance` (úkol 7).

### 1. Kotvy v `regen`

- **Soubory:** `src/regen/builder.ts` (`Anchor`, `FeatureAnchors`, `BuildOutput.anchors`), `src/regen/regenerator.ts` (cache, `RegenResult.anchors`, zmrazení), `src/regen/index.ts` (export typů), `src/regen/regenerator.test.ts` (nebo nový `regenerator-anchors.test.ts`), `src/regen/testing.ts` (pokud testovací builder potřebuje kotvy).
- **Kontrakt:** [[07-regenerace#Kotvy manipulátorů (M18)]], `BuildOutput` a `RegenResult` v [[07-regenerace#Builder featury]] a [[07-regenerace#Regenerator]], záznam cache v [[07-regenerace#Cache podle identity]].
- **Testy:** podle odrážky „Kotvy (M18)“ v [[07-regenerace#Testy (s `FakeKernel`)]]:
  - kotvy pod id featury, hluboce zmrazené (`Object.isFrozen` na mapě, kotvě i vektoru)
  - featura převzatá z cache (počítadlo volání builderu se nezvýší) má kotvy
  - chybná, potlačená a `rolledBack` featura ani featura bez kotev v mapě nejsou
  - po opravě chybné featury se kotvy vrátí
- **Hotovo když:** testy projdou, `npm run check` je zelený. Stávající buildery se nemění, pole je volitelné.

### 2. Typy úchytů a matematika tažení

- **Soubory:** `src/interaction/manipulators.ts` (typy `Handle*`, `ManipulatorDescriptor`, `HandleTint`, `HandleUnit`), `src/interaction/manipulator-drag.ts` (+ test), `src/interaction/index.ts` (export typů pro pluginy a `render`).
- **Kontrakt:** [[10-interakce#Deskriptor a úchyty (`manipulators.ts`)]], [[10-interakce#Matematika tažení (`manipulator-drag.ts`, čisté funkce)]].
- **Testy:** odrážka `manipulator-drag` v [[10-interakce#Testy]] (sekce Manipulátory):
  - `linearParam`: kolmý paprsek dá přesné `t`, šikmý paprsek dá parametr nejbližšího bodu, rovnoběžný paprsek dá `null`
  - `angularParam`: osa Z, `zero` = X, průsečíky v kvadrantech dají 0, π/2, π, −π/2; s osou −Z je znaménko opačné; paprsek v rovině dá `null`
  - `unwrapDelta(3, −3) ≈ 2π − 6`
  - `snapValue`: 12,4 → 12, 12,6 → 13, 5° krok, `fine` nechá hodnotu, ořez na `min` po přichycení, `−0` → `0`
  - simulace 20 kroků po 20° dá 400°
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 3. Registr manipulátorů a pole pluginu

- **Soubory:** `src/interaction/manipulators.ts` (`ManipulatorRegistry`, `createManipulatorRegistry`), `src/interaction/index.ts`, `src/plugin-api/plugin.ts` (`manipulators?`), `src/plugin-api/register.ts` (+ test), `src/app/registries.ts` (`createPluginRegistries` vytvoří registr), dotčená volání `registerPlugin` v testech (`registries.manipulators`).
- **Kontrakt:** [[11-ui#Plugin featury (plugin-api)]] (odrážka M18 u `registerPlugin`), [[10-interakce#Deskriptor a úchyty (`manipulators.ts`)]].
- **Testy:**
  - plugin s deskriptorem se zaregistruje pod svým typem
  - `type` deskriptoru ≠ typ schématu → výjimka a nic se nezaregistruje
  - duplicitní typ v registru → výjimka `Duplicate manipulator '…'` a nic se nezaregistruje
  - plugin bez deskriptoru registr nemění
  - `FeaturePlugin<TransformParams>` s deskriptorem jde předat jako `FeaturePlugin` bez přetypování (typový test jako u `build`)
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 4. `ManipulatorController` a směrování

- **Soubory:** `src/interaction/viewport-port.ts` (`ManipulatorPort`, `HandleView`, `HandleState`, `ManipulatorLabel`, `ViewportPort.manipulators`), `src/interaction/regen-status-port.ts` (`Anchor`, `FeatureAnchors`, `RegenSnapshot.anchors`), `src/interaction/manipulator-controller.ts` (+ test), `src/interaction/tool-manager.ts` (+ test), `src/interaction/testing.ts` (`FakeViewport`: `manipulatorViews`, `manipulatorLabel`, `prepareHandlePick`; `FakeRegenStatus.publish(…, anchors?)`), `src/interaction/index.ts`. Dotčená místa, která sestavují `RegenSnapshot` nebo implementují `ViewportPort`: `src/app/regen-status-adapter.ts` (`anchors` z `RegenResult.anchors`, hotové už v úkolu 4), `src/render/viewport.ts` (zatím prázdná implementace `manipulators`, skutečná v úkolu 5).
- **Kontrakt:** [[10-interakce#Port (`viewport-port.ts`)]], [[10-interakce#`ManipulatorController` (`manipulator-controller.ts`)]], [[10-interakce#Směrování v `ToolManager`]], `RegenSnapshot.anchors` v [[10-interakce#Port stavu regenerace]].
- **Testy:** odrážky `manipulator-controller` a `tool-manager` v [[10-interakce#Testy]] (sekce Manipulátory) a k tomu krajní případy 2–4 výše. Testovací deskriptor se dvěma úchyty: lineární `'a'` nad parametrem `x` a úhlový `'b'`, který přepíná `mode` a nastavuje `angle`.
- **Hotovo když:** testy projdou, `npm run check` je zelený a bez `manipulators` v `createToolManager` projdou stávající testy beze změny.

### 5. `ManipulatorLayer` v `render`

- **Soubory:** `src/render/manipulator-pick.ts` (+ test; `projectHandles`, `pickHandle`, konstanty `HANDLE_*`), `src/render/manipulator-layer.ts`, `src/render/viewport.ts` (vrstva, `pick` úchytů s promítnutím z kamery, měřítko v `draw`, `setPointerCapture` při levém stisku, štítek v `mount`/`unmount`), `src/render/index.ts`, `.dependency-cruiser.cjs` (čistý soubor).
- **Kontrakt:** [[09-vykreslovani#Manipulátory]], odrážka o zachycení ukazatele v [[09-vykreslovani#Události]].
- **Testy (Node, `manipulator-pick`):**
  - `projectHandles` s jednoduchou projekcí (`[x, −y]·k`): šipka má délku 80 px a správný směr, kružnice 64 bodů s poloměrem 60 px, šipka s `|cos| > 0,98` vypadne
  - `pickHandle`: bod na šipce v toleranci 8 px vrátí její id a mimo toleranci `null`; bod na kružnici v toleranci 6 px vrátí její id; při dvou kandidátech vyhraje bližší a při shodě dřívější
- **Ručně** (`dev/viewport.html` nebo aplikace po úkolu 8): glyfy mají stálou velikost při zoomu, jsou vidět skrz těleso, mají barvy os v obou paletách, štítek je u kurzoru.
- **Hotovo když:** testy projdou a `npm run check` je zelený.

### 6. Transformace v2

- **Soubory:** `src/features/transform/schema.ts` (`version: 2`, `pivot`, `pivotPoint`, `migrate`), `builder.ts` (pivot, matice, kotva), `manipulators.ts` (nový, `transformManipulators`), `index.ts` (`manipulators` v pluginu), `messages.ts`, `transform.test.ts`, případně `tests/` (scénář přehrání starého logu).
- **Kontrakt:**
  - **Params** v pořadí `bodies`, `pivot`, `pivotPoint`, `translate`, `axis`, `angle`:
    - `pivot: 'bodiesCenter' | 'origin' | 'point'` (enum, výchozí `'bodiesCenter'`, label `transform.pivot`, volby `transform.pivot.bodiesCenter`/`.origin`/`.point`)
    - `pivotPoint: Vec3` (point, výchozí `[0, 0, 0]`, label `transform.pivotPoint`, `visibleWhen: p => p.pivot === 'point'`)
  - **Texty:** cs „Střed otáčení“, „Střed těles“, „Počátek“, „Bod“, „Bod otáčení“. en „Pivot“, „Bodies center“, „Origin“, „Point“, „Pivot point“.
  - **`migrate(1, raw)`** → `{ ...raw, pivot: 'origin', pivotPoint: [0, 0, 0] }`. Neznámá verze → výjimka podle konvence `migrate` ve [[03-dokument]].
  - **Builder:**
    - `p` je střed sjednocené obálky (`kernel.boundingBox` každého vstupního tělesa, `(min + max) / 2`), nebo `[0, 0, 0]`, nebo `pivotPoint`.
    - `m = T(translate) · T(p) · R(AXIS[axis], angle) · T(−p)`.
    - Výstup `anchors: { pivot: { point: p } }` jen pro `pivot: 'bodiesCenter'` (revize: počátek a `pivotPoint` jdou spočítat z params).
    - Identita těles beze změny ([[07-regenerace#Builder featury]]).
  - **Manipulátor** (`handles(params, anchors)`): pivot `p` = `[0, 0, 0]` pro `origin`, `pivotPoint` pro `point`, kotva `pivot` pro `bodiesCenter` (bez kotvy → `[]`). `c = p + translate`:
    - `tx`/`ty`/`tz`: `linear`, `position: c`, `direction` = jednotkový vektor světové osy, `value = translate[i]`, `toParams(v) = { translate: translate s nahrazenou složkou i }`, `unit: 'length'`, `tint` podle osy.
    - `rx`/`ry`/`rz`: `angular`, `center: c`, `axis` = světová osa, `zero`: pro X je to Y, pro Y je to Z, pro Z je to X. `value = axis === k ? angle : 0`, `toParams(v) = { axis: k, angle: v }`, `unit: 'angle'`, `tint` podle osy.
- **Testy:**
  - migrace v1 → v2: `pivot: 'origin'`, `pivotPoint: [0, 0, 0]`, ostatní params beze změny
  - builder s `pivot: 'origin'` dá stejnou obálku jako dřívější test v1 (rotace kolem osy přes počátek)
  - `bodiesCenter`: kvádr `[10, 0, 0]–[12, 2, 2]`, rotace 90° kolem Z, pivot `[11, 1, 1]` → obálka beze změny polohy středu
  - `point` s vlastním bodem
  - kotva `pivot` ve výstupu, u dvou těles střed sjednocené obálky
  - kotva nezávisí na `translate` ani `angle` (stejná kotva pro dvě hodnoty)
  - `handles`: šest úchytů s očekávanými id, `c = pivot + translate`, `toParams` u `ty` nemění ostatní složky, `rx` při `axis: 'z'` má `value` 0 a `toParams(0.3)` dá `{ axis: 'x', angle: 0.3 }`, bez kotvy `[]`
  - přehrání logu s `feature.add` a `feature.setParams` ve verzi 1 dá featuru verze 2 s `pivot: 'origin'` ([[04-operace-a-historie#Migrace dat featur]])
- **Hotovo když:** testy projdou, `npm run check` je zelený a stávající e2e `m11.spec.ts` projde.

### 7. Extrude: kotva a manipulátor

- **Soubory:** `src/features/extrude/builder.ts` (kotva), `src/features/extrude/manipulators.ts` (nový), `src/features/extrude/index.ts`, `src/features/extrude/extrude.test.ts`.
- **Kontrakt:**
  - **Kotva `base`** jen pro `endType` `'blind'` a `'symmetric'` (u `'upToFace'` bez kotev):
    - `point` = střed sjednocené obálky ploch oblastí (`kernel.boundingBox` každého `ResolvedRegion.face`), promítnutý do roviny skici: `q − n·((q − plane.origin)·n)`.
    - `direction` = normála roviny skici, **bez** `flip` (revize: `flip` a `endType` jdou spočítat z params).
  - **Manipulátor:** `endType === 'upToFace'` nebo bez kotvy `base` → `[]`. Směr `d` = `−normal` pro `blind` s `flip`, jinak `normal`. Jeden úchyt `distance` (`linear`, `tint: 'neutral'`, `unit: 'length'`, `min: 0.01`, `direction = d`):
    - `blind`: `position = base + d·distance`, `value = distance`, `toParams(v) = { distance: v }`.
    - `symmetric`: `position = base + d·distance/2`, `value = distance/2`, `toParams(v) = { distance: 2v }`, `display(v) = 2v`.
- **Testy:**
  - kotva u `blind` (s `flip` i bez), u `symmetric` (směr podle normály, `flip` se ignoruje), žádná u `upToFace`
  - bod kotvy leží v rovině skici (`|(p − origin)·n| < 1e-9`) i pro rovinu posunutou od počátku
  - kotva nezávisí na `distance`
  - `handles` pro `blind`, `symmetric` (pozice, `toParams`, `display`)
  - bez kotvy `[]`
- **Hotovo když:** testy projdou, `npm run check` je zelený a stávající e2e `m13.spec.ts` projde.

### 8. Zapojení v `app` a `ui`

- **Soubory:** `src/app/session.ts` (controller, `formatValue` v `AppSessionDeps`, předání do `ToolManager`, `dispose`), `src/app/browser.ts` (`OpenAppSessionOptions.formatValue`), `src/app/index.ts` (re-export `HandleUnit`), `src/app/testing.ts`, `src/app/session.test.ts`, `src/ui/components/params/field-values.ts` (+ test: `formatHandleValue`), místo v `ui`, kde se volá `openAppSession`.
- **Kontrakt:** odrážka „Manipulátory“ v [[11-ui#Kompoziční kořen (app)]], pravidlo 7 v [[11-ui#Pravidla]].
- **Testy:**
  - `app`: po regeneraci s Transformací v otevřeném dialogu má `FakeViewport.manipulatorViews` šest úchytů. Tah `tz` (připravený `pick` a paprsky) změní `translate` v dokumentu. Po OK je v logu jedna položka. Po `dispose` jsou pohledy prázdné.
  - `ui`: `formatHandleValue(12.345, 'length') = '12.35 mm'`, `(Math.PI / 4, 'angle') = '45°'`.
- **Ruční ověření v prohlížeči** (hlavní sezení, náhled):
  - Transformace kvádru: šipky a kružnice ve středu kvádru, tah šipky posouvá těleso a pole v dialogu se mění, Shift jemně, štítek s mm
  - tah kružnicí jiné osy přepne osu v dialogu
  - Esc během tahu vrátí hodnotu
  - OK a undo vrátí celý dialog jedním krokem
  - Extrude: šipka na čele, tah mění vzdálenost, symetrické vysunutí
  - tmavý režim
- **Na konci:** `architecture-reviewer`, pak `/milnik konec M18`.
- **Hotovo když:** testy projdou, `npm run check` a `npm run test:e2e` jsou zelené a ruční ověření prošlo.

### 9. Opravy z revize architektury

- **Soubory:** `src/render/viewport.ts`, `src/interaction/manipulator-controller.ts` (+ test), `src/interaction/index.ts` (+ `index.test.ts`), `src/features/extrude/{builder,manipulators}.ts` (+ test), `src/features/transform/{builder,manipulators}.ts` (+ test), dotčená volání.
- **Kontrakt:**
  - `pointercancel` → levé `up` ([[09-vykreslovani#Události]]).
  - `createManipulatorController` bere `features: Pick<FeatureEditor, 'current'>`.
  - Matematika tažení zmizí z `interaction/index.ts`.
  - Kotva je co nejmenší ([[07-regenerace#Kotvy manipulátorů (M18)]]): u Extrude kotva bez `flip`, `flip` a `upToFace` řeší `handles()`; u Transformace kotva jen pro `bodiesCenter`.
- **Testy:**
  - Extrude: kotva má normálu i s `flip`; `handles` s `flip` míří proti normále; `upToFace` se starou kotvou → `[]`.
  - Transformace: `origin` a `point` bez kotvy dají úchyty v `p + translate`; `bodiesCenter` bez kotvy `[]`; builder vrací kotvu jen pro `bodiesCenter`.
  - Controller: typ deps (stávající testy).
- **Hotovo když:** `npm run check` a e2e zelené.

## Akceptační kritéria

- V dialogu Transformace jsou ve viewportu tři šipky a tři kružnice ve středu otáčení posunutém o `translate`. Tažení mění `translate`, `axis` a `angle` a pole dialogu se mění s ním.
- Střed otáčení jde v dialogu přepnout (střed těles / počátek / bod). Starý dokument s Transformací verze 1 se po načtení postaví stejně jako dřív.
- V dialogu Extrude (`blind`, `symmetric`) je na čele šipka. Tažení mění vzdálenost a štítek ukazuje celou vzdálenost.
- Přichytávání 1 mm a 5°, Shift jemně, štítek u kurzoru, Esc zruší tažení. Celý dialog je v historii jeden krok.
- Úchyt jde s kurzorem i během probíhající regenerace (kotva + živé params).
- Přidání manipulátoru do další featury nevyžaduje změnu v `render` ani v `interaction` (ověří revize na Extrude).
- `npm run check` a `npm run test:e2e` jsou zelené.

## Co se naučíš

- Jak rozdělit interaktivní prvek na drahou a stabilní část (kotva z regenerace) a levnou a živou část (úchyt z params). Tím se vyhneš zpoždění za asynchronním výpočtem.
- Čočka (`value` + `toParams`) jako způsob, jak obecný kód pracuje se skalárem a nic neví o sémantice featury.
- Matematika gizma: nejbližší bod přímky k paprsku, úhel v rovině přes `atan2` a rozbalení přes ±π, konstantní velikost na obrazovce v ortografické kameře.
- První skutečná migrace schématu featury a proč se výchozí hodnota pro nové featury liší od hodnoty pro migraci.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

**Co šlo dobře**
- Rozdělení „kotva z regenerace + živé úchyty v `interaction`“ se osvědčilo. Extrude přidal jen kotvu a deskriptor a `render` ani `interaction` nepotřebovaly žádnou změnu, takže akceptační kritérium rozšiřitelnosti ověřila revize na skutečném kódu.
- Čočka (`value` + `toParams`) zvládla bez úpravy controlleru i přepnutí osy u kružnic Transformace (Esc vrací dva klíče) a symetrické vysunutí (`2v`).
- První migrace schématu (Transformace v2) prošla celým řetězcem (`fromData`, přehrání logu, upcast `setParams`) bez obchvatu. Infrastruktura z M3 a M10.1 byla připravená.

**Co bylo jinak, než se čekalo**
- Revize ukázala, že invariant „kotva nezávisí na taženém parametru“ nestačí. Kotva nesla i `flip` a `pivotPoint`, takže úchyt po změně v dialogu čekal na regeneraci. Platí silnější pravidlo: kotva nese jen to, co z params spočítat nejde (úkol 9, [[Kotva je jen to, co z dat spočítat nejde]]).
- Ve standardních pohledech jsou dvě ze tří kružnic vidět z hrany. Skrytí kružnice (`HANDLE_RING_HIDE_COS`) se rozhodlo až při kontrole úkolu 5.
- `setPointerCapture` před předáním `pointerdown` by s neplatným `pointerId` událost spolkl. Ukázalo se to při ručním ověření se syntetickými událostmi, pořadí je teď opačné. Syntetické `PointerEvent` mají v Chromu chybné `offsetX/offsetY`, takže tažení se v prohlížeči ověřovalo skutečnou myší se sondou v posluchači.
- Matematika tažení byla nejdřív zbytečně veřejné API `interaction`. Revize ji vrátila dovnitř modulu.

**Co dál**
- Revolve: kotva osy a jeden úhlový úchyt. Má to být čistá deklarace a ověří to abstrakci potřetí.
- Kontrast úchytu Z na tělese zvýrazněném modrou barvou výběru je slabý (modrá na modré). Pomohl by obrys nebo světlejší stav `idle`.
- Pivot zatím nejde táhnout manipulátorem (rovinný úchyt nebo úchyt bodu, nový druh v `interaction` a `render`).
