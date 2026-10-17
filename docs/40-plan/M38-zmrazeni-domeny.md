---
type: milestone
status: doing
order: 38
aliases:
  - M38
  - M38 Zmrazení domény a sdílené případy
modules:
  - document
  - ops
  - regen
  - kernel
  - sketch
  - features
specs:
  - "[[13-testovani]]"
  - "[[14-protokol]]"
depends_on:
  - "[[M37-text-ve-skice]]"
started: 2026-10-17
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M38 – Zmrazení domény a sdílené případy

**Cíl:** TS doména se zmrazí a z jejích testů vzniknou sdílené testovací případy (JSON), proti kterým se bude ověřovat C++ jádro.

**Specifikace:** [[13-testovani#Sdílené testovací případy]] (kontrakt), [[14-protokol]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M37-text-ve-skice]]

**Rozhodnutí při startu (2026-10-17):** [[Q107 Výstupy sdílených případů|Q107]] výstupy zaznamenané z TS (`npm run cases:record`), [[Q108 Plochy a hrany ve sdílených případech|Q108]] jména přesně a indexy vůbec, [[Q109 Řešič skici ve sdílených případech|Q109]] řešič podle DOF (pevný bod), [[Q110 Tolerance sdílených případů|Q110]] tolerance a objem ze sítě. „Exportér z dnešních testů“ z hrubého plánu je rekordér: vstupy se vytáhnou z dnešních testů, výstupy zapíše TS doména.

## Úkoly

- [x] Vyhlásit zmrazení: od 2026-10-17 se `document`, `ops`, `regen`, `kernel`, `kernel-occt`, `features/*` a `persistence` mění jen kvůli chybám (pravidlo v [[Roadmapa#Nativní jádro (M38–M47)]]).
- [x] 1. Kostra sdílených případů a `schema.visibleWhen`
- [x] 2. Operace, dokument a schémata
- [x] 3. Regenerace nad OCCT
- [x] 4. 2D geometrie skici
- [x] 5. Řešič skici a odvozené entity
- [x] 6. Metatest pokrytí

Úkol 1 jde první a sám (zafixuje kostru, kterou ostatní sdílejí). **Úkoly 2–5 běží souběžně** (Pavel 2026-10-17): každý jeden subagent `implementer` ve vlastním worktree, každý píše jen svůj spouštěč a svou složku případů, kostru jen čte. Hlavní sezení je slučuje po jednom. Úkol 6 po sloučení všech.

## Akceptační kritéria

- Sdílené případy pokrývají všechny typy operací (s upcastem i chybami), všechny featury (úspěch i chybové statusy), všechny metody `SketchGeometry` (úspěch i chyba), řešič skici (DOF 0, DOF > 0, konflikt, nadbytečná vazba, tažení, každý druh vazby) a odvozené entity. Hlídá to metatest pokrytí (úkol 6), ne revize očima.
- TS sada je proti nim zelená a `npm run check` je spouští (projekt `integration`). Případ, který TS neprojde, `npm run check` shodí.
- `npm run cases:record` po doběhu nezmění žádný soubor (případy odpovídají TS).

## Implementační plán

Jeden úkol = jedno spuštění subagenta `implementer`. Kontrakt: [[13-testovani#Sdílené testovací případy]] (obálka, porovnání, tolerance, tabulka druhů). Pro všechny úkoly:

- **Vstupy** se berou z dnešních testů (pole `source`), výstupy zapíše `npm run cases:record`. Po záznamu implementátor u každého případu porovná zapsaný výstup s tvrzeními původního testu. Když nesedí, je to podezření na chybu TS: hlásí ho jako otázku a výstup ručně nemění.
- Zmrazené moduly se **nemění**. Když spouštěč potřebuje něco, co veřejné API modulu nedává, implementátor to vrátí jako otázku.
- Spouštěče importují jen přes `@/` a veřejné `index.ts` nebo `testing.ts` modulů (výjimka jako v dnešních integračních testech: pluginy přímo z `@/features/<name>`).

### 1. Kostra a `schema.visibleWhen`

- **Soubory:** `test/integration/shared-cases/support/` (`case.ts` – typy obálky a `kind`, načtení všech případů oblasti a kontrola obálky; `compare.ts` – porovnání s tolerancemi a cestou k první odlišnosti, výchozí tolerance; `record.ts` – režim `CASES_RECORD=1`, zápis `expected` beze změny vstupů; `runner.ts` – `describeSharedCases(area, run)`, které pro každý případ vytvoří `it` a podle režimu porovná nebo zapíše; `mesh-volume.ts` – objem ze sítě, převzatý z `test/integration/extrude-scenario.test.ts`), `test/integration/shared-cases/schema.test.ts` (spouštěč `schema.visibleWhen`), `test/shared-cases/schema/*.json`, `package.json` (`cases:record`), `.prettierignore` (`test/shared-cases/` – formát JSON určuje rekordér).
- **Případy:** všech 7 predikátů `visibleWhen` ([[14-protokol#Schéma featur]]: extrude `targets`, `distance`, `upTo`, `flip`; revolve `targets`, `flip`; transform `pivotPoint`), u každého viditelné i skryté, plus chybějící parametr a hodnota jiného typu.
- **Testy:** `support/compare.test.ts` (shoda, odlišný klíč, délka pole, číslo v toleranci a mimo, `volume` relativně, `angle`, cesta v hlášení), `support/case.test.ts` (neznámý `kind` a neznámá vlastnost obálky jsou chyba), záznam do dočasné složky (vstupy beze změny, `expected` přepsané, druhý záznam nic nezmění).
- **Hotovo když:** `npm run cases:record` zapíše případy `schema`, druhý běh nic nezmění, `npm run check` zelený.

### 2. Operace, dokument a schémata (souběžně)

- **Soubory:** `test/integration/shared-cases/ops.test.ts` (`ops.upcast`, `ops.replay`, `ops.script`), `document.test.ts` (`document.load`), `schema-validate.test.ts` (`schema.validate`), `test/shared-cases/ops/`, `document/`, `schema/validate-*.json`.
- **Případy:** `ops.upcast` – každý typ z `OP_VERSION` platný, `feature.setParams` v1 → v2, chyby (neznámý typ, `v` 0, novější `v`, chybějící pole u každého typu, `batch`); `ops.replay` – každý typ aspoň jednou, záznamy `undo` a `redo`; `ops.script` – 50 × `setParams` v transakci = 1 záznam, `abort`, `applyTransient` mimo log, `commit` prázdné transakce, undo a redo po dispatchi i po transakci; `document.load` – migrace každé featury se schématem `version` > 1 ze všech starších verzí, neplatný dokument (`issues` s cestou); `schema.validate` – výchozí parametry každé featury (u featur s referencemi s chybou `param.tooFewRefs` i s vybranými referencemi bez chyb) a každý kód `ParamIssue`, který vestavěná schémata umí vyvolat (ne `param.notInteger`, `param.belowMin`, `param.atOrAboveMax`).
- **Zdroje:** `test/unit/ops/*`, `test/unit/document/serialize.test.ts`, `validate.test.ts`, `test/unit/features/*/schema*.test.ts`.
- **Hotovo když:** případy zapsané a ověřené proti zdrojům, `npm run check` zelený.

### 3. Regenerace nad OCCT (souběžně)

- **Soubory:** `test/integration/shared-cases/regen.test.ts`, `test/shared-cases/regen/`.
- **Případy:** každá z 9 vestavěných featur v úspěšném dokumentu; statusy `INVALID_PARAMS` (i příliš velké zaoblení: `fillet.failed`), `UNRESOLVED_REFERENCE`, `KERNEL` (průnik oddělených těles), `UNKNOWN_TYPE`, `warning`, `suppressed`, `rolledBack` (`STALE_VERSION` z dokumentu nevznikne, viz spec 13); `inputOf`; vysunutí `upToFace`, rotace, boolean všech tří druhů, zaoblení a sražení (jména ploch po úpravě), skica se splajnem, s textem a s polem (oblasti).
- **Zdroje:** `test/integration/*-scenario.test.ts`, `topo-scenarios.test.ts`, `sketch-*.test.ts`, `test/unit/regen/regenerator*.test.ts` (scénáře, ne `FakeKernel`).
- **Hotovo když:** případy zapsané a ověřené proti zdrojům, `npm run check` zelený.

### 4. 2D geometrie skici (souběžně)

- **Soubory:** `test/integration/shared-cases/geometry.test.ts`, `test/shared-cases/geometry/`.
- **Případy:** sekce kontraktové sady v `src/kernel/testing.ts` pro `curveIntersections`, `curveSegment`, `filletArc`, `offsetCurves` (intersections, pieces, centers, no solution, closed a open chains) a jejich sekce `input (spec 06 …)` jako chybové případy s `KernelErrorCode`. Každá metoda úspěch i chyba, každý druh `Curve2` aspoň jednou.
- **Hotovo když:** případy zapsané a ověřené proti zdrojům, `npm run check` zelený.

### 5. Řešič skici a odvozené entity (souběžně)

- **Soubory:** `test/integration/shared-cases/sketch.test.ts` (`sketch.solve` s `createInThreadPlanegcsSolver`, `sketch.derived`), `test/shared-cases/sketch/`.
- **Případy:** `sketch.solve` – plně určený obdélník (DOF 0), nedourčená skica (pevný bod), konflikt, nadbytečná vazba, tažení bodu, každý druh vazby aspoň v jednom případu; `sketch.derived` – zrcadlení, lineární a kruhové pole, text, konstrukční entity mimo `regionCurves`.
- **Zdroje:** `test/unit/solver-planegcs/solve*.test.ts`, `test/unit/sketch/patterns.test.ts`, `text.test.ts`, `geometry.test.ts`.
- **Hotovo když:** případy zapsané a ověřené proti zdrojům, `npm run check` zelený.

### 6. Metatest pokrytí (po sloučení 2–5)

- **Soubory:** `test/integration/shared-cases/coverage.test.ts`.
- **Kontroly:** každý typ z `OP_VERSION` v `ops.upcast` i `ops.replay`; každá featura z vestavěných pluginů v `regen` s `ok` a v `schema.validate`; každý kód `ParamIssue` v `schema.validate` kromě tří nedosažitelných (spec 13); každý kód `FeatureError` kromě `STALE_VERSION` v `regen`; každá metoda `geometry.*` s `ok` i `error`; `sketch.solve` s `dof` 0, `dof` > 0, `conflict` a každým druhem vazby; každý predikát `visibleWhen`. Každá kontrola má vlastní úmyslnou chybu, která ji shodí (smazaný případ).
- **Hotovo když:** `npm run check` zelený, `npm run cases:record` nic nezmění; revize `architecture-reviewer`.

## Co se naučíš

Jak z existující sady testů udělat jazykově nezávislou specifikaci (golden tests) a jak volit tolerance u geometrie.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Průběh

- **Úkol 1:** kostra (`describeSharedCases` s `run` a `verify`, porovnání s tolerancí, `scripts/cases-record.mjs`). 27 případů `schema.visibleWhen`. První nález: predikáty `equals_none` ukazovaly hodnotu jiného typu, Pavel rozhodl opravit v TS jako chybu (extrude, revolve, regresní unit testy).
- **Úkoly 2–5 souběžně** (čtyři subagenti `implementer` ve vlastních worktree, sloučené po jednom kopírováním souborů, žádný konflikt): operace, dokument a schémata 241 případů, regenerace 39, geometrie 86, řešič a odvozené entity 112. Žádný zaznamenaný výstup neodporoval zdrojovému testu.
- Upřesnění ze souběžných úkolů (propsáno do [[13-testovani#Sdílené testovací případy]]): `KERNEL` dává průnik oddělených těles, ne příliš velké zaoblení (to je `INVALID_PARAMS`); `STALE_VERSION` z dokumentu nevznikne; tři kódy `ParamIssue` žádné vestavěné schéma nevyvolá; `input` pro `inputOf` (i `null`); `NaN`, ±∞ a vstupy špatného tvaru do případů nepatří; pevný bod řešiče bez `drag`.
- **Úkol 6:** metatest pokrytí, 16 kontrol odvozených z kódu (kontrola úplnosti v době překladu přes `satisfies Record<…>`), každá ověřená úmyslným odebráním případu. Seznam pluginů v `support/plugins.ts`.
- **Revize architektury:** nic závažného. Opravené nálezy: determinismus pořadí pro C++ (smyčky obrysů, issues bez spoléhání na stabilní řazení, issues `document.load` podle cesty, zaokrouhlení pro řazení), silnější `sketch.solve` při `dof` > 0 (struktura entit a tažený bod, upřesnění [[Q109 Řešič skici ve sdílených případech|Q109]] k potvrzení), zákaz `NaN` ve výstupu, chybějící případy `visibleWhen`, parita seznamu pluginů s `app`.
- Stav: 508 případů, `npm run check` zelený (8170 unit, 635 integračních), druhý `npm run cases:record` nic nezmění.

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
