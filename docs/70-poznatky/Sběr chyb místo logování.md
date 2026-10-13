---
type: insight
status: seed
aliases:
  - AggregateError v knihovním kódu
  - Collect errors, rethrow later
topics:
  - JavaScript
  - zpracování chyb
sources:
  - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/AggregateError
  - https://nodejs.org/api/events.html#error-events
  - https://dom.spec.whatwg.org/#concept-event-listener-inner-invoke
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Sběr chyb místo logování

**Shrnutí:** když knihovní kód volá víc callbacků (handlery událostí, uvolnění zdrojů), může chybu v jednom z nich zachytit, nechat doběhnout ostatní a chyby vyhodit až na konci, jednu tak, jak je, více jako `AggregateError`. Nic se neztratí, jedna rozbitá komponenta nevyřadí ostatní a kód nepotřebuje `console` ani jinou službu platformy.

## Podrobnosti

- Dvě běžné varianty mají každá slabinu:
  - **Node `EventEmitter`:** výjimka v handleru vyletí z `emit` hned a další handlery se nezavolají. Jedna komponenta tak rozbije ostatní.
  - **DOM `EventTarget`:** výjimku nahlásí prostředí (`report the exception`, tedy do konzole) a pokračuje. Chyba se ale volajícímu ztratí a kód potřebuje prostředí, které má kam hlásit.
- Sběr a pozdější vyhození spojuje výhody obou: ostatní handlery doběhnou a chybu uvidí volající, v testu přes `expect(...).toThrow()`, v aplikaci ji zaloguje kompoziční kořen.
- Stejný vzor se hodí pro `dispose()`: když jedno uvolnění selže, ostatní zdroje se musí uvolnit taky, jinak zůstanou viset.
- Při iteraci přes handlery, které se během volání odhlašují, se prochází kopie seznamu a každý záznam nese příznak `active`. Je to stejný problém jako mazání z `std::vector` během iterace.

## Jak to využívá tinycad

`Emitter` a `DisposableStore` v `core` sdílejí interní pomocnou funkci `throwCollected`. Důvod, proč `core` nesmí logovat, je v [[Q022 Platformové typy v core]] a [[0009-platformove-nezavisla-domena|ADR 0009]], pravidla ve specifikaci [[02-core]].

## Zdroje

- MDN: `AggregateError`.
- Node.js: Events, chování výjimek v posluchačích.
- DOM Standard: „inner invoke“, hlášení výjimek z posluchačů.
