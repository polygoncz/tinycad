---
type: milestone
status: todo
order: 22
aliases:
  - M22
  - M22 Režimy zobrazení
modules:
  - render
  - app
  - ui
specs:
  - "[[09-vykreslovani]]"
  - "[[11-ui]]"
depends_on:
  - "[[M21-vstupni-stav-editovane-featury]]"
started:
finished:
tags:
  - milnik
created: 2026-10-15
updated: 2026-10-15
---
# M22 – Režimy zobrazení

**Cíl:** viewport umí kreslit tělesa v režimech Shaded (s přepínači hran a průhlednosti), Hidden lines removed, Hidden lines visible a Wireframe. Přes kterýkoli z nich jde zapnout triangulaci. Režim se vybírá v menu u view cube a pamatuje se jako předvolba stránky.

**Specifikace:** [[09-vykreslovani#Styl zobrazení]], [[11-ui#Komponenty]]

**Navazuje na:** [[M21-vstupni-stav-editovane-featury|M21]]. Staví na dvou vrstvách těles z M21 (`BodyLayers`), proto až po něm. Pokračuje [[M23-postprocessing-a-ao|M23]] (AO) a [[M24-realisticke-zobrazeni|M24]] (Realistic a materiály).

## Rozsah

Pavel 2026-10-15: „Chtěl bych si teď trochu pohrát se zobrazováním. U současného módu by mělo jít povolit zapínání a vypínání průhlednosti. Pak bych tam doplnil další módy jako wireframe, hidden lines, možnost zapnout AO tam, kde dává smysl, a nějaký pokus o fotorealistické zobrazení.“

Rozhodnutí v sezení 2026-10-15 (brainstorming):
- Sada režimů jako v Onshape a k nim Realistic. Triangulace je **přepínač nad režimem**, ne samostatný režim.
- Realistic = real-time PBR **s materiály těles v dokumentu**.
- Rozdělení na tři milníky: M22 čárové režimy, průhlednost a triangulace; M23 postprocessing a AO; M24 Realistic a materiály. Všechny před [[M16-vlastni-occt-build|M16]].
- Výběr: **„co vidíš, to vybereš“**. V režimech, kde jsou vidět zakryté hrany, picking nekontroluje zákryt. Plochy jdou vybrat ve všech režimech.
- Přístup A: [[Styl zobrazení|styl zobrazení]] je neměnná hodnota a čistá funkce `resolveDisplay` z ní dělá plochý plán. Jen plán řídí `render`.
- Styl je předvolba stránky (jako režim otáčení, [[0020-rezim-otaceni-kamery|ADR 0020]]), ne dokument. Nové ADR M22 nepotřebuje.

## Úkoly

- [ ] 1. `display-style.ts`: typy, výchozí styl, `resolveDisplay`, `samePlan`
- [ ] 2. Paleta: `hiddenEdge`, `meshLine`
- [ ] 3. `BodyView` a `BodyLayer`: materiály podle plánu, skryté hrany, triangulace, čárky v pixelech
- [ ] 4. `Picker` a `HighlightLayer`: režim `xray`
- [ ] 5. `Viewport.setDisplayStyle` a `ViewSettings.setDisplayStyle` v `app`
- [ ] 6. `ui`: controller stylu s úložištěm
- [ ] 7. `ui`: `DisplayStyleMenu` v `AppShell`, i18n, e2e
- [ ] 8. Ruční ověření v prohlížeči, spec podle skutečnosti

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Kontrakt je v [[09-vykreslovani#Styl zobrazení]] a [[11-ui#Komponenty]] (odstavec *Styl zobrazení*).

### 1. `display-style.ts`

- **Soubory:** `src/render/display-style.ts` (nový, **bez importu `three`**), export typů a hodnot přes `src/render/index.ts`; `test/unit/render/display-style.test.ts`.
- **Kontrakt:** [[09-vykreslovani#Styl zobrazení]]: `DisplayMode`, `DISPLAY_MODES`, `DisplayStyle`, `DEFAULT_DISPLAY_STYLE`, `DisplayPlan`, `TRANSPARENT_FACE_OPACITY`, `resolveDisplay`, `samePlan`. Rozhodovací tabulka přesně podle spec.
- **Testy:** každý řádek tabulky (Shaded s hranami i bez, Shaded průhledný, Hidden lines removed, Hidden lines visible, Wireframe); `mesh` se propisuje ve všech režimech; `edges` a `transparent` mimo Shaded plán nemění; `samePlan` je strukturní rovnost; vrácený plán je zmrazený.
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 2. Paleta

- **Soubory:** `src/render/palette.ts`, `test/unit/render/palette.test.ts`.
- **Kontrakt:** `ScenePalette.hiddenEdge` a `meshLine` s hodnotami ze spec ([[09-vykreslovani#Viewport]]).
- **Testy:** obě palety obě barvy mají a jsou zmrazené (rozšíření stávajícího testu).
- **Hotovo když:** `npm run check` je zelený.

### 3. `BodyView` a `BodyLayer`

- **Soubory:** `src/render/body-view.ts`, `src/render/body-layer.ts`, `src/render/body-layers.ts` (M21: plán a velikost pixelu jen pro `main`), `test/unit/render/body-layer.test.ts`, `test/unit/render/body-layers.test.ts`.
- **Kontrakt:** [[09-vykreslovani#Styl zobrazení]], odstavce *Materiály*, *Skryté hrany*, *Triangulace*, *Barvy těles* a *Dvě vrstvy těles*. `BodyLayerInternal.setDisplayPlan(plan)` a `setPixelSize(worldPerPx)`.
- **Testy:** po `setDisplayPlan` mají pohledy materiál ploch podle `faces` (`lit` → materiál palety nebo barvy, `flat` → plochý, `hidden` → neviditelný); obarvené těleso v `flat` nemá svou barvu a po návratu do `lit` ji má zase; průhlednost (`opacity`, `transparent`, `depthWrite`) platí i pro materiály barev, včetně barvy nastavené až po přepnutí; těleso přidané po přepnutí (`sync`) dostane aktuální plán; `hiddenEdges` je viditelný jen při `'dashed'` a sdílí geometrii s `edges`; čáry triangulace vzniknou až při `meshLines: true` a při vypnutí i při `dispose` pohledu se uvolní; stejný plán nic nepřekresluje; `setPixelSize` přepočítá `dashSize`/`gapSize`; `setPalette` přebarví plochý materiál, skryté hrany i triangulaci. `BodyLayers.setDisplayPlan` změní jen hlavní vrstvu, náhled zůstane beze změny.
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 4. `Picker` a `HighlightLayer`

- **Soubory:** `src/render/picker.ts`, `src/render/highlight-layer.ts`, podle potřeby `src/render/viewport.ts` (předání příznaku do pickingu skic); testy `picker.test.ts`, `highlight-layer.test.ts`.
- **Kontrakt:** [[09-vykreslovani#Styl zobrazení]], odstavec *Picking a zvýraznění*. Picker dostane volbu `xray: () => boolean`, `HighlightLayerInternal.setXray(on)`.
- **Testy:** hrana za plochou: `xray` vypnutý → plocha (nebo nic), zapnutý → hrana; při `xray` vyhrává nejbližší kandidát; plochy jdou vybrat i s neviditelným materiálem (`colorWrite: false`); `setXray` přepne `depthTest` u zvýraznění ploch i hran včetně cílů vytvořených až po přepnutí; stejná hodnota nepřekresluje.
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 5. `Viewport` a `app`

- **Soubory:** `src/render/viewport.ts`, `src/render/index.ts`, `src/app/view-settings.ts`, `src/app/index.ts`; `test/unit/app/view-settings.test.ts` (případně nový).
- **Kontrakt:** `Viewport.setDisplayStyle(style)` ([[09-vykreslovani#Viewport]]), `ViewSettings.setDisplayStyle` a reexport `DisplayMode`, `DisplayStyle`, `DISPLAY_MODES` a `DEFAULT_DISPLAY_STYLE` z `app` ([[11-ui#Kompoziční kořen (app)]]). Viewport volá `bodies.setPixelSize` v `draw()` vedle `sketchLayer.setPixelSize`.
- **Testy:** `ViewSettings.setDisplayStyle` předá styl viewportu (fake viewport v testu).
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 6. Controller stylu v `ui`

- **Soubory:** `src/ui/display-style/display-style.ts`, `src/ui/display-style/use-display-style.ts`; `test/unit/ui/display-style/display-style.test.ts`.
- **Kontrakt:** [[11-ui#Komponenty]], odstavec *Styl zobrazení*.
- **Testy:** bez úložiště výchozí styl; uložený platný styl se načte; neplatný JSON → výchozí; neplatné jedno pole → jen to pole výchozí; chybějící pole → výchozí hodnota pole; `setMode` a `toggle*` mění `style` a ukládají; načtení nic neukládá; stejný režim nic neukládá.
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 7. `DisplayStyleMenu`

- **Soubory:** `src/ui/components/DisplayStyleMenu.vue` (nový), `src/ui/components/AppShell.vue`, překlady v `src/ui/i18n/`; e2e v `test/e2e/`.
- **Kontrakt:** [[11-ui#Komponenty]], odstavec *Styl zobrazení* (umístění, položky, zašedlé volby, klávesnice, i18n klíče).
- **Testy:** e2e: otevřít menu, projít všechny čtyři režimy a přepínače, bez chyb v konzoli; volba přežije obnovení stránky; ve Wireframe klik na zadní hranu kvádru vybere hranu.
- **Hotovo když:** e2e projde, `npm run check` je zelený.

### 8. Ruční ověření

- **Soubory:** vault (spec podle skutečnosti).
- Hlavní sezení projde režimy v prohlížeči ve světlém i tmavém tématu: obarvené těleso, skrytá tělesa, výběr a hover, skica, manipulátor Transformace, view cube. Rozdíly propíše do spec.

## Akceptační kritéria

- Menu vlevo od view cube nabízí Shaded, Hidden lines removed, Hidden lines visible a Wireframe a přepínače Hrany, Průhlednost a Triangulace. Hrany a Průhlednost jsou mimo Shaded zašedlé.
- Každý režim kreslí tělesa podle tabulky v [[09-vykreslovani#Styl zobrazení]], ve světlém i tmavém tématu.
- Skryté hrany v Hidden lines visible jsou čárkované a délka čárky v pixelech se při zoomu nemění.
- Ve Wireframe, Hidden lines visible a průhledném Shaded jde vybrat hrana za plochou a její zvýraznění je vidět.
- Triangulace jde zapnout ve všech režimech, při vypnutí se geometrie uvolní.
- Zvolený styl přežije obnovení stránky, neplatné uložené hodnoty nic nerozbijí.
- Skici, manipulátory, mřížka, view cube a náhled editované featury (M21) vypadají ve všech režimech stejně jako dnes.
- `npm run check` a `npm run test:e2e` jsou zelené.

## Co se naučíš

- Jak rozhodovací tabulka z čisté funkce odděluje *co* kreslit od *jak* to provést ve Three.js (stejný vzor jako `toolModes`).
- Hloubkový buffer jako nástroj: `depthFunc`, `colorWrite`, `depthWrite`, `polygonOffset` a `renderOrder` místo výpočtu viditelnosti.
- Proč je průhlednost v rasterizaci těžká (řazení po objektech, ne po trojúhelnících) a co je order-independent transparency.
- Sdílení geometrie mezi objekty s různými materiály a vlastnictví GPU zdrojů při líném vytváření.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
