---
type: milestone
status: done
order: 6
aliases:
  - M6
  - M6 Regenerace a první plugin (Box)
modules:
  - regen
  - plugin-api
  - features
specs:
  - "[[07-regenerace]]"
  - "[[11-ui]]"
depends_on:
  - "[[M03-operace]]"
  - "[[M05-kernel-port]]"
started: 2026-10-13
finished: 2026-10-13
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-12
---
# M6 – Regenerace a první plugin (Box)

**Cíl:** přehrání featur přes jádro s cache, rollback barem, chybovými stavy a správou handle. První plugin featury – kvádr. Celé testované s `FakeKernel`.

**Specifikace:** [[07-regenerace|07 – regenerace]], [[11-ui#Plugin featury (plugin-api)|11 – plugin-api]], [[0006-nemenna-data|ADR 0006]]

**Navazuje na:** [[M03-operace]], [[M05-kernel-port]]

## Úkoly

- [x] `Body`, `RegenState`, `EMPTY_STATE`, `FeatureStatus`, `FeatureError`.
- [x] `FeatureBuilder`, `BuildInput`, `BuildContext` (zatím jen `kernel`, `resolveBodies`, `warn`), `BuilderRegistry`.
- [x] `Regenerator.run`: validace přes schéma, cache podle identity, rollback, suppressed, chybná featura propouští stav, neznámý typ.
- [x] Generace a `'superseded'`.
- [x] Mark & sweep uvolňování handle.
- [x] Události `started`, `featureDone`, `finished`.
- [x] `plugin-api`: `FeaturePlugin` **bez** `tools` (pole `tools` se přidá v M9, až bude existovat `interaction` – do té doby `plugin-api` závisí jen na `document` a `regen`).
- [x] `features/box`: `BoxParams` (`origin`, `width`, `depth`, `height`), schéma (min > 0), builder, testy.
- [x] Test „každý registrovaný typ má schéma i builder“ (pomocná funkce `registerPlugin` do testovacích registrů).

## Akceptační kritéria

- Testy ze sekce Testy ve spec 07 projdou (počty volání builderu, rollback, chyby, souběh, úniky).
- Property-based: regenerace s cache = regenerace od nuly; po sekvenci změn žádné úniky handle.
- `regen` neimportuje `ops`.

## Implementační plán

Každý úkol dělá zvlášť subagent `implementer` (TDD: test nejdřív a ověřit, že padá; `npm run check`). Kontrakt je v [[07-regenerace|spec 07]] a [[11-ui#Plugin featury (plugin-api)|spec 11]], úkoly odkazují sekcemi. Rozhodnutí: [[Q040 Selhání release při úklidu handle|Q040]]–[[Q047 Registrace pluginu a úplnost registrů|Q047]]. Veřejné API jen přes `index.ts` modulu, testovací pomůcky přes `testing.ts`. Testy používají `createFakeKernel` z `kernel/testing.ts` a buildery dokumentu z `document/testing.ts`.

### Ú1 Typy stavu a builderu
- **Soubory:** `src/regen/state.ts` (`Body`, `RegenState`, `EMPTY_STATE`, `FeatureStatus`, `FeatureError`), `src/regen/builder.ts` (`FeatureBuilder`, `BuildInput`, `BuildContext`, `BuildOutput`, `RefError`, `BuilderRegistry`, `createBuilderRegistry`), `src/regen/index.ts`, `index.test.ts` (seznam runtime exportů).
- **Kontrakt:** [[07-regenerace#Princip]], [[07-regenerace#Builder featury]], [[07-regenerace#Stav featury]]. `NameTable` zatím jako prázdný typ s konstantou `EMPTY_NAMES` (naplní M14). `EMPTY_STATE` zmražený, `bodies` prázdná mapa. Klíč registru = `type`.
- **Testy:** registr (duplicitní typ hází, `find` neznámého = `undefined`), `EMPTY_STATE` je prázdný a zmražený.
- **Hotovo když:** testy a `npm run check` projdou, `regen` importuje jen `core`, `document`, `kernel`.

### Ú2 Sledované jádro a `BuildContext`
- **Soubory:** `src/regen/tracking-kernel.ts` (interní), `src/regen/build-context.ts` (interní), testy k oběma.
- **Kontrakt:** [[07-regenerace#Builder featury]] (pravidla), [[Q041 Úklid mezivýsledků builderu|Q041]], [[Q044 RefError a nevyřešené reference|Q044]], [[Q045 Více varování jedné featury|Q045]]. Sledované jádro deleguje na skutečné a každý `ShapeResult.shape` přidá do předané množiny vlastněných handle (i když builder pak selže). `release` na sledovaném jádře odmítne (builder nesmí uvolňovat – chyba programu, `assert`). `resolveBodies` hledá v `input.state.bodies`, první chybějící → `err({ ref, message })`. `warn` sbírá zprávy.
- **Testy:** `makeBox` přes sledované jádro → handle v množině; `release` odmítne; `resolveBodies` ok i err; dvě `warn` → spojené `'\n'`.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú3 `Regenerator.run` bez souběhu a úklidu
- **Soubory:** `src/regen/regenerator.ts` (skrytá implementace, ven `createRegenerator`), `regenerator.test.ts`, případně `src/regen/testing.ts` (např. builder se špiónem `aCountingBuilder`).
- **Kontrakt:** [[07-regenerace#Stav featury]] (pořadí určení statusu), [[07-regenerace#Regenerator]], [[07-regenerace#Cache podle identity]], [[Q042 Obsah cache regenerace|Q042]], [[Q043 Výjimka builderu mimo jádro|Q043]], [[Q046 Hodiny pro durationMs|Q046]]. `finalState` = stav na rollback baru.
- **Testy:** z [[07-regenerace#Testy (s `FakeKernel`)]] vše kromě souběhu, událostí, `release` a property testů.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú4 Generace a události
- **Soubory:** `regenerator.ts`, testy.
- **Kontrakt:** [[07-regenerace#Souběh (generace)]], události v [[07-regenerace#Regenerator]]. Kontrola generace po každém `await`, cache zapisuje jen aktuální generace.
- **Testy:** dvě rychlé `run` → první `'superseded'`, cache odpovídá druhé; pořadí událostí; `finished` jen pro dokončenou generaci.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú5 Mark & sweep
- **Soubory:** `regenerator.ts` (případně `sweep.ts`), testy, `regenerator.property.test.ts`.
- **Kontrakt:** [[07-regenerace#Životnost handle: mark & sweep]], [[Q040 Selhání release při úklidu handle|Q040]]. Jedno volání `release` na sweep.
- **Testy:** žádné úniky po změnách, po superseded, po chybě builderu s mezivýsledkem, po výjimce mimo jádro; tři větve selhání `release` (`failNext('release', …)`; `disconnected` jako `RpcError`); property-based (fast-check): cache = od nuly, žádné úniky po náhodné sekvenci změn.
- **Hotovo když:** testy a `npm run check` projdou.

### Ú6 `plugin-api`
- **Soubory:** `src/plugin-api/plugin.ts`, `src/plugin-api/register.ts`, `index.ts`, testy.
- **Kontrakt:** [[11-ui#Plugin featury (plugin-api)]] – `FeaturePlugin` jen se `schema` a `builder`, `registerPlugin`.
- **Testy:** registrace do obou registrů; nesouhlasné typy → výjimka a nic se nezaregistruje; duplicita v kterémkoli registru → výjimka a nic se nezaregistruje.
- **Hotovo když:** testy a `npm run check` projdou, `plugin-api` importuje jen `core`, `document`, `regen`.

### Ú7 `features/box`
- **Soubory:** `src/features/box/schema.ts` (`BoxParams`, `boxSchema` verze 1: `origin` point, `width`/`depth`/`height` length s `min` > 0), `builder.ts` (`boxBuilder`), `index.ts` (`boxPlugin`), `box.test.ts`.
- **Kontrakt:** příklad builderu v [[07-regenerace#Builder featury]], [[11-ui#Plugin featury (plugin-api)]]. `BodyId` = `<featureId>/body`.
- **Testy:** defaults projdou validací; nulový nebo záporný rozměr → problém; builder s `FakeKernel` → jedno těleso, bounding box odpovídá; integrace: `registerPlugin(boxPlugin)` + `createRegenerator` nad dokumentem se dvěma kvádry.
- **Hotovo když:** testy a `npm run check` projdou.

## Co se naučíš

Asynchronní řízení souběhu (generace), cache nad neměnnými daty, ruční správa zdrojů mimo GC.

## Retrospektiva

> _Návrh od Clauda, Pavel ho chtěl doplnit rovnou._

**Co bylo jinak, než se čekalo**
- Spec 07 vypadala hotová, ale na úroveň kontraktu jí chybělo hodně: kdo uklízí mezivýsledky builderu ([[Q041 Úklid mezivýsledků builderu|Q041]]), co přesně drží cache ([[Q042 Obsah cache regenerace|Q042]]), co je chyba featury a co chyba programu ([[Q043 Výjimka builderu mimo jádro|Q043]]). Osm otázek padlo hned při startu, další dvě ([[Q048 Neměnnost mapy těles za běhu|Q048]], [[Q049 Pád jádra během regenerace|Q049]]) přinesli implementátoři.
- Nejvíc práce nebyla cache ani rollback, ale **selhání**: `release` odmítne, worker spadne uprostřed buildu, posluchač vyhodí, novější generace začne během úklidu. Každá kombinace potřebovala pravidlo ve spec a test. Spec 06 a 07 si přitom v jednom bodě odporovaly (Q049).
- Revize architektury posunula dvě runtime kontroly do typů: builder dostane jen `ModelingKernel` (nemůže zavolat `release`) a hodiny jsou povinná závislost (doména nesahá na `globalThis`). Obojí jsme původně řešili „slušně za běhu“.
- Bivariance metod v TS vyřešila generika pluginů sama – `FeaturePlugin<BoxParams>` jde předat jako `FeaturePlugin` bez přetypování (viz [[Bivariance metod v TypeScriptu]]).

**Co se osvědčilo**
- Rozdělení na 7 úkolů po vrstvách (typy → kontext → `run` → generace → sweep → plugin-api → box). Každá vrstva se testovala nad deterministickým základem a chyba v generacích se nepletla s chybou v cache.
- Property test proti **modelu** (cache = od nuly, živé handle = model), ne proti vnitřnímu stavu. Že kouše, se ověřilo vypnutím sweepu.
- Implementátor vracel díry ve spec jako otázky místo tichých rozhodnutí; většina skončila jako upřesňující odstavec ve spec 07 v témže kroku.
- `FakeKernel` s `failNext` a `callCount` z M5 – bez něj by větve selhání `release` a pádu jádra nešly testovat.

**Co příště jinak**
- Při psaní spec projít **chybové cesty** stejně důkladně jako šťastnou: pro každé `await` se zeptat „co když odmítne“ a „co když mezitím začne jiný běh“.
- Revizi architektury spustit už po polovině úkolů (po `run`), ne až na konci – nálezy jako `ModelingKernel` by pak nemusely přepisovat hotové testy.
