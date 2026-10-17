---
type: milestone
status: todo
order: 49
aliases:
  - M49
  - M49 Pravidla validace v popisu typů
modules:
  - server
  - remote
  - ui
specs:
  - "[[14-protokol]]"
  - "[[03-dokument]]"
depends_on:
  - "[[M47-uklid-a-dokonceni]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M49 – Pravidla validace v popisu typů

**Cíl:** Vlastní pravidla validace featur (např. `boolean.sameBody`, různé reference) jsou deklarativně ve `FeatureTypeDescriptor`, takže je dialog ukáže u pole ještě před odesláním (N67).

> Hrubý plán (2026-10-17) z Pavlových rozhodnutí sporných míst ([[Rozhodnutí nativního jádra#Pavlova rozhodnutí sporných míst (2026-10-17)]]). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[14-protokol]], [[03-dokument]]

**Navazuje na:** [[M47-uklid-a-dokonceni]]

## Úkoly

- [ ] Inventura vlastních pravidel `validate` v C++ schématech (`server/src/features/*/schema.cpp`) nad rámec generické validace.
- [ ] Doplnění `schema.proto` o deklarativní pravidla (jen přidaná pole, `buf breaking`), převod v `session/feature_types` a zlatý soubor `test/golden/feature-types.json`.
- [ ] Vyhodnocení pravidel v klientovi (`remote/feature-types`) se stejnými kódy `ParamIssue`; sdílené případy `schema.validate` pro pravidla v TS i C++.
- [ ] Pravidlo, které deklarativně popsat nejde, zůstane jen na serveru – seznam ve spec 03.

## Akceptační kritéria

- Dialog ukáže vlastní chybu parametru stejným kódem jako server.
- Sdílené případy pravidel zelené v C++ i TS; `buf breaking` prošel.

## Co se naučíš

Kde je hranice mezi deklarativním schématem a kódem validace a jak držet jedno pravidlo ve dvou jazycích přes sdílené případy.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
