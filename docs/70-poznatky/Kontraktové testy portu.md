---
type: insight
status: seed
aliases:
  - Contract tests
  - Kontraktová sada
topics:
  - testování
  - architektura
  - porty a adaptéry
sources:
  - https://martinfowler.com/bliki/ContractTest.html
  - https://alistair.cockburn.us/hexagonal-architecture/
  - https://github.com/dumbmatter/fakeIndexedDB
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Kontraktové testy portu

**Shrnutí:** Jedna sada testů napsaná jen proti rozhraní portu a spuštěná pro každý adaptér je jediný spolehlivý způsob, jak zajistit, že se implementace dají opravdu zaměnit.

## Podrobnosti

- **Sada je funkce, ne soubor testů:** `describeContract(name, factory)`. Každý adaptér ji zavolá se svou továrnou, továrna dá pro každý test čerstvou instanci a sada nezná nic než rozhraní.
- **Kontrakt musí být psaný přesně.** Odrážka ve spec = test v sadě. Formulace jako „chyba zápisu“ nestačí. Potřeba je kód chyby, pořadí kontrol, co se při odmítnutí zapíše (nic), idempotence a izolace dat (vrácený objekt nesdílí paměť s uloženým).
- **Chyby se porovnávají jako data, ne jako třída.** Přes hranici procesu nebo workeru (`postMessage`, structured clone) třída chyby nepřežije, přežije jen `code`. `instanceof` v kontraktu by fungoval pro paměťový adaptér a selhal pro vzdálený.
- **Referenční implementace v paměti** musí být stejně přísná jako ta skutečná, jinak testy v paměti projdou a v produkci ne. Příklad: paměťový store kopíruje přes JSON, což je přísnější než structured clone v IndexedDB.
- **Vzdálený adaptér testovat přes skutečný transport**, ne přímým voláním. V Node to jde (`MessageChannel`, `fake-indexeddb`), a test pak pokrývá i serializaci argumentů a přenos chyb.
- **Ověřit, že sada kouše:** dočasně rozbít implementaci (vypnout kopírování, kontrolu mezery) a zkontrolovat, že padají správné testy.
- Co přes port vidět nejde (např. promazávání starých snapshotů), se testuje zvlášť: čistou funkcí sdílenou adaptéry, nebo testem konkrétního adaptéru, který čte přímo úložiště. Rozšiřovat port kvůli testům je špatně.

## Jak to využívá tinycad

[[05-persistence]]: `describeDocumentStoreContract` v `persistence/testing.ts` běží pro `MemoryDocumentStore` i pro IndexedDB přes RPC. Stejný vzor čeká port jádra ([[06-geometricke-jadro]]) a viz také [[Port a adaptér]], [[Port bez adaptéru díky strukturálnímu typování]].

## Zdroje

- Martin Fowler: ContractTest (bliki).
- Alistair Cockburn: Hexagonal Architecture.
- fake-indexeddb: implementace IndexedDB v čistém JS pro testy.
