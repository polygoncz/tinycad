---
type: insight
status: seed
aliases:
  - Ověření měření úmyslnou chybou
  - Slepé měření paměti WASM
topics:
  - testování
  - WASM
  - správa paměti
sources:
  - https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow
  - https://en.wikipedia.org/wiki/Mutation_testing
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Měření, které nemůže selhat

**Shrnutí:** Test nebo měření, které nikdy nespadlo, nic neprokazuje. Než mu uvěřím, musím ho shodit úmyslnou chybou a výsledek porovnat se základní úrovní (stejná práce bez mého kódu).

## Podrobnosti

- **Paměť WASM je „capacity“, ne „size“.** `WebAssembly.Memory.buffer.byteLength` roste skokově (stránky 64 kB, alokátor jako mimalloc bere segmenty po desítkách MB) a nikdy neklesá. Dokud alokátor nevyčerpá rezervu, měření úniku nevidí nic. Je to stejné jako sledovat únik přes `std::vector::capacity()`.
- **Ověřit úmyslnou chybou** (princip mutačního testování): do kódu dočasně vložit přesně tu chybu, kterou má test chytat (neuvolněný objekt, `release`, který nic nemaže), a ověřit, že test spadne. Když nespadne, test je slepý, ne kód v pořádku.
- **Základní úroveň:** změřit samotnou knihovnu bez vlastního kódu. Teprve rozdíl patří mně. Bez ní se únik knihovny (nebo jejího bindingu) přičte vlastnímu kódu, nebo ho naopak zakryje.
- **Spike není výjimka.** Jednorázové měření ve spiku je dojem, dokud neprojde stejnou kontrolou.
- Když citlivé měření neexistuje (build nevystavuje `mallinfo` ani `sbrk`), je poctivější kritérium přeformulovat a ověřit jinak (revize, struktura kódu) než držet test, který jen předstírá kontrolu.

## Jak to využívá tinycad

V [[M07-kernel-occt|M7]] tvrdil spike „s `.delete()` je halda konstantní“ a paměťový test procházel. Implementátor vložil úmyslný únik a test prošel dál; základní úroveň ukázala, že paměť ztrácí samo OCCT ([[Q053 Citlivost paměťového testu OCCT|Q053]], [[Q054 Únik paměti v OCCT buildu|Q054]], dodatek v [[0013-replicad-opencascadejs|ADR 0013]]). Totéž ověřování úmyslnou chybou se používá pro hranice modulů v [[M00-zaklad-projektu|M0]] a pro hook `claude-guard` (self-test).

## Zdroje

- https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow
- https://en.wikipedia.org/wiki/Mutation_testing
