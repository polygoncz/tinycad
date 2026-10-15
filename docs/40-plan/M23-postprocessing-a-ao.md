---
type: milestone
status: done
order: 23
aliases:
  - M23
  - M23 Postprocessing a AO
modules:
  - render
  - app
  - ui
specs:
  - "[[09-vykreslovani]]"
  - "[[11-ui]]"
depends_on:
  - "[[M22-rezimy-zobrazeni]]"
started: 2026-10-15
finished: 2026-10-15
tags:
  - milnik
created: 2026-10-15
updated: 2026-10-15
---
# M23 – Postprocessing a AO

**Cíl:** vykreslování viewportu umí víc průchodů (`EffectComposer`) a [[Styl zobrazení|styl zobrazení]] dostane přepínač ambient occlusion v režimech, kde dává smysl.

**Specifikace:** [[09-vykreslovani#Styl zobrazení]], [[09-vykreslovani#Víceprůchodové vykreslování (AO)]], [[11-ui#Komponenty]]

**Rozhodnutí:** [[Q077 Technika AO|Q077]], [[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]]

**Navazuje na:** [[M22-rezimy-zobrazeni|M22]]

## Rozsah

- `DisplayStyle.ao` a `DisplayPlan.ao`. AO platí jen v Shaded bez průhlednosti (a od M24 v Realistic). Jinde se přepínač ignoruje a v menu je zašedlý. Průhledné plochy nezapisují hloubku a AO z hloubkového bufferu by pod nimi kreslilo tmavé skvrny.
- `viewport.draw()`: při `ao: false` beze změny (jeden `renderer.render`, žádná cena navíc), při `ao: true` průchod přes composer: model → AO → výstup. Zvýraznění, overlay, skici, manipulátory a mřížka se dokreslí **po** AO, aby je AO neztmavilo ([[Q077 Technika AO|Q077]]). View cube dál až nakonec.
- Antialiasing: render target composeru nemá MSAA zdarma. Řeší se vzorky render targetu (WebGL2) nebo průchodem FXAA/SMAA, rozhodne se v ADR.
- Změna velikosti plátna a `devicePixelRatio` pro render targety, uvolnění při `unmount`.
- Controller v `ui` doplní pole `ao` (validace po polích z M22 starý uložený styl přečte) a menu dostane přepínač AO.
- ADR: víceprůchodové vykreslování ve viewportu (co se kreslí v jakém průchodu, kdo vlastní render targety): [[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]].

## Úkoly

- [x] 0. Rozhodnout [[Q077 Technika AO|Q077]], sepsat ADR, doplnit spec 09 a 11 a implementační plán
- [x] 1. `display-style.ts`: pole `ao` ve stylu a plánu
- [x] 2. `ao-parameters.ts` a `scene-partition.ts`
- [x] 3. Pipeline AO a její zapojení do `Viewport`
- [x] 4. `ui`: `toggleAo`, položka menu, i18n
- [x] 5. Nastavení AO v `render` a `app` ([[Q081 Uživatelské nastavení AO|Q081]])
- [x] 6. `ui`: controller a panel Nastavení AO
- [x] 7. E2E `m23.spec.ts` a úprava e2e M22
- [x] 8. Ruční ověření a doladění výchozích hodnot AO

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Kontrakt je v [[09-vykreslovani#Styl zobrazení]], [[09-vykreslovani#Víceprůchodové vykreslování (AO)]] a [[11-ui#Komponenty]] (odstavec *Styl zobrazení*). Návrh a alternativy: [[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]].

### 1. `display-style.ts`: pole `ao`

- **Soubory:** `src/render/display-style.ts`, `test/unit/render/display-style.test.ts`. Všechna místa, kde vzniká `DisplayStyle` nebo `DisplayPlan` literálem (testy, `testing.ts`), dostanou `ao`. Typecheck je najde.
- **Kontrakt:** `DisplayStyle.ao`, `DEFAULT_DISPLAY_STYLE.ao = false`, `DisplayPlan.ao` podle [[09-vykreslovani#Rozhodovací tabulka]]: `style.ao` jen v `shaded` bez `transparent`, jinde `false`. `samePlan` porovnává i `ao`.
- **Testy:** Shaded s `ao` → `plan.ao`; Shaded s `ao` a průhledností → ne; Hidden lines removed, Hidden lines visible a Wireframe s `ao` → ne; `ao` nemění žádné jiné pole plánu; `samePlan` rozliší plány lišící se jen `ao`; výchozí styl má `ao: false`.
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 2. `ao-parameters.ts` a `scene-partition.ts`

- **Soubory:** `src/render/ao-parameters.ts` (nový, **bez importu `three`**), `src/render/scene-partition.ts` (nový, s `three`); `test/unit/render/ao-parameters.test.ts`, `test/unit/render/scene-partition.test.ts`. Nic z toho se neexportuje z `src/render/index.ts`.
- **Kontrakt:** [[09-vykreslovani#Víceprůchodové vykreslování (AO)]], odstavce *Parametry* a *Rozdělení scény*: `AoParameters`, `AO_RADIUS_PX`, `AO_THICKNESS_PX`, `aoParameters`, `ScenePartition`, `partitionScene`, `aoExcluded`, `hideDuring`.
- **Testy:**
  - `aoParameters`: `radius` a `thickness` úměrné `worldPerPx` (dvojnásobek → dvojnásobek); ostatní pole na `worldPerPx` nezávisí; `samples` je celé číslo; `0`, záporné, `NaN` a `Infinity` vyhodí.
  - `partitionScene`: model jen ze zadaných skupin; interakce = ostatní přímí potomci scény; světlo (`HemisphereLight`) a kamera (s potomkem `DirectionalLight`) v interakcích nejsou.
  - `aoExcluded`: najde `LineSegments2` i vnořené hluboko, `Mesh` a `LineSegments` ne.
  - Kanárek předpokladu z ADR: `LineSegments2` nemá `isLine2`, takže `GTAOPass` ho sám neskryje.
  - `hideDuring`: během `fn` jsou objekty skryté; potom mají původní hodnoty, i dřív skrytý objekt zůstane skrytý; obnoví se i po výjimce z `fn` (výjimka jde dál); duplicitní objekt v seznamu se obnoví správně; vrací výsledek `fn`.
- **Hotovo když:** testy projdou, `npm run check` je zelený (`lint:deps` hlídá, že `ao-parameters.ts` nebere `three`).

### 3. Pipeline AO ve `Viewport`

- **Soubory:** `src/render/ao-pipeline.ts` (nový), `src/render/viewport.ts`.
- **Kontrakt:** [[09-vykreslovani#Víceprůchodové vykreslování (AO)]], odstavce *Průchody*, *Pipeline*, *Vlastnictví a životní cyklus* a *Barvy*; [[09-vykreslovani#Styl zobrazení]] (odstavec `Viewport.setDisplayStyle`). Importy z `three/addons/postprocessing/…` a `three/addons/shaders/GTAOShader.js`.
- **Testy:** pipeline potřebuje WebGL, unit test nemá. Ověří ji úkol 5 a ruční kontrola. Implementátor ověří, že bez AO zůstává `draw()` beze změny: stávající unit testy a `npm run test:e2e -- m22` jsou zelené.
- **Hotovo když:** `npm run check` je zelený, e2e M22 projde, `npm run build` projde.

### 4. `ui`: přepínač AO

- **Soubory:** `src/ui/display-style/display-style.ts`, `src/ui/display-style/menu-items.ts`, `src/ui/i18n/cs.ts`, `src/ui/i18n/en.ts`; `test/unit/ui/display-style/display-style.test.ts`, `test/unit/ui/display-style/menu-items.test.ts`.
- **Kontrakt:** [[11-ui#Komponenty]], odstavec *Styl zobrazení*: `toggleAo()`, validace pole `ao`, položka `ao` mezi Průhledností a Triangulací, povolená jen v Shaded bez průhlednosti, i18n `displayStyle.ao`.
- **Testy:** podle [[11-ui#Testy]] (řádek M23).
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 5. Nastavení AO v `render` a `app`

Rozhodnutí [[Q081 Uživatelské nastavení AO|Q081]] (Pavel 2026-10-15): parametry AO jsou uživatelské nastavení, ne konstanty.

- **Soubory:** `src/render/ao-parameters.ts`, `src/render/viewport.ts`, `src/render/index.ts`, `src/app/view-settings.ts`, `src/app/index.ts`; testy `test/unit/render/ao-parameters.test.ts`, `test/unit/app/view-settings.test.ts`.
- **Kontrakt:** [[09-vykreslovani#Víceprůchodové vykreslování (AO)]], odstavce *Nastavení a parametry*, `Viewport.setAoSettings` a *Nulová velikost plátna* v *Vlastnictví a životní cyklus*. [[11-ui#Kompoziční kořen (app)]], řádek `view-settings.ts`.
- Konstanty `AO_RADIUS_PX` a `AO_THICKNESS_PX` zanikají a `aoParameters(settings, worldPerPx)` dostane nastavení.
- **Testy:**
  - `aoParameters` je úměrné `worldPerPx` a ostatní pole přebírá z nastavení.
  - `DEFAULT_AO_SETTINGS` je platné a zmrazené a leží v rozsazích.
  - `AO_SETTING_RANGES` mají `min < max` a `step > 0` a jsou zmrazené.
  - `isValidAoSetting`: hranice rozsahu platí, mimo rozsah ne, `NaN` a `Infinity` ne, `samples` desetinné číslo ne.
  - `ViewSettings.setAoSettings` předá nastavení viewportu (falešný viewport).
  - `Viewport.setAoSettings` s neplatným polem vyhodí. **Bez testu:** `createViewport` v Node nevzniká (`navigator`, `requestAnimationFrame`) a v e2e se to přes `ui` vyvolat nedá, protože `ui` hodnoty zarovná do rozsahu. Je to obranná kontrola, ověřená revizí kódu.
- **Hotovo když:** testy projdou, `npm run check` a `npm run build` jsou zelené.

### 6. `ui`: controller a panel Nastavení AO

- **Soubory:** `src/ui/display-style/ao-settings.ts`, `use-ao-settings.ts` a `ao-settings-panel.ts` (nové), `src/ui/display-style/menu-items.ts`, `src/ui/components/AoSettingsPanel.vue` (nový), `src/ui/components/DisplayStyleMenu.vue`, `src/ui/components/AppShell.vue`, `src/ui/i18n/cs.ts`, `src/ui/i18n/en.ts`; testy v `test/unit/ui/display-style/`.
- **Kontrakt:** [[11-ui#Komponenty]], odstavec *Styl zobrazení*, část *Nastavení AO*. Logika patří mimo `.vue` ([[0010-prezentacni-model|ADR 0010]]).
- **Testy:** podle [[11-ui#Testy]] (řádek M23, část nastavení AO).
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 7. E2E `m23.spec.ts` a úprava e2e M22

- **Soubory:** `test/e2e/m23.spec.ts` (nový, vzor `m22.spec.ts` a stabilní snímek plátna z `m19-2-views.spec.ts`), `test/e2e/m22.spec.ts` (test na řádku 71 čeká přepínače jen z M22, přibyla Ambientní okluze a Nastavení AO…).
- **Testy:**
  - Kvádr a na něm menší kvádr, aby vznikl vnitřní roh.
  - Snímek plátna bez AO, zapnout Ambientní okluzi, snímek se liší. Vypnout ji a snímek je stejný jako na začátku.
  - V průhledném Shaded a v ostatních režimech je položka zašedlá (`aria-disabled`).
  - Volba přežije obnovení stránky.
  - Se zapnutým AO jde vybrat plocha a zvýraznění je vidět (snímek se liší od snímku bez výběru).
  - Nastavení AO: položka je zašedlá při vypnutém AO a povolená při zapnutém. Panel se otevře, posuvník Poloměr změní snímek. Hodnota přežije obnovení stránky. Výchozí vrátí původní snímek. Esc panel zavře a fokus je na tlačítku stylu.
  - Bez chyb v konzoli (fixtures).
- **Hotovo když:** `npm run test:e2e -- m23` a celé `npm run test:e2e` jsou zelené.

### 8. Ruční ověření

- **Soubory:** vault (spec podle skutečnosti), `DEFAULT_AO_SETTINGS` v `ao-parameters.ts`.
- Hlavní sezení s Pavlem projde AO v prohlížeči ve světlém i tmavém tématu: vnitřní rohy, zoom (AO drží velikost v px), obarvené těleso, triangulace (silné hrany nesmí dělat skvrny), výběr a hover, skica na ploše i za tělesem, manipulátor, náhled editované featury, mřížka, view cube, změna velikosti okna. Výchozí hodnoty doladíme přes panel Nastavení AO a zapíšeme je do `DEFAULT_AO_SETTINGS` a spec 09. Posoudíme světlejší hrany s AO (spec 09, *Známá omezení*). Rozdíly propíšeme do spec.

## Akceptační kritéria

- Menu stylu má přepínač Ambientní okluze. Je povolený jen ve stínovaném režimu bez průhlednosti, jinde je zašedlý a hodnota se drží.
- Se zapnutým AO jsou vnitřní rohy a styky ploch tmavší. Velikost zastínění se při zoomu na obrazovce nemění.
- Zvýraznění, overlay, skici, manipulátory, mřížka a náhled editované featury AO neztmavuje. Skica a mřížka za tělesem zůstávají zakryté jako bez AO.
- Hrany a pozadí jsou s AO vyhlazené (MSAA) a barva pozadí i palety je stejná jako bez AO.
- Bez AO se vykresluje jedním průchodem jako v M22 (žádný render target). Pipeline AO se při vypnutí AO a při `unmount` uvolní, změna velikosti okna ji nerozbije.
- Picking funguje s AO stejně jako bez něj.
- Uložený styl z M22 (bez `ao`) se načte, volba AO přežije obnovení stránky.
- Panel Nastavení AO (z menu stylu) mění poloměr a sílu a v části Pokročilé tloušťku, útlum, měřítko a vzorky. Změna je vidět hned, uloží se po puštění posuvníku a přežije obnovení stránky. Výchozí vrátí výchozí hodnoty.
- `npm run check`, `npm run build` a `npm run test:e2e` jsou zelené.

## Co se naučíš

- Postprocessing v Three.js: render targety, průchody, `EffectComposer`, `OutputPass` a barevný prostor.
- Jak funguje screen-space AO (hloubka a normály → odhad zastínění) a proč selhává u průhledných ploch.
- Proč render target přichází o MSAA a jak to obejít.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_Návrh, Pavel doplní nebo upraví._

**Co bylo jinak, než se čekalo**

- **Návrh z Q077 se při čtení zdrojáků three dvakrát změnil.** Sdílený `DepthTexture` mezi dvěma render targety composeru by s MSAA nefungoval, protože hloubka leží v renderbufferu každého targetu zvlášť. Rozdělení scény přes `Object3D.layers` by zase rozbilo `Raycaster`, protože vrstvy se nedědí a výchozí raycaster testuje jen vrstvu 0. Výsledek je jednodušší: jeden render target, AO vynásobené na místě a skrytí kořenových skupin na dobu průchodu ([[0026-viceprochodove-vykreslovani-ve-viewportu|ADR 0026]]).
- **`GTAOPass` má mezery:**
  - `LineSegments2` (silné hrany) v G-bufferu neskryje.
  - Externí G-buffer přes `setGBuffer` je ve 0.186 rozbitý.
  - `dispose` neuvolní dva materiály.
- **`RenderPass` maže lineární target barvou v sRGB:** pozadí s AO bylo světlejší. Na chybu přišel až smoke test implementátora, který porovnával pixely.
- **Z ladicího panelu se stalo uživatelské nastavení:** Pavel chtěl parametry AO zpřístupnit uživateli. Vznikla [[Q081 Uživatelské nastavení AO|Q081]] a dva úkoly navíc (5 a 6). Konstanty v pixelech se změnily na předvolbu `AoSettings`.
- **Výchozí hodnoty sedly napoprvé:** při ručním ověření je Pavel nechal beze změny. Přijal i světlejší hrany s AO, které vznikají průměrováním MSAA v lineárním prostoru.

**Co se osvědčilo**

- **Přečíst zdrojáky knihovny před zápisem kontraktu.** Obě slepé uličky se našly ještě ve vaultu, ne až v kódu.
- **Souběžní implementátoři na úkolech s oddělenými soubory** (2 a 4, pak 3 a 4) bez worktree. Jejich běhy `npm run check` se navzájem neshodily.
- **Bajtově přesné snímky plátna v e2e:** stabilní v Chrome i WebKitu, MSAA se ukázalo jako deterministické.
- **Revize architektury chytla ručně psané seznamy polí:** opravené na `Record` a příznak `integer` v rozsahu, takže úplnost hlídá typecheck.
