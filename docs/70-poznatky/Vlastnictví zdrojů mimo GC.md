---
type: insight
status: seed
aliases:
  - Ruční správa zdrojů v JS
  - Owned set + sweep
topics:
  - správa paměti
  - architektura
  - WASM
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry
  - https://en.wikipedia.org/wiki/Tracing_garbage_collection
  - https://github.com/tc39/proposal-explicit-resource-management
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Vlastnictví zdrojů mimo GC

**Shrnutí:** Zdroje, které GC nevidí (objekty ve WASM nebo ve workeru), spravuje nejspolehlivěji jeden vlastník: množina všeho, co kdy dostal, a periodický sweep proti tomu, co je živé – plněná dekorátorem, ne disciplínou volajících.

## Podrobnosti

- **Počítání referencí** je křehké, když se zdroj sdílí mezi neměnnými snímky: každé předání by muselo zvyšovat a snižovat čítač.
- **Mark & sweep:** vlastník vede množinu vlastněných zdrojů; po každé dávce práce označí živé (dosažitelné z aktuálních dat) a zbytek uvolní jedním voláním.
- **Kdo plní množinu:** ne volající („nezapomeň zaregistrovat“), ale **dekorátor** kolem továrny zdrojů – každý vrácený zdroj se zapíše sám, i mezivýsledek a i když volající pak selže.
- **Úzké rozhraní** pro volající (bez `release`) převede pravidlo „neuvolňuj“ z dokumentace do typu.
- Uvolňované zdroje vyjmout z množiny **před** asynchronním uvolněním, jinak je souběžný sweep uvolní podruhé.
- `FinalizationRegistry` není náhrada: kdy (a jestli vůbec) se zavolá, není zaručeno.

### Lokální úklid: `using` jako RAII (doplněno v M7)

- Uvnitř jedné funkce se dočasné objekty mimo GC (embind objekty OCCT) uvolňují deklarací **`using`** (TC39 Explicit Resource Management): na konci bloku se zavolá `[Symbol.dispose]()`, i při výjimce. Je to obdoba RAII a destruktorů v C++. Novější Emscripten dává embind objektům `[Symbol.dispose]` = `delete()`.
- `try/finally` jen tam, kde objekt opouští rozsah (předává se vlastníkovi). Pravidlo vlastnictví: objekt patří funkci, dokud ho nepředá; při selhání před předáním ho uvolní ona.
- **Past při převodu:** bundler (Vite 8) převádí `using` na pomocnou funkci, která hledá `Symbol.dispose ?? Symbol.for('Symbol.dispose')`, ale embind přidá metodu jen tehdy, když `Symbol.dispose` existuje. Řešení: před inicializací knihovny doplnit `Symbol.dispose = Symbol.for('Symbol.dispose')`, jen pokud chybí.
- **Dva druhy chyb ve WASM:** `WebAssembly.Exception` je řízená výjimka C++ (po ní knihovna uklidila a funguje dál); `WebAssembly.RuntimeError` je pád stroje (trap), obdoba segfaultu, po něm stav paměti není zaručený.
- Ani dokonalý úklid nepomůže, když objekty drží sama knihovna – to odhalí jen [[Měření, které nemůže selhat|měření se základní úrovní]].

## Jak to využívá tinycad

[[07-regenerace#Životnost handle: mark & sweep|Regenerace]] vlastní [[Handle tvaru|handle]] OCCT; `BuildContext.kernel` je sledované `ModelingKernel` ([[Q041 Úklid mezivýsledků builderu|Q041]]), sweep řeší selhání `release` podle [[Q040 Selhání release při úklidu handle|Q040]]. Adaptér OCCT ([[06-geometricke-jadro#`kernel-occt`: architektura adaptéru|spec 06]], [[0013-replicad-opencascadejs|ADR 0013]]) uvolňuje dočasné objekty přes `using`; pád WASM řeší [[Q055 Pád WASM jádra|Q055]].

## Zdroje

- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry
- https://en.wikipedia.org/wiki/Tracing_garbage_collection
- https://github.com/tc39/proposal-explicit-resource-management
