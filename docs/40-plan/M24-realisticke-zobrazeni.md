---
type: milestone
status: done
order: 24
aliases:
  - M24
  - M24 Realistické zobrazení
modules:
  - document
  - ops
  - persistence
  - interaction
  - render
  - app
  - ui
specs:
  - "[[03-dokument]]"
  - "[[04-operace-a-historie]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M23-postprocessing-a-ao]]"
started: 2026-10-15
finished: 2026-10-15
tags:
  - milnik
created: 2026-10-15
updated: 2026-10-15
---
# M24 – Realistické zobrazení

**Cíl:** [[Styl zobrazení|styl zobrazení]] dostane režim Realistic: fyzikálně založené materiály, osvětlení z environment mapy, tone mapping a kontaktní stín. [[Těleso]] má v dokumentu materiál (plast, hliník, ocel…), který jde vybrat v [[Prohlížeč|Prohlížeči]].

**Specifikace:** [[09-vykreslovani#Styl zobrazení]], [[09-vykreslovani#Realistic]], [[03-dokument#Metadata těles]], [[04-operace-a-historie#Sada operací]], [[10-interakce]], [[11-ui#Komponenty]]

**Rozhodnutí:** [[Q078 Sada materiálů těles|Q078]], [[Q082 Scéna režimu Realistic|Q082]], [[0027-material-telesa-a-scena-realistic|ADR 0027]]

**Navazuje na:** [[M23-postprocessing-a-ao|M23]]

## Rozsah

**Dokument a operace** (vzor barvy z [[M15-export-a-dokonceni|M15]], [[Q073 Průhlednost a barva těles|Q073]]):
- `BodyMeta.material` (předvolba, chybí = výchozí), validace v `fromData` a v operaci, nová operace `body.setMaterial` (log, undo), verze schématu a operace podle pravidel migrace.
- `BrowserModel.materials` a `setMaterial`, `Viewport.setBodyMaterial` a znovupoužití po `sync` v `ViewportMirror` (jako barva a skrytí).

**Vykreslování:**
- `DisplayMode` dostane `'realistic'`, `DisplayPlan.faces` hodnotu `'physical'` a `DisplayPlan` část pro scénu (mřížka, světla, tone mapping, environment), kterou aplikuje viewport.
- `MeshPhysicalMaterial` podle předvolby a barvy tělesa ([[Q078 Sada materiálů těles|Q078]]), materiály sdílené podle dvojice (materiál, barva) s počtem uživatelů, jako dnes barvy.
- Environment mapa z `RoomEnvironment` přes `PMREMGenerator` (generovaná v kódu, nic se nestahuje). Tone mapping AgX jen v Realistic (změna `toneMapping` vynutí rekompilaci shaderů, proto jen při přepnutí režimu).
- Mřížka skrytá, místo ní kontaktní stín pod modelem ve výšce spodku obálky viditelných těles. Pozadí je jemný gradient.
- Hrany se v Realistic nekreslí, triangulace a AO ano (AO výchozí podle [[Q077 Technika AO|Q077]]).

**UI:** režim Realistic v menu, výběr materiálu v Prohlížeči vedle barvy. Kontextové menu tělesa neexistuje, proto je výběr `<select>` v řádku, viz [[11-ui#Komponenty]].

**ADR:** materiál tělesa v dokumentu (proč předvolba, ne parametry rendereru; vztah k barvě).

## Úkoly

- [x] 0. Rozhodnout [[Q078 Sada materiálů těles|Q078]] a [[Q082 Scéna režimu Realistic|Q082]], sepsat ADR, doplnit spec 03, 04, 09, 10, 11 a implementační plán
- [x] 1. `document`: `BodyMaterial` v metadatech těles
- [x] 2. `ops`: `body.setMaterial`, zachování polí metadat
- [x] 3. `interaction`: materiál v `BrowserModel`
- [x] 4. `render`: režim Realistic v plánu, předvolby, tone mapping v shaderu
- [x] 5. `render`: fyzikální materiály ve vrstvě těles
- [x] 6. `render`: scéna Realistic (environment, pozadí, mřížka, kontaktní stín, sklo v AO)
- [x] 7. `app`: zrcadlení materiálů a reexporty
- [x] 8. `ui`: Realistic v menu, materiál v Prohlížeči, i18n
- [x] 9. E2E `m24.spec.ts` a úprava e2e M22 a M23
- [x] 10. Ruční ověření a doladění předvoleb

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Návrh a alternativy: [[0027-material-telesa-a-scena-realistic|ADR 0027]].

**Pořadí a vlny:**
1. Úkoly 1 a 4 souběžně (jiné moduly).
2. Úkoly 2 a 3 (3 potřebuje `document` z úkolu 1).
3. Úkol 5 (potřebuje typ z `interaction`, úkol 3).
4. Úkoly 6 a 7 souběžně.
5. Úkol 8, pak 9 a 10.

### 1. `document`: `BodyMaterial`

- **Soubory:** `src/document/model.ts`, `src/document/cad-document.ts` (`canonicalMeta`, `sameMeta`), `src/document/serialize.ts` (`readBodyMeta`: seznam povolených klíčů, kontrola pole, kanonický výsledek), `src/document/index.ts`; testy `test/unit/document/model.test.ts`, `cad-document.test.ts`, `serialize.test.ts`, `index.test.ts` (seznam exportů).
- **Kontrakt:** [[03-dokument#Metadata těles]]: `BodyMaterial`, `BODY_MATERIALS`, `DEFAULT_BODY_MATERIAL`, `isBodyMaterial`, `BodyMeta.material`, kanonizace (výchozí `'plastic'` se neukládá), `fromData` s cestou issue `.material`.
- **Testy:**
  - `isBodyMaterial` přijme všech šest, odmítne jiný řetězec, velká písmena a ne-řetězec;
  - `setBodyMeta` s `'plastic'` záznam neuloží (s jiným polem ho uloží bez `material`);
  - `fromData` načte materiál, `'plastic'` vypustí, neplatný → issue s cestou;
  - `toData`/`fromData` tam a zpět.
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 2. `ops`: `body.setMaterial`

- **Soubory:** `src/ops/operation.ts` (`OP_VERSION`, `BodySetMaterialOp`), `src/ops/index.ts`, `src/ops/handlers/shape.ts` (validátor), `src/ops/handlers/body.ts`; testy `handler.test.ts` (počet handlerů), `index.test.ts`, `handlers/handlers.test.ts`, `handlers/validate.test.ts`, `apply.test.ts`, `replay.property.test.ts`.
- **Kontrakt:** [[04-operace-a-historie#Sada operací]] a tabulka validace.
  - **Oprava:** `setVisible.apply` a `setColor.apply` skládají metadata z `...aktuální`, ne výčtem polí, jinak by `material` zahodily.
- **Testy:**
  - podle [[04-operace-a-historie]], část *Testy*: apply, inverze (`'plastic'` u tělesa bez materiálu), validate;
  - každá operace `body.*` zachová ostatní čtyři pole;
  - replay s `body.setMaterial`.
- **Hotovo když:** testy projdou, `npm run check` je zelený. Pozor: `test/unit/ui/i18n/i18n.test.ts` vyžaduje text historie pro každý typ operace, takže klíče `body.setMaterial` v cs a en přidej už tady.

### 3. `interaction`: materiál v `BrowserModel`

- **Soubory:** `src/interaction/browser-model.ts`, `src/interaction/index.ts` (reexporty z `document`); `test/unit/interaction/browser-model.test.ts`.
- **Kontrakt:** [[10-interakce]], `BrowserModel`: `row.material`, `materials`, `setMaterial`, pořadí vyslání a reexporty.
- **Testy:** podle [[10-interakce]], řádek M24 v *Testy*.
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 4. `render`: plán Realistic, předvolby, tone mapping

- **Soubory:** `src/render/display-style.ts`, `src/render/material-presets.ts` (nový, **bez `three`**, přidat do seznamu čistých souborů v `.dependency-cruiser.cjs`), `src/render/physical-materials.ts` (nový); testy `display-style.test.ts`, `material-presets.test.ts`, `physical-materials.test.ts`. Všechna místa, kde vzniká `DisplayPlan` literálem, dostanou `scene`.
- **Kontrakt:** [[09-vykreslovani#Rozhodovací tabulka]] (řádek `realistic`, pole `scene`), [[09-vykreslovani#Realistic]], odstavce *Předvolby* a *Fyzikální materiály*. Typ `BodyMaterial` dočasně jako lokální typ v `material-presets.ts` se stejným výčtem. Úkol 5 ho nahradí typem z `@/interaction`, protože úkol 3 běží souběžně.
- **Testy:**
  - řádek `realistic` tabulky (`edges` a `transparent` se ignorují, `ao` ano, `scene: 'realistic'`), ostatní řádky mají `scene: 'studio'`;
  - `samePlan` rozliší `scene`;
  - `MATERIAL_PRESETS` je úplné, v rozsazích a zmrazené;
  - `physicalColor` (barva tělesa, `baseColor`, paleta);
  - `injectAgxToneMapping` (náhrada a vložení, chybějící include vyhodí);
  - kanárek shader chunků;
  - `createPhysicalMaterial` nastaví parametry předvolby, `polygonOffset` a `envMap`.
- **Hotovo když:** testy projdou, `npm run check` je zelený. `ui` testy s výčtem režimů (`menu-items.test.ts`) se upraví v úkolu 8. Pokud typecheck vyžaduje drobnost v `ui` (ikona režimu v `Record`), přidej jen `ti-sparkles` a ohlas to.

### 5. `render`: fyzikální materiály ve vrstvě těles

- **Soubory:** `src/render/body-layer.ts`, `src/render/body-layers.ts`, `src/render/body-view.ts` (podle potřeby), `src/render/material-presets.ts` (typ z `@/interaction`), `src/render/viewport.ts` (`setBodyMaterial`), `src/render/index.ts`; testy `body-layer.test.ts`, `body-layers.test.ts`.
- **Kontrakt:** [[09-vykreslovani#Realistic]], odstavec *Vrstva těles*.
- **Testy:**
  - `faces: 'physical'` dá tělesu fyzikální materiál podle předvolby a barvy;
  - dvě tělesa se stejnou dvojicí sdílí materiál, po odebrání jednoho žije, po odebrání obou se uvolní;
  - přepnutí plánu z `physical` uvolní všechny;
  - materiál přežije `sync` s novým handle a zmizí s tělesem;
  - těleso, které ve vrstvě ještě není, se zahodí;
  - neznámý materiál vyhodí;
  - stejná hodnota nepřekresluje;
  - `setEnvironment` nastaví `envMap` i materiálům vytvořeným později;
  - `setPalette` přebarví plast bez barvy;
  - náhledová vrstva fyzikální materiály nedostane.
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 6. `render`: scéna Realistic

- **Soubory:** `src/render/contact-shadow.ts` (nový), `src/render/scene-helpers.ts` (`setGridVisible`), `src/render/scene-partition.ts` (`withoutBackground`, `aoExcluded` se sklem), `src/render/ao-pipeline.ts` (pozadí jen v průchodu modelu), `src/render/palette.ts` (`realisticBackground`), `src/render/viewport.ts`; testy `scene-partition.test.ts`, `scene-helpers.test.ts`, `palette.test.ts`, `contact-shadow.test.ts` (co jde bez WebGL: umístění roviny a kamery podle obálky, `invalidate` a přepočet jen jednou, skrytá rovina bez obálky, `dispose`).
- **Kontrakt:** [[09-vykreslovani#Realistic]], odstavce *Scéna Realistic* a *Průchod AO a sklo*.
- **Testy:** viz výše a `withoutBackground` (obnova i po výjimce), `aoExcluded` vrací mesh s `transmission > 0`, ale ne bez něj.
- **Hotovo když:** testy projdou, `npm run check`, `npm run build` a e2e M22 a M23 jsou zelené. Smoke test v prohlížeči (dočasný, necommitovat): Realistic s AO i bez něj, bez chyb v konzoli, stín pod tělesy, gradient pozadí.

### 7. `app`: zrcadlení materiálů

- **Soubory:** `src/app/viewport-mirror.ts`, `src/app/session.ts` (`AppViewport.setBodyMaterial`), `src/app/testing.ts`, `src/app/index.ts`; testy `viewport-mirror.test.ts`, `session.test.ts`.
- **Kontrakt:** [[11-ui#Kompoziční kořen (app)]], odstavec *Materiál*.
- **Testy:** změna mapy → `setBodyMaterial`; odebrání → `DEFAULT_BODY_MATERIAL`; `reapply` pošle materiály znovu; session po `sync` materiál znovu použije.
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 8. `ui`: Realistic a materiál

- **Soubory:** `src/ui/display-style/menu-items.ts`, `src/ui/components/Browser.vue`, `src/ui/i18n/cs.ts`, `src/ui/i18n/en.ts`; testy `menu-items.test.ts`, `i18n.test.ts`, případně helper pro volby materiálu (logika mimo `.vue`).
- **Kontrakt:** [[11-ui#Komponenty]] (menu stylu, *Materiál tělesa*), i18n a řádek M24 v [[11-ui#Testy]].
- **Hotovo když:** testy projdou, `npm run check` je zelený.

### 9. E2E

- **Soubory:** `test/e2e/m24.spec.ts` (nový); `test/e2e/m22.spec.ts` a `m23.spec.ts` (výčet režimů).
- **Testy:**
  - Realistic z menu: snímek se liší od Stínovaného, Hrany a Průhlednost jsou zašedlé, AO jde zapnout.
  - Materiál v Prohlížeči: výběr Hliník změní snímek v Realistic a ve Stínovaném ne.
  - Materiál přežije obnovení a export s importem a jde vrátit přes undo.
  - Výběr plochy v Realistic je vidět.
  - Bez chyb v konzoli.
- **Hotovo když:** celé `npm run test:e2e` je zelené.

### 10. Ruční ověření

- Hlavní sezení s Pavlem projde Realistic ve světlém i tmavém tématu:
  - všech šest materiálů s barvou i bez ní, sklo před jiným tělesem;
  - AO zapnuté a vypnuté;
  - stín po přesunu tělesa (Transformace) a po skrytí tělesa;
  - výběr a hover, skica, manipulátor, náhled editované featury, view cube.
- Doladí `MATERIAL_PRESETS`, `REALISTIC_EXPOSURE`, konstanty stínu a barvy pozadí. Rozdíly propíše do spec.

## Akceptační kritéria

- Menu stylu má režim Realistický. Tělesa v něm mají fyzikální materiál podle své předvolby a barvy, osvětlení z environment mapy a tone mapping. Mřížka je skrytá, pozadí je gradient a pod tělesy je kontaktní stín.
- Hrany se v Realistic nekreslí. Triangulace a AO fungují, Hrany a Průhlednost jsou v menu zašedlé.
- Výběr, hover, skici, manipulátory a náhled mají v Realistic stejné barvy jako ve Stínovaném (tone mapping jen na tělesech).
- Kontaktní stín se přepočítá po změně těles (regenerace, skrytí), ne při pohybu kamery.
- V Prohlížeči jde u tělesa vybrat materiál (plast, hliník, ocel, mosaz, sklo, guma). Volba jde přes operaci s undo, přežije obnovení stránky i export a import. Ve Stínovaném se vzhled nemění.
- Barva tělesa tónuje materiál. Plast bez barvy má barvu palety.
- Sklo je průhledné jen v Realistic a AO pod ním nekreslí skvrny.
- `npm run check`, `npm run build` a `npm run test:e2e` jsou zelené.

## Co se naučíš

- PBR: `metalness`/`roughness`, image-based lighting, PMREM a proč environment mapa potřebuje předfiltrování.
- Tone mapping a lineární barevný prostor: proč render „spálí“ světla bez tone mappingu.
- Jak přidat vlastnost tělesa skrz všechny vrstvy (dokument → operace → prezentační model → render) podruhé a co se od M15 zjednodušilo.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_Návrh, Pavel doplní nebo upraví._

**Co bylo jinak, než se čekalo**

- **Tone mapping jako průchod nešel.** Schválený návrh 1a z [[Q082 Scéna režimu Realistic|Q082]] (průchod na místě, analogie k AO) narazil hned po schválení: tone mapping je nelineární křivka, blending ji nevyjádří a shader nesmí číst target, do kterého píše. Řešení v shaderu materiálů (`onBeforeCompile`) je nakonec jednodušší, protože Realistic bez AO nepotřebuje composer.
- **Kontextové menu tělesa neexistovalo.** Hrubý plán počítal s výběrem materiálu „v kontextovém menu vedle barvy“, barva přitom byla jen pole v řádku. Řešení se hledalo na třikrát:
  - `<select>` vedle barvy, ze jména tělesa zbylo „T…“;
  - ovládání jen u aktivního řádku, u aktivního řádku jméno pořád mizelo;
  - tlačítko 18 px s menu.

  Problém odhalil až snímek z e2e, ne unit testy.
- **Dvě skryté chyby z dřívějška:**
  - Handlery `setVisible` a `setColor` vypisovaly pole metadat ručně a nový `material` by tiše zahodily. Našla je mapa cesty barvy ještě před psaním kontraktu.
  - `RoomEnvironment` má osu Y nahoru, naše scéna Z, takže materiály byly vybledlé. Zjistil to smoke test implementátora.
- **Hranice `render` → `interaction` (jen typy) platí i pro testy.** Shodu výchozího materiálu proto hlídá literální typ a `typeof`, ne test.

**Co se osvědčilo**

- **Mapa cesty existující vlastnosti** (barva z M15) přes všech sedm vrstev před psaním kontraktů. Díky ní byly kontrakty přesné a jedna chyba se našla dřív, než vznikla.
- **Vlny podle modulů:** úkoly 1 a 4, pak 2 a 3, pak 6 a 7 souběžně ve stejném checkoutu. Dočasný lokální typ v `render` umožnil začít bez čekání na celý řetězec `document` → `ops` → `interaction`.
- **Bajtově přesné snímky v e2e** fungují i pro Realistic: PMREM i `transmission` jsou deterministické.
- **Revize architektury** odstranila kopii rozhodovací tabulky AO v `ui` (`displayDrawsAo`) a skryté `any` v `ops`.
