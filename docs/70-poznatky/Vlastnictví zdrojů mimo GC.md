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

## Jak to využívá tinycad

[[07-regenerace#Životnost handle: mark & sweep|Regenerace]] vlastní [[Handle tvaru|handle]] OCCT; `BuildContext.kernel` je sledované `ModelingKernel` ([[Q041 Úklid mezivýsledků builderu|Q041]]), sweep řeší selhání `release` podle [[Q040 Selhání release při úklidu handle|Q040]].

## Zdroje

- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry
- https://en.wikipedia.org/wiki/Tracing_garbage_collection
