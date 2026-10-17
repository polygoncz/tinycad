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
  - "[[M47-uklid-a-dokonceni]]"
  - "[[M49-pravidla-validace-v-popisu]]"
  - "[[M51-inverze-a-mereni]]"
  - "[[M52-tenky-klient]]"
tags:
  - spec
created: 2026-10-12
updated: 2026-10-18
---
# 13 – Testovací strategie

> **Pojmy:** [[Port a adaptér]], [[Determinismus operací]], [[Mark and sweep]]

Testy jsou součástí návrhu, ne dodatek. Architektura je postavená tak, aby se většina logiky klienta dala testovat **bez prohlížeče a bez serveru** (falešné jádro `createFakeCore` z `remote/testing.ts`) a doména na serveru **bez sítě** (knihovny C++ s GoogleTest nad skutečným nativním OCCT). Od [[M47-uklid-a-dokonceni|M47]] je referenční implementací domény C++ ([[Rozhodnutí nativního jádra|N124]]).

## Úrovně

| Úroveň | Co | Nástroj | Kdy běží |
|---|---|---|---|
| Unit (klient) | `core`, `document`, `ops` (handlery, `applyOperation`, testovací dvojník portů), `sketch`, `solver-planegcs`, `text-opentype`, `interaction`, `sketcher`, `features/*` (nástroje, manipulátory, pomůcky z `params.ts`), `remote` a `app` nad falešným jádrem `createFakeCore`, čisté funkce z `render`, `ui` | Vitest (Node) | vždy, `npm test` |
| Unit (server) | každá knihovna `server/src/<oblast>` má `server/test/<oblast>/` (spustitelné `tinycad_<oblast>_tests`), [[Rozhodnutí nativního jádra\|N25]] | GoogleTest v Dockeru | `npm run check:server` |
| Kontraktové | jedna sada pro každou implementaci portu: jádro (port `describeGeometryKernelContract` v `server/test/kernel/`, nad `OcctKernel`, [[Rozhodnutí nativního jádra\|N26]]), úložiště (`server/test/storage/` nad skutečnými soubory SQLite, [[05-persistence#Testy]]) | GoogleTest | `npm run check:server` |
| Integrační | TS běžce sdílených případů `sketch` a `schema` (od M49; `ops` do M52) s metatestem pokrytí (`test/integration/shared-cases/`) a `remote-feature-types` (schémata ze zlatého souboru); na serveru běžce všech sdílených případů (`server/test/shared-cases/`) a gRPC harness (`server/test/session/grpc_*`, `TestServer`) | Vitest, projekt `integration`; GoogleTest | `npm run test:integration` (součást `npm run check`), `npm run check:server` |
| Property-based | replay logu a undo/redo (`server/test/ops/replay_property_test.cpp`, 200 semínek, [[Rozhodnutí nativního jádra\|N28, N82]]), regenerace bez úniků handle (`server/test/regen/regenerator_property_test.cpp`, [[Rozhodnutí nativního jádra\|N112]]) | vlastní generátor se semínkem (C++) | `npm run check:server` |
| E2E | otevřít aplikaci, vytvořit kvádr, změnit parametr, undo, reload; od M46 proti serveru v Docker Compose (níže) | Playwright, Chrome (`channel: 'chrome'`) a WebKit (Safari) | od M10. Od 2026-10-17: během práce na milníku jen jeho spec v Chrome (`npm run test:e2e -- m37`), celá sada v Chrome `npm run test:e2e` (projekty `chrome` a `restart`), v Chrome i WebKitu `npm run test:e2e:full` jen při uzavření milníku a slučování stopy. Od M48 specy `*.restart.spec.ts`, které restartují sdílené jádro, běží jen v sériovém projektu `restart` (Chrome, `dependencies: ['chrome']`, projekty `chrome` a `webkit` je ignorují; `webkit` má `dependencies: ['restart']`, aby restart nikdy neběžel souběžně s jinými testy ani v plném běhu, [[Rozhodnutí nativního jádra|N152]]). Soubory běží souběžně ve 4 workerech (`E2E_WORKERS` přepíše), testy v jednom souboru po sobě. Test padá na chybě v konzoli nebo nezachycené výjimce na kterékoli stránce kontextu (fixture `e2e/fixtures.ts`). Známé chyby jen v seznamu `IGNORED_CONSOLE_ERRORS` s důvodem a úzkým vzorem; chybu, kterou test vyvolá záměrně (např. hlášení prohlížeče o selhaných požadavcích, když test drží síť offline), povolí volba `allowedConsoleError` (`test.use` v souboru, úzký vzor). Oba vzory se od [[M52-tenky-klient|M52]] porovnávají s textem zprávy **včetně URL**: `<text> (<url>)`, když zpráva URL má, protože hlášení prohlížeče o selhaném požadavku jmenuje požadavek jen tam. Nezachycené odmítnutí slibu (chyba programu, která není `RemoteError`, N176) se ukáže jako chyba stránky a test shodí. Stažené soubory (M15) přes `page.waitForEvent('download')`, nahrání přes `setInputFiles`. |
| Měření | velikost bundlu a čas startu, [[#Měření výkonu]] | `npm run measure` (`scripts/measure-startup.mjs`, Playwright jako knihovna) | ručně, před a po sérii ([[Rozhodnutí nativního jádra\|N125]]) |

`npm run check` pouští své kroky (typecheck, lint, lint:deps, lint:vault, unit, integrační) **souběžně** přes `run-p` z `npm-run-all2`, výstupy po skončení kroku (`--aggregate-output`) a dokončí všechny i po chybě (`--continue-on-error`). Typecheck je inkrementální (`incremental` v `tsconfig.base.json`), Prettier s cache. ESLint cache nemá: typově informovaná pravidla (`no-floating-promises`…) závisí na typech z jiných souborů a cache by nezměněný soubor znovu nezkontrolovala. Od 2026-10-17: ~36 s místo ~58 s.

**Server (od M39):** `npm run check:server` sestaví C++ jádro v Dockeru a pustí GoogleTest (`ctest`, včetně sdílených případů; build s nejvýš 3 vlákny, [[Rozhodnutí nativního jádra|N116, N133]]), `npm run check:full` = `check` + `check:server` (při slučování milníků, [[Rozhodnutí nativního jádra|N49]]). E2E: od M46 celá sada běží proti serveru (test:e2e i test:e2e:full potřebují Docker) – `globalSetup` zvedne Compose projekt `tinycad-e2e-<E2E_PORT>` (`docker-compose.e2e.yml`, data v anonymním svazku, který `down --volumes` smaže – od M48 místo tmpfs, aby dokumenty přežily `restart core`; Envoy na `E2E_CORE_PORT`, výchozí 18080), každý test pracuje ve vlastním dokumentu založeném přes `DocumentService` (N72); nové `m46-latency` (150 ms), `m46-outage` (výpadek během tažení) a `m46-tabs` (reload se zámkem, druhá karta jen pro čtení). Od [[M52-tenky-klient|M52]] (bez optimismu, N164, N168) ověřují e2e konečný stav a počet záznamů, ne mezistavy: `m46-latency` – po puštění šipky zůstane v poli poslední hodnota i po 1 s (poll) a v historii je jeden záznam; `m46-outage` – po obnovení spojení pole drží hodnotu puštění dřív, než přijde „Uloženo“; nový `m52-thin-client` (150 ms) – přejmenování featury ve Timeline se objeví bez pevného čekání a přežije reload, dvakrát rychle Ctrl+Z po dvou změnách vrátí obě bez toastu (N169), barva tělesa v Prohlížeči po odpovědi a po reloadu. Zpoždění unárních volání je sdílená pomůcka `delayUnaryCalls` v `test/e2e/helpers.ts`. M48: `m48-lost-transaction.restart` – restart jádra (`restartCore()` z `test/e2e/core.ts` = `scripts/e2e-core.mjs restart`, počká, až jádro odpoví) s otevřeným dialogem úpravy kvádru → toast `notice.transactionLost`, dialog zavřený, „Uloženo“, konzole čistá. E2E zamítnuté skici nahrazuje unit test s falešným jádrem (N152).

## Klíčové invarianty (property-based)

1. **Replay:** pro libovolnou sekvenci operací a undo/redo: přehrání logu od prázdného dokumentu = živý dokument.
2. **Inverze:** pro každou operaci `apply(op)` a pak `apply(inverse)` = původní dokument.
3. **Snapshot:** snapshot k `seq` + zbytek logu = přehrání celého logu.
4. **Cache regenerace:** výsledek regenerace s cache = výsledek regenerace od nuly (v C++ nad `OcctKernel` s dekorátorem `CountingKernel`, [[Rozhodnutí nativního jádra|N45]]).
5. **Úniky:** po libovolné sekvenci změn a regenerací je počet živých handle v jádru roven počtu handle, které drží regenerace, a po zničení `Regenerator` je 0 ([[Rozhodnutí nativního jádra|N112]]).

Invarianty 1–5 ověřují od [[M47-uklid-a-dokonceni|M47]] property testy v C++; property test přehrání v TS (fast-check, 1000 sekvencí) zmizel s přehráním z klienta.

## Měření výkonu

**Od [[M47-uklid-a-dokonceni|M47]]:** měření regenerace z M15 (níže) běželo nad TS regenerací a WASM a zmizelo s nimi; model desky s 36 otvory zůstal jako sdílený případ `regen` `boolean-plate-36-holes-fillet` (ověřuje výsledek, ne čas). Od [[M51-inverze-a-mereni|M51]] ho měří C++ (níže). Měří se i start aplikace: `npm run measure` (`scripts/measure-startup.mjs`) jde přes UI scénářem úvodní obrazovka → nový dokument → kvádr, medián z 5 studených načtení, přenesené bajty a velikost `dist/assets`; čísla před a po sérii jsou v [[M47-uklid-a-dokonceni]] ([[Rozhodnutí nativního jádra|N125]]).

Původní měření z [[M15-export-a-dokonceni|M15]] ([[Rozhodnutí noční rychloakce#M15 – Export a dokončení|R130]]), platilo do M46. Test **měří a vypisuje, ale na čase nikdy nepadá**: časy závisí na stroji a zatížení, test s časovým limitem by byl buď křehký, nebo tak volný, že nic neprokazuje ([[Měření, které nemůže selhat]]).

- Model: deska s 36 otvory (Boolean „odebrat“) a 4 zaoblenými hranami, ~40 featur, `createInThreadOcctKernel()`.
- Měří první regeneraci od nuly, tessellaci výsledku, plný přepočet (změna první featury) a přepočet od poslední featury (cache); každé 3×, vypíše medián a počty volání jádra (`console.table`).
- Ověřuje jen deterministické veličiny: žádná chyba featury, počet těles a ploch, **počty volání jádra** při přepočtu z cache (jádro obalené počítadlem přes `Proxy`) a `liveHandleCount` = živé handle stavu. **Každá** kontrola měření potřebuje vlastní úmyslnou chybu, která ji shodí (cache vypnutá → padne kontrola počtu volání; vynechaný `release` → padne kontrola `liveHandleCount`; …) – jedna chyba pro celý test dokazuje jen tu jednu kontrolu.
- Hrany k zaoblení hledá test **z topologie** tělesa (`names.topology`: hrana mezi dvěma rovinnými plochami s různými normálami kolmými na Z), ne rozebíráním jmen – formát jmen zná jen `regen` ([[0018-format-topologickych-jmen|ADR 0018]], oprava revize M15).
- Čísla se zapisují do vaultu ([[Q007 Cache geometrie|Q007]]), ne do testu. Naměřeno v M15: první regenerace ~103 ms, tessellace ~34 ms, plný přepočet ~101 ms, změna posledního válce ~91 ms.

**Měření regenerace v C++ (od [[M51-inverze-a-mereni|M51]], [[Rozhodnutí nativního jádra|N142, N156]]):** gtest `RegenerationMeasure` (`server/test/regen/regeneration_measure_test.cpp`, v `tinycad_regen_tests`), běží v `check:server` jako ostatní testy a stejně jako M15 **na čase nikdy nepadá**.

- Model: dokument sdíleného případu `regen/boolean-plate-36-holes-fillet` (`loadCase`, `document::fromData`), žádná druhá kopie modelu. Jádro: `OcctKernel` za počítacím dekorátorem `CountingKernel` z `server/test/regen/testing.hpp` ([[Rozhodnutí nativního jádra|N45]]).
- Měří (každé 3× s novým `Regenerator` nad novým jádrem, vypíše medián v ms tabulkou na `std::cout`, hodiny `steady_clock`): (1) první regeneraci, (2) tessellaci těles výsledku (`MeshQuality{0.1, 0.5}`, výchozí kvalita sezení), (3) plný přepočet po změně první featury (šířka desky), (4) přepočet z cache po změně poslední featury (poloměr zaoblení – jiný krok než „poslední válec“ v M15, ten přepočítal i boolean).
- Ověřuje jen deterministické veličiny, každou s vlastní úmyslnou chybou, která ji shodila (ověřeno při M51, chyby nejsou v kódu):

| Kontrola | Úmyslná chyba | Spadla |
|---|---|---|
| žádná featura v chybě | poloměr zaoblení 120 | ano (`f39: error`) |
| jedno těleso | boolean jen s prvním nástrojem | ano (36 těles) |
| 46 ploch | boolean `union` místo `subtract` | ano (154 ploch) |
| přepočet z cache: 0× `makeBox`, 0× `makeCylinder`, 0× `boolean`, 1× `fillet`, 2 modelovací volání (`fillet` + `topology`) | v kroku 4 změněná první featura místo poslední (bez cache) | ano (36 válců, 1 boolean, 1 kvádr, 78 volání) |
| `liveHandleCount` = `ownedHandleCount` za života `Regenerator`, 0 po jeho zničení | `ShapeHandle` vytvořený v testu a neuvolněný | ano (40 ≠ 39, 1 ≠ 0) |

- Naměřeno v M51 (Docker Desktop na Macu, arm64, Release, tři běhy testu): první regenerace ~52–58 ms, tessellace ~31–39 ms, plný přepočet ~53–72 ms, přepočet z cache po změně zaoblení ~12–17 ms (volání jádra: `fillet`, `topology` a jedno `release`). Nativní OCCT je tedy u první regenerace a plného přepočtu asi dvakrát rychlejší než WASM v M15.

## Sdílené testovací případy

Od [[M38-zmrazeni-domeny|M38]]. [[Sdílený testovací případ|Sdílené případy]] jsou specifikace C++ jádra `tinycad-core` ([[0030-nativni-jadro-pres-grpc|ADR 0030]]): chování zmrazené TS domény zapsané jako data, která musí projít TS i C++ sada.

**Od [[M47-uklid-a-dokonceni|M47]]** ([[Rozhodnutí nativního jádra|N124]]) je referenční implementací C++: všechny oblasti spouští `server/test/shared-cases/<oblast>_cases_test.cpp`. V TS zůstal běžec `sketch` (řešič a odvozené entity jsou v klientovi) a metatest pokrytí (`coverage.test.ts`). **Běžec `ops` (druh `script` nad paměťovým dvojníkem) zmizel v [[M52-tenky-klient|M52]]** s TS handlery ([[Rozhodnutí nativního jádra#Plán M52 – tenký klient|N166]], mění N124): případy `test/shared-cases/ops/` zůstávají a spouští je jen C++; metatest pokrytí TS běžce `ops` nevyžaduje. TS běžci sdílených případů jsou tedy `sketch` a `schema`. Běžce `geometry`, `regen` a `document` zmizely s TS doménou. **Běžec `schema` se od [[M49-pravidla-validace-v-popisu|M49]] vrátil** ([[Rozhodnutí nativního jádra|N150]], mění N124): `test/integration/shared-cases/schema.test.ts` spouští `schema.validate` i `schema.visibleWhen` nad schématy klienta ze zlatého souboru `test/golden/feature-types.json` (`featureSchemaOf`: obecná kontrola, deklarativní pravidla a `VisibleWhen`), protože s pravidly v popisu má klient vlastní validaci, která se musí s C++ shodovat. Hlášení třídí stejně jako C++ (`compareIssues` v `support/compare.ts` = `issueBefore` v `schema_cases_test.cpp`). Kódy pravidel jen na serveru (`SERVER_ONLY_CODES` v `support/schemas.ts` = `sketch.invalidEntity`, `sketch.invalidConstraint`; musí odpovídat [[03-dokument#Pravidla jen na serveru]]) se z `expected` před porovnáním vyřadí – klient je neumí a umět nemá. Referencí zůstává C++: běžec `schema` se nezaznamenává (`describeSharedCases(…, { recorded: false })`, v režimu záznamu porovnává). Integrační scénáře bez obdoby v C++ se před smazáním převedly na případy `regen` (M47 úkol 1, 48 případů, [[Rozhodnutí nativního jádra|N127]]). Rozhodnutí: [[Q107 Výstupy sdílených případů|Q107]] (zaznamenané výstupy), [[Q108 Plochy a hrany ve sdílených případech|Q108]] (jména, ne indexy), [[Q109 Řešič skici ve sdílených případech|Q109]] (řešič podle DOF), [[Q110 Tolerance sdílených případů|Q110]] (tolerance).

### Soubory a běh

- Případy: `test/shared-cases/<oblast>/<name>.json`, oblasti `ops`, `document`, `schema`, `regen`, `geometry`, `sketch`. Jeden soubor = jeden případ, `name` = název souboru bez `.json` (kebab-case, anglicky).
- TS spouštěče: `test/integration/shared-cases/{ops,sketch,schema,coverage}.test.ts` (projekt `integration`, takže je spouští `npm run check`). Společná kostra: `test/integration/shared-cases/support/` – načtení a kontrola obálky, porovnání s tolerancí, režim záznamu, schémata pro handlery ze zlatého souboru (`schemas.ts`).
- **Režim záznamu** ([[Q107 Výstupy sdílených případů|Q107]]): `npm run cases:record` spustí tytéž spouštěče s `CASES_RECORD=1`. Spouštěč pak `expected` nepřečte, ale přepíše výsledkem TS (JSON s odsazením 2 mezerami, klíče v pořadí, jak je vytvoří spouštěč, nový řádek na konci). Vstupy (`kind`, `description`, `source`, `input`, `tolerance`) nikdy nemění. Případ může před prvním záznamem `expected` vynechat, záznam ho vloží za `input`. Formát souboru určuje rekordér (`test/shared-cases/` je v `.prettierignore`), skript je `scripts/cases-record.mjs` (proměnná v `package.json` by v cmd.exe nefungovala). Bez proměnné spouštěč porovnává a případ, který neprojde, shodí `npm run check`. Od M47 zapisuje `cases:record` jen `ops` a `sketch` (běžec `schema` od M49 jen porovnává, `recorded: false`); `expected` nových případů ostatních oblastí se píše ručně podle výstupu C++ (záznamový režim C++ je odložený, [[Rozhodnutí nativního jádra|N124]] ⚠).
- C++ spouštěče (GoogleTest, `server/test/shared-cases/`) čtou tytéž soubory a porovnávají stejně; spouštěč `regen` hlídá přesný počet případů, takže nový případ znamená upravit i ten počet.
- Determinismus: id ze `createSequentialIdGenerator`, hodiny dokumentu a regenerace `() => 0`, čas záznamu logu v `ops.script` je pořadové číslo kroku skriptu, který záznam zapsal (od 1; po 50 × `apply` má `commit` čas 52), u ostatních druhů se čas nezapisuje. Inverze `feature.add`, `feature.remove` a `feature.move` je v logu `batch` s obnovou rollback baru ([[04-operace-a-historie]], [[Q029 Posun rollback baru při změnách featur|Q029]]).

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
- Neznámá vlastnost obálky nebo neznámý `kind` je chyba načtení, ne přeskočení. Každý `kind` má aspoň jeden případ a spouštěč (hlídá metatest pokrytí).
- Výstup s `NaN` nebo ±∞ je chyba případu (JSON by je tiše zapsal jako `null`).
- Vstupy, které JSON nevyjádří (`NaN`, ±∞), do sdílených případů nepatří. Stejně tak vstupy špatného tvaru (`null` místo křivky, řetězec místo `boolean`), které v C++ zachytí už převod z protobufu. Obojí ověří testy převodu a vstupů na straně serveru ([[M39-kostra-serveru|M39]], [[M45-sezeni-pres-grpc|M45]]); dnešní TS testy je dál pokrývají.

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
| `document.load` | `{ data }` – surový `DocumentData`, i se staršími verzemi featur | `{ data: DocumentData }` = `toData(fromData(data))` (migrace featur) | `{ issues: [{ path }] }` z `DocumentLoadError`, seřazené podle `path` (pořadí kontrol není kontrakt) |
| `schema.validate` | `{ type, params }` | `{ issues: ParamIssue[] }` ze `schema.validate` (celé `ParamIssue` včetně `params`), seřazené podle `param`, `code` a kanonického JSON `params` (klíče seřazené, čísla v nejkratším tvaru, který se přečte zpět na stejné číslo, jako `JSON.stringify` a `std::to_chars`; řazení nesmí záviset na stabilitě, `std::sort` stabilní není), vše po kódových jednotkách UTF-16 | – (kódy `param.notInteger`, `param.belowMin` a `param.atOrAboveMax` žádné vestavěné schéma nevyvolá, proto je případy nepokrývají). Metatest pokrytí žádá případ každého kódu deklarativního pravidla ze zlatého souboru (`boolean.sameBody`) a každého kódu z `SERVER_ONLY_CODES`; TS běžec kódy `SERVER_ONLY_CODES` z očekávání vyřadí (M49) |
| `schema.visibleWhen` | `{ type, param, params }` | `{ visible }` z `isParamVisible` | – |
| `regen` | `{ document: DocumentData, inputOf? }` | `{ statuses, bodies, sketches, anchors, input? }` (níže) | – (chyby featur jsou ve `statuses`) |
| `geometry.intersections` | `{ curves }` | `{ hits: CurveHit[] }` | `{ code }` = `KernelErrorCode` |
| `geometry.segment` | `{ curve, from, to }` | `{ curve }` | `{ code }` |
| `geometry.fillet` | `{ a, b, radius, near }` | `FilletArc` | `{ code }` |
| `geometry.offset` | `{ chain, closed, distance }` | `{ curves: OffsetCurve2[] }` | `{ code }` |
| `sketch.solve` | `SolveInput` (`entities`, `constraints`, `drag?`) | `{ status, dof, conflicting, redundant, entities }` | – |
| `sketch.derived` | `SketchData` | `{ copies, textCurves, regionCurves }` z `patternCopies`, `textCurves`, `regionCurves` | – |

Splajny (`bspline`) se porovnávají póly a uzly. Kdyby nativní OCCT 8 vracelo jinou, ale ekvivalentní reprezentaci (jiný počet pólů), upraví se porovnání u druhu v [[M39-kostra-serveru|M39]] na body na křivce, ne případy.

Křivka bez `id` je v `.proto` prázdný řetězec; jádro bere `""` stejně jako chybějící `id`. Druhy `geometry.*` odpovídají metodám `GeometryService` (`server/src/geometry`, [[14-protokol#GeometryService]]), které klient volá za portem `SketchGeometry`; do M47 to byly metody TS portu `GeometryKernel` (`curveIntersections`, `curveSegment`, `filletArc`, `offsetCurves`).

**`regen`** – registry ze všech vestavěných featur, nové `OcctKernel` na každý případ ([[Rozhodnutí nativního jádra|N111]]; do M47 v TS `createInThreadOcctKernel()`), jedna regenerace od nuly:

- `statuses`: `{ [featureId]: { kind } }`, u `error` navíc `code` a `issues` (bez `message`, seřazené stejně jako u `schema.validate`), u `warning` jen `kind`.
- `bodies`: seřazené podle `id`, každé `{ id, origin, lastModifiedBy, volume, bbox: { min, max }, faces, edges, vertexCount }`.
  - `volume` z jemné sítě (`linearDeflection` 0,01, `angularDeflection` 0,05) a případ má `tolerance.relative` 1e-3 ([[Q110 Tolerance sdílených případů|Q110]]).
  - `faces`: `{ names, surface, plane? }` – všechna jména plochy (`namesOfFace`, seřazená), typ plochy a u roviny `{ normal, offset }` (`offset` = `normal · origin`). `edges`: `{ names, midpoint }`, `names` = `[nameOfEdge(i)]` nebo `[]` (hrana má nejvýš jedno jméno). **Indexy podtvarů se nezapisují** ([[Q108 Plochy a hrany ve sdílených případech|Q108]]).
  - Řazení (C++ ho opakuje přesně): podle `names` po prvcích (řetězce po kódových jednotkách UTF-16, kratší prefix dřív), pak plochy podle `surface`, složek `normal` a `offset`, hrany podle složek `midpoint`; čísla se pro řazení zaokrouhlí na 6 desetinných míst (polovina od nuly jako `std::round`, −0 = 0), aby šum pod `length` neprohodil pořadí (zapisují se nezaokrouhlená).
- `sketches`: `{ id, owner, regions: string[] (seřazená id oblastí), outlines }`. Oblasti v `outlines` podle `name`; počáteční křivku smyčky ani pořadí děr port neurčuje, proto se každá smyčka otočí tak, aby začínala křivkou s nejmenším `id` (směr zůstává), a díry se seřadí podle nejmenšího `id` svých křivek. `id` křivek ve smyčce jsou jedinečná (každá hrana oblasti je ve smyčce jednou).
- `anchors`: `{ [featureId]: FeatureAnchors }`.
- `input` jen s `inputOf`: `{ feature, bodies, sketches }` stavu před editovanou featurou ([[0025-vstupni-stav-editovane-featury|ADR 0025]], `regen.input` ze [[14-protokol#Read model a sítě|spec 14]]), `bodies` a `sketches` ve stejném tvaru jako výše. Featura z `inputOf` za lištou nebo neznámá → `input: null`.
- `statuses` a `anchors` jsou v pořadí featur.
- Kód `STALE_VERSION` z uloženého dokumentu nevznikne (`fromData` starší verzi zmigruje, novější odmítne), proto ho případy `regen` nepokrývají. Chybu jádra (`KERNEL`) dává průnik oddělených těles. Příliš velké zaoblení nebo sražení je `INVALID_PARAMS` s `fillet.failed` / `chamfer.failed`, protože chybu jádra převádí builder.
- Plochy oblastí skic a středy hran splajnů a textu mají výchozí `length`. Kdyby se nativní OCCT 8 lišilo víc, rozhodne se v [[M43-regenerace-v-cpp|M43]] u konkrétních případů.

**`sketch.solve`** ([[Q109 Řešič skici ve sdílených případech|Q109]]): `status`, `dof`, `conflicting` a `redundant` se porovnávají vždy (seznamy seřazené). `entities` jen při `dof` 0. Při `dof` > 0 spouštěč ověří **pevný bod**: vyřešené entity pošle řešiči znovu se stejnými vazbami, ale **bez `drag`** (s ním by řešič bod dál táhl k cíli), výsledek se od nich nesmí lišit o víc než `length` a `dof` musí zůstat stejný. Při `dof` > 0 se navíc porovná vše, co na volných stupních volnosti nezávisí: `entities` bez číselných hodnot (id, druhy, odkazy, řetězce a `boolean` přesně) a u případu s `drag` souřadnice taženého bodu s tolerancí `length` (upřesnění [[Q109 Řešič skici ve sdílených případech|Q109]] po revizi M38). Ostatní zaznamenané souřadnice jsou jen pro čtení. Při `dof` `null` (neúspěšné řešení) se porovná celý výstup. Konflikt může mít záporné `dof` a jedna vazba může být v `conflicting` i `redundant` zároveň: je to chování planegcs a C++ s nativním planegcs ho opakuje.

## Konvence

- Testy leží mimo `src/` se zrcadlovou strukturou ([[0023-testy-mimo-zdrojaky|ADR 0023]]): `src/<modul>/foo.ts` → `test/unit/<modul>/foo.test.ts`, importy přes `@/`. Integrační testy v `test/integration/`, e2e v `test/e2e/`.
- Testovací data (featury, dokumenty) přes malé buildery: `aBox({ height: 20 })`, `aDocument().with(aBox()).build()`.
- ID v testech ze `SequentialIdGenerator` → čitelné snapshoty.
- Žádné mockovací frameworky pro porty – vlastní fake implementace, které jsou samy ověřené: v klientovi falešné jádro `createFakeCore` a buildery read modelu (`remote/testing.ts`), testovací dvojník portů `ops` (`aFakeOps` z `ops/testing.ts`, od [[M52-tenky-klient|M52]]; nic neaplikuje, zaznamená odeslané změny a odpovídá skriptovaně) a snímkový dokument `aSnapshotDocument` (`document/testing.ts`); na serveru dekorátory nad skutečnými implementacemi (`CountingKernel`, selhávající `DocumentFile`), ne paměťové kopie ([[Rozhodnutí nativního jádra|N33, N45]]).

## Pokrytí

Neřešíme procenta. Pravidlo: každé veřejné API modulu má test a každá opravená chyba dostane regresní test.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
