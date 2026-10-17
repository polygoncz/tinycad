---
type: adr
status: superseded
number: 13
aliases:
  - ADR 0013
  - WASM build OCCT – replicad-opencascadejs
  - Volba WASM buildu OCCT
date: 2026-10-13
related:
  - "[[06-geometricke-jadro]]"
  - "[[0002-occt-wasm-ve-workeru]]"
  - "[[Q012 Volba WASM buildu OCCT]]"
  - "[[M07-kernel-occt]]"
supersedes:
tags:
  - adr
created: 2026-10-13
updated: 2026-10-17
---
# 0013 – WASM build OCCT: `replicad-opencascadejs`

- **Stav:** Nahrazeno (`status: superseded`) – 2026-10-17 ho nahradilo [[0030-nativni-jadro-pres-grpc|ADR 0030]] (nativní jádro přes gRPC). Platilo pro WASM verzi, kterou odstranil [[M47-uklid-a-dokonceni|M47]] (kód zůstává v historii gitu, popis v [[06-geometricke-jadro v prohlížeči]]).
- **Datum:** 2026-10-13
- **Souvisí:** [[0002-occt-wasm-ve-workeru|ADR 0002]], [[06-geometricke-jadro]], [[Q012 Volba WASM buildu OCCT|Q012]]

## Kontext

[[0002-occt-wasm-ve-workeru|ADR 0002]] rozhodl, že [[Geometrické jádro|geometrické jádro]] je OpenCascade ve WASM ve Web Workeru, a konkrétní build nechal na spike na začátku [[M07-kernel-occt|M7]]. Spike (2026-10-13, skripty ve `spikes/m07-occt/`) porovnal předpřipravené buildy na úlohách z M7 a z plánovaných milníků.

| Kritérium | `replicad-opencascadejs` 1.1.0 | `opencascade.js` 2.0.0-beta |
|---|---|---|
| Poslední vydání | 2026-09, udržovaný | 2023-03, beta, stojí |
| WASM (gzip) | 23 MB (7,3 MB) | 50 MB |
| Inicializace v Node | ~100 ms | ~2 400 ms |
| Inicializace ve Vite workeru | ~300 ms, hlavní vlákno neblokuje | nezkoušeno |
| `BRepPrimAPI_MakeBox` + role ploch | ano | ano |
| `BRepBndLib::AddOptimal` | ano, přesně bez tolerance | ano |
| `BRepMesh_IncrementalMesh`, `Triangulation`, `PolygonOnTriangulation` | ano | ano |
| Historie `Modified` / `Generated` / `IsDeleted` | ano (ověřeno na `BRepAlgoAPI_Cut`) | ano |
| `STEPControl_Writer` | ano, přes virtuální FS | ano |
| Výjimky OCCT | `getExceptionMessage` → typ a zpráva | holé číslo (ukazatel) |
| `Symbol.dispose` na objektech embindu | ano | ne |
| Přetížené metody | původní názvy | přípony `_1`, `_2`… |
| `TopExp::MapShapes`, `IndexedMap`, `HashCode` | **ne** (deklarace v `.d.ts` jsou, vazby chybí) | ano |
| Node vstup | čisté ES modul | přepisuje globální `__dirname`, `require` |

Bez `.delete()` rostla halda WASM o ~22 kB na kvádr se sítí, s `.delete()` zůstala konstantní. _(Chybný závěr, viz [[#Dodatek 2026-10-13: únik paměti v OCCT|dodatek]].)_

## Rozhodnutí

- Adaptér `kernel-occt` používá **`replicad-opencascadejs`**, verze připnutá přesně (`1.1.0`), varianta `single` (bez vláken).
- Mapy podtvarů (`ShapeEntry` v [[06-geometricke-jadro#Datové struktury na obou stranách|spec 06]]) se počítají **jedním pomocníkem** v adaptéru: `TopExp_Explorer` a odstranění duplicit přes `IsSame`. Je to přesně algoritmus `TopExp::MapShapes`, takže indexy podtvarů mají stejné pořadí jako v OCCT.
- Objekty OCCT se uvolňují deklarací `using` (TC39 Explicit Resource Management), kterou embind v tomto buildu podporuje. `try/finally` jen tam, kde `using` nejde (objekt předávaný pryč z rozsahu).
- WASM se ve Vite načítá přes `import wasmUrl from 'replicad-opencascadejs/wasm?url'` a `locateFile`, balík je v `optimizeDeps.exclude`.
- Vlastní C++ modul přes Emscripten a embind je samostatný pozdější milník ([[M16-vlastni-occt-build]]). Port `GeometryKernel` zaručuje, že výměna se zbytku aplikace nedotkne.

## Zvažované alternativy

- **`opencascade.js` 2.0 beta** – úplné API včetně map, ale od 2023 se nevyvíjí, dvojnásobná velikost, 20× pomalejší start, výjimky jako holé ukazatele, upovídané přípony přetížení a zásah do globálních proměnných v Node.
- **Vlastní build hned teď** – úzké API přesně podle portu a mapy v C++, ale překlad OCCT pro Emscripten trvá hodiny a ladění buildu by M7 odvedlo od cíle. Odloženo do [[M16-vlastni-occt-build]].

## Důsledky

- \+ Malý WASM a rychlý start, aktivně udržovaný projekt.
- \+ `using` dává uvolňování podobné RAII v C++. Výjimky OCCT jdou převést na `KernelError` se smysluplnou zprávou.
- − Mapy podtvarů v JS stojí O(n²) volání `IsSame` přes embind. U kvádru zanedbatelné, u tvarů s tisíci hranami to může být znát. Je to signál pro [[M16-vlastni-occt-build]].
- − Jen podmnožina API. Chybějící třídu (např. pro `fillet` nebo naming) půjde doplnit jen vlastním buildem.
- − `.d.ts` slibuje i třídy, které nejsou svázané. Každé nové použití třídy musí pokrýt test, který ji opravdu zavolá.
- − Licence LGPL-2.1 (stejně jako OCCT). Pro výukový projekt bez distribuce upravené knihovny bez dopadu.
- − Tvary z `BRepPrimAPI_MakeBox` se po `delete()` neuvolní celé, viz dodatek.

## Dodatek 2026-10-13: únik paměti v OCCT

Měření spiku („s `.delete()` konstantní“) bylo chybné: 3000 kol se vešlo do počáteční rezervy 100 MB a velikost paměti modulu roste až po jejím vyčerpání. Při implementaci M7 ([[Q053 Citlivost paměťového testu OCCT|Q053]], [[Q054 Únik paměti v OCCT buildu|Q054]]) se ukázalo:

- Holé `MakeBox` + `Shape()` + `delete()` všeho nechá ~11 kB na kvádr, s `BRepMesh` ~18 kB, celé kolo adaptéru ~27 kB. `MakeVertex` nic.
- Totéž dělá `opencascade.js` 2.0 beta, volba buildu to tedy neovlivňuje.
- Topologie (`TShape`) zůstává viset: refcount triangulace plochy po smazání všech kopií neklesne. Příčina (vazby uvnitř OCCT nebo embind) nezjištěna.
- Alokátor buildu je mimalloc, paměť bere po segmentech ~31 MB.

Rozhodnutí se nemění. Únik je známé omezení buildu. Příčinu, paměťový test a případný restart workeru jádra řeší [[M16-vlastni-occt-build]].
