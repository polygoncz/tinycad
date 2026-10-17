---
type: spec
status: accepted
order: 13
aliases:
  - Testovací strategie
  - Spec 13
modules: []
milestones:
  - "[[M15-export-a-dokonceni]]"
  - "[[M38-zmrazeni-domeny]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-17
---
# 13 – Testovací strategie

> **Pojmy:** [[Port a adaptér]], [[Determinismus operací]], [[Mark and sweep]]

Testy jsou součástí návrhu, ne dodatek. Architektura je postavená tak, aby se většina logiky dala testovat **bez prohlížeče a bez OCCT**.

## Úrovně

| Úroveň | Co | Nástroj | Kdy běží |
|---|---|---|---|
| Unit | `core`, `document`, `ops`, `regen` (s `FakeKernel`), `persistence` (s `MemoryDocumentStore` a `fake-indexeddb`), `interaction`, čisté funkce z `render` | Vitest (Node) | vždy, `npm test` |
| Kontraktové | stejná sada testů pro všechny implementace portu (`FakeKernel` × `OcctKernelImpl`, `MemoryDocumentStore` × `IdbDocumentStore`) | Vitest | vždy (OCCT verze v integrační sadě) |
| Integrační | `kernel-occt` s reálným WASM v Node | Vitest, projekt `integration` | `npm run test:integration`, od M19.1 i součást `npm run check` (1,7 s) |
| Property-based | replay logu, undo/redo, regenerace bez úniků handle | fast-check | vždy |
| E2E smoke | otevřít aplikaci, vytvořit kvádr, změnit parametr, undo, reload | Playwright, Chrome (`channel: 'chrome'`) a WebKit (Safari) | od M10. Od 2026-10-17: během práce na milníku jen jeho spec v Chrome (`npm run test:e2e -- m37`), celá sada v Chrome `npm run test:e2e`, v Chrome i WebKitu `npm run test:e2e:full` jen při uzavření milníku a slučování stopy. Soubory běží souběžně ve 4 workerech (`E2E_WORKERS` přepíše), testy v jednom souboru po sobě. Test padá na chybě v konzoli nebo nezachycené výjimce na kterékoli stránce kontextu (fixture `e2e/fixtures.ts`). Známé chyby jen v seznamu `IGNORED_CONSOLE_ERRORS` s důvodem a úzkým vzorem. Stažené soubory (M15) přes `page.waitForEvent('download')`, nahrání přes `setInputFiles`. |
| Měření výkonu | regenerace a tessellace většího modelu s OCCT v Node, [[#Měření výkonu]] | Vitest, projekt `integration` (`tests/perf.test.ts`) | od M15, `npm run test:integration` |

`npm run check` pouští své kroky (typecheck, lint, lint:deps, lint:vault, unit, integrační) **souběžně** přes `run-p` z `npm-run-all2`, výstupy po skončení kroku (`--aggregate-output`) a dokončí všechny i po chybě (`--continue-on-error`). Typecheck je inkrementální (`incremental` v `tsconfig.base.json`), Prettier s cache. ESLint cache nemá: typově informovaná pravidla (`no-floating-promises`…) závisí na typech z jiných souborů a cache by nezměněný soubor znovu nezkontrolovala. Od 2026-10-17: ~36 s místo ~58 s.

## Klíčové invarianty (property-based)

1. **Replay:** pro libovolnou sekvenci operací a undo/redo: přehrání logu od prázdného dokumentu = živý dokument.
2. **Inverze:** pro každou operaci `apply(op)` a pak `apply(inverse)` = původní dokument.
3. **Snapshot:** snapshot k `seq` + zbytek logu = přehrání celého logu.
4. **Cache regenerace:** výsledek regenerace s cache = výsledek regenerace od nuly (porovnání stavů z `FakeKernel`).
5. **Úniky:** po libovolné sekvenci změn a regenerací je počet živých handle v jádru roven počtu handle ve stavech cache.

## Měření výkonu

Od [[M15-export-a-dokonceni|M15]] ([[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R130]]). Test **měří a vypisuje, ale na čase nikdy nepadá**: časy závisí na stroji a zatížení, test s časovým limitem by byl buď křehký, nebo tak volný, že nic neprokazuje ([[Měření, které nemůže selhat]]).

- Model: deska s 36 otvory (Boolean „odebrat“) a 4 zaoblenými hranami, ~40 featur, `createInThreadOcctKernel()`.
- Měří první regeneraci od nuly, tessellaci výsledku, plný přepočet (změna první featury) a přepočet od poslední featury (cache); každé 3×, vypíše medián a počty volání jádra (`console.table`).
- Ověřuje jen deterministické veličiny: žádná chyba featury, počet těles a ploch, **počty volání jádra** při přepočtu z cache (jádro obalené počítadlem přes `Proxy`) a `liveHandleCount` = živé handle stavu. **Každá** kontrola měření potřebuje vlastní úmyslnou chybu, která ji shodí (cache vypnutá → padne kontrola počtu volání; vynechaný `release` → padne kontrola `liveHandleCount`; …) – jedna chyba pro celý test dokazuje jen tu jednu kontrolu.
- Hrany k zaoblení hledá test **z topologie** tělesa (`names.topology`: hrana mezi dvěma rovinnými plochami s různými normálami kolmými na Z), ne rozebíráním jmen – formát jmen zná jen `regen` ([[0018-format-topologickych-jmen|ADR 0018]], oprava revize M15).
- Čísla se zapisují do vaultu ([[Q007 Cache geometrie|Q007]]), ne do testu. Naměřeno v M15: první regenerace ~103 ms, tessellace ~34 ms, plný přepočet ~101 ms, změna posledního válce ~91 ms.

## Sdílené testovací případy

Od [[M38-zmrazeni-domeny|M38]]. [[Sdílený testovací případ|Sdílené případy]] jsou specifikace C++ jádra `tinycad-core` ([[0030-nativni-jadro-pres-grpc|ADR 0030]]): chování zmrazené TS domény zapsané jako data, která musí projít TS i C++ sada. Rozhodnutí: [[Q107 Výstupy sdílených případů|Q107]] (zaznamenané výstupy), [[Q108 Plochy a hrany ve sdílených případech|Q108]] (jména, ne indexy), [[Q109 Řešič skici ve sdílených případech|Q109]] (řešič podle DOF), [[Q110 Tolerance sdílených případů|Q110]] (tolerance).

### Soubory a běh

- Případy: `test/shared-cases/<oblast>/<name>.json`, oblasti `ops`, `document`, `schema`, `regen`, `geometry`, `sketch`. Jeden soubor = jeden případ, `name` = název souboru bez `.json` (kebab-case, anglicky).
- TS spouštěče: `test/integration/shared-cases/<oblast>.test.ts` (projekt `integration`, takže je spouští `npm run check`). Společná kostra: `test/integration/shared-cases/support/` – načtení a kontrola obálky, porovnání s tolerancí, režim záznamu, objem ze sítě.
- **Režim záznamu** ([[Q107 Výstupy sdílených případů|Q107]]): `npm run cases:record` spustí tytéž spouštěče s `CASES_RECORD=1`. Spouštěč pak `expected` nepřečte, ale přepíše výsledkem TS (JSON s odsazením 2 mezerami, klíče v pořadí, jak je vytvoří spouštěč, nový řádek na konci). Vstupy (`kind`, `description`, `source`, `input`, `tolerance`) nikdy nemění. Případ může před prvním záznamem `expected` vynechat, záznam ho vloží za `input`. Formát souboru určuje rekordér (`test/shared-cases/` je v `.prettierignore`), skript je `scripts/cases-record.mjs` (proměnná v `package.json` by v cmd.exe nefungovala). Bez proměnné spouštěč porovnává a případ, který neprojde, shodí `npm run check`.
- Determinismus: id ze `createSequentialIdGenerator`, hodiny dokumentu a regenerace `() => 0`, čas záznamu logu je pořadí kroku (1, 2, 3…).

### Obálka

```json
{
  "kind": "geometry.fillet",
  "description": "Fillet of two perpendicular lines, the centre nearest to near",
  "source": "src/kernel/testing.ts › centers (spec 06 Stav po M34)",
  "input": { "a": { "kind": "line", "from": [0, 0], "to": [10, 0] }, "b": { "…": "…" }, "radius": 2, "near": [1, 1] },
  "expected": { "ok": { "center": [2, 2], "…": "…" } },
  "tolerance": { "length": 1e-6 }
}
```

| Vlastnost | Povinná | Význam |
|---|---|---|
| `kind` | ano | druh případu (tabulka níže), vybírá spouštěč |
| `description` | ano | jedna věta anglicky, co případ ověřuje |
| `source` | ne | dnešní test, ze kterého případ vznikl (`soubor › describe › it`) |
| `input` | ano | vstup podle druhu |
| `expected` | ano | `{ "ok": <výstup> }`, nebo `{ "error": { "code"?, "path"?, "issues"? } }`; píše ho záznam |
| `tolerance` | ne | přepis výchozích tolerancí `{ length?, angle?, relative? }` |

- Chyba se porovnává jen kódem a cestou (`issues` = seznam `{ path, code? }`), **nikdy textem zprávy**: texty se v C++ liší.
- Neznámá vlastnost obálky nebo neznámý `kind` je chyba načtení, ne přeskočení.

### Porovnání a tolerance

Výchozí tolerance ([[Q110 Tolerance sdílených případů|Q110]]): `length` 1e-6 (absolutně), `angle` 1e-9 (absolutně), `relative` 1e-6.

- Objekty: stejná množina klíčů, hodnoty rekurzivně. Pole: stejná délka, prvky v pořadí. Řetězce a `boolean` přesně, `null` jen s `null`.
- Čísla: absolutně s `length`. Výjimky podle názvu klíče: `volume` relativně s `relative`, klíč `angle` (jediný úhlový klíč v datech domény, parametry featur i entity skici) absolutně s `angle`. Parametry křivek `ta`, `tb`, `from`, `to` se porovnávají s `length`. Celá čísla (počty, `seq`, `dof`) tím vycházejí přesně.
- Tolerance se řídí nejbližším klíčem; prvek pole přebírá klíč pole. `volume` platí, když |a − e| ≤ `relative` · |e| (očekávaná 0 tedy přesně).
- Pořadí, které doména neurčuje, srovná spouštěč **před** zápisem i porovnáním (pravidlo je u druhu). Ve výstupu tak nikdy není pořadí, na kterém nezáleží.
- Selhání vypíše cestu k první odlišné hodnotě (`expected.ok.bodies[0].volume: 1000 ≠ 999.2`).

### Druhy případů

| `kind` | `input` | `expected.ok` | Chyby |
|---|---|---|---|
| `ops.upcast` | `{ operation }` – surová operace, i starší `v` | `{ operation }` po `upcastOperation` (aktuální `v`) | `{ path }` z `OperationLoadError`; pokrývá i `validate` handleru |
| `ops.replay` | `{ document: DocumentData, entries: LogEntry[] }` | `{ document: DocumentData }` po `parseLogEntry` a `replayLog` | – (jen platné záznamy) |
| `ops.script` | `{ document: DocumentData, steps: Step[] }`, `Step` = `{ dispatch, label? }` \| `{ begin }` \| `{ apply }` \| `{ applyTransient }` \| `{ commit: true }` \| `{ abort: true }` \| `{ undo: true }` \| `{ redo: true }` | `{ document, log: LogEntry[], canUndo, canRedo }` po posledním kroku | – (jen platné skripty; chybové kódy RPC ověří [[M45-sezeni-pres-grpc\|M45]]) |
| `document.load` | `{ data }` – surový `DocumentData`, i se staršími verzemi featur | `{ data: DocumentData }` = `toData(fromData(data))` (migrace featur) | `{ issues: [{ path }] }` z `DocumentLoadError` |
| `schema.validate` | `{ type, params }` | `{ issues: ParamIssue[] }` ze `schema.validate`, seřazené podle `param`, `code` | – |
| `schema.visibleWhen` | `{ type, param, params }` | `{ visible }` z `isParamVisible` | – |
| `regen` | `{ document: DocumentData, inputOf? }` | `{ statuses, bodies, sketches, anchors }` (níže) | – (chyby featur jsou ve `statuses`) |
| `geometry.intersections` | `{ curves }` | `{ hits: CurveHit[] }` | `{ code }` = `KernelErrorCode` |
| `geometry.segment` | `{ curve, from, to }` | `{ curve }` | `{ code }` |
| `geometry.fillet` | `{ a, b, radius, near }` | `FilletArc` | `{ code }` |
| `geometry.offset` | `{ chain, closed, distance }` | `{ curves: OffsetCurve2[] }` | `{ code }` |
| `sketch.solve` | `SolveInput` (`entities`, `constraints`, `drag?`) | `{ status, dof, conflicting, redundant, entities }` | – |
| `sketch.derived` | `SketchData` | `{ copies, textCurves, regionCurves }` z `patternCopies`, `textCurves`, `regionCurves` | – |

Druhy `geometry.*` volají metody portu `GeometryKernel` (`curveIntersections`, `curveSegment`, `filletArc`, `offsetCurves`), které adaptér `SketchGeometry` jen předává; na serveru odpovídají `GeometryService` ([[14-protokol#GeometryService]]).

**`regen`** – registry ze všech vestavěných pluginů featur, jádro `createInThreadOcctKernel()`, jedna regenerace od nuly:

- `statuses`: `{ [featureId]: { kind } }`, u `error` navíc `code` a `issues` (bez `message`), u `warning` jen `kind`.
- `bodies`: seřazené podle `id`, každé `{ id, origin, lastModifiedBy, volume, bbox: { min, max }, faces, edges, vertexCount }`.
  - `volume` z jemné sítě (`linearDeflection` 0,01, `angularDeflection` 0,05) a případ má `tolerance.relative` 1e-3 ([[Q110 Tolerance sdílených případů|Q110]]).
  - `faces`: `{ names, surface, plane? }` – všechna jména plochy (`namesOfFace`, seřazená), typ plochy a u roviny `{ normal, offset }`. `edges`: `{ names, midpoint }`. Obojí seřazené podle jmen, pak podpisu. **Indexy podtvarů se nezapisují** ([[Q108 Plochy a hrany ve sdílených případech|Q108]]).
- `sketches`: `{ id, owner, regions: string[] (seřazená id oblastí), outlines }`.
- `anchors`: `{ [featureId]: FeatureAnchors }`.

**`sketch.solve`** ([[Q109 Řešič skici ve sdílených případech|Q109]]): `status`, `dof`, `conflicting` a `redundant` se porovnávají vždy (seznamy seřazené). `entities` jen při `dof` 0. Při `dof` > 0 spouštěč ověří **pevný bod**: vyřešené entity pošle řešiči znovu, výsledek se od nich nesmí lišit o víc než `length` a `dof` musí zůstat stejný. Zaznamenané `entities` jsou jen pro čtení.

## Konvence

- Testy leží mimo `src/` se zrcadlovou strukturou ([[0023-testy-mimo-zdrojaky|ADR 0023]]): `src/<modul>/foo.ts` → `test/unit/<modul>/foo.test.ts`, importy přes `@/`. Integrační testy v `test/integration/`, e2e v `test/e2e/`.
- Testovací data (featury, dokumenty) přes malé buildery: `aBox({ height: 20 })`, `aDocument().with(aBox()).build()`.
- ID v testech ze `SequentialIdGenerator` → čitelné snapshoty.
- Žádné mockovací frameworky pro porty – vlastní fake implementace (`FakeKernel`, `MemoryDocumentStore`), které jsou samy ověřené kontraktovými testy.

## Pokrytí

Neřešíme procenta. Pravidlo: každé veřejné API modulu má test a každá opravená chyba dostane regresní test.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
