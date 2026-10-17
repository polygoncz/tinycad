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

## Konvence

- Test leží vedle kódu: `foo.ts` → `foo.test.ts`. Integrační testy v `tests/`.
- Testovací data (featury, dokumenty) přes malé buildery: `aBox({ height: 20 })`, `aDocument().with(aBox()).build()`.
- ID v testech ze `SequentialIdGenerator` → čitelné snapshoty.
- Žádné mockovací frameworky pro porty – vlastní fake implementace (`FakeKernel`, `MemoryDocumentStore`), které jsou samy ověřené kontraktovými testy.

## Pokrytí

Neřešíme procenta. Pravidlo: každé veřejné API modulu má test a každá opravená chyba dostane regresní test.

## Otevřené otázky

Otázky jsou samostatné poznámky v `60-otazky/` a odkazují sem. Novou otázku založ šablonou *Otázka*.

![[otazky.base#Otázky k této poznámce]]
