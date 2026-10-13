---
type: insight
status: seed
aliases:
  - Hyrumův zákon u portu
  - Náhodně splněný kontrakt
topics:
  - architektura
  - testování
  - porty a adaptéry
sources:
  - https://www.hyrumslaw.com/
  - https://martinfowler.com/bliki/ContractTest.html
tags:
  - poznatek
created: 2026-10-13
updated: 2026-10-13
---
# Implicitní kontrakty první implementace

**Shrnutí:** Když má port zatím jen jednu (falešnou) implementaci, spotřebitelé se nevědomky opřou o vlastnosti, které ta implementace splňuje náhodou. Kontrakt je proto potřeba psát podle potřeb spotřebitelů a ověřovat ho proti předpokládané druhé implementaci.

## Podrobnosti

- **Hyrumův zákon v malém:** při dostatku uživatelů závisí někdo na každém pozorovatelném chování. U portu stačí jeden spotřebitel a jedna implementace.
- **Typické náhodně splněné vlastnosti:**
  - **Pořadí:** výsledky seřazené tak, jak je vyrobil fake. Spotřebitel pak v nich hledá binárně.
  - **Přesnost:** fake vrací přesná čísla, skutečná knihovna „bezpečný obal“ s tolerancí.
  - **Paměť:** jedno pole na volání a nic sdíleného. Skutečný adaptér může zabalit víc polí do jednoho bufferu a přenos přes `postMessage` pak selže.
  - **Čas:** kdy se čte vstup. `postMessage` klonuje v okamžiku volání, fake v mikroúloze četl až později.
  - **Determinismus:** opakované volání vrací totéž.
- **Jak je najít dřív:**
  1. projít specifikace **spotřebitelů** a ke každé vlastnosti, o kterou se opírají, dopsat pravidlo do kontraktu (nebo výslovně „nezaručuje se“);
  2. psát kontraktovou sadu tak, aby nepředpokládala nic mimo kontrakt (žádné pořadí, počty, přesné hodnoty);
  3. u známé druhé implementace (tady OCCT) si u každého pravidla položit otázku „splní to?“;
  4. revize architektury na švu port–spotřebitel.
- Pravidlo „nezaručuje se“ je stejně cenné jako „zaručuje se“: brání spotřebiteli opřít se o náhodu.

## Jak to využívá tinycad

Kontrakt `GeometryKernel` v [[06-geometricke-jadro]]: seřazené `faceRanges`, vlastní `ArrayBuffer`, obalující bounding box s nadsazením nejvýš 1e-6, synchronní čtení vstupů a nezaručený determinismus `tessellate`. Všechno našla revize M5 na švu s [[09-vykreslovani|render]]. Souvisí s [[Kontraktové testy portu]] a [[Port a adaptér]].

## Zdroje

- Hyrum Wright: Hyrum's Law.
- Martin Fowler: ContractTest (bliki).
