---
type: milestone
status: todo
order: 51
aliases:
  - M51
  - M51 Inverze po chybě zápisu a měření výkonu
modules:
  - server
specs:
  - "[[05-persistence]]"
  - "[[13-testovani]]"
depends_on:
  - "[[M47-uklid-a-dokonceni]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M51 – Inverze po chybě zápisu a měření výkonu

**Cíl:** Po chybě zápisu do SQLite se dokument vrátí inverzí a otevřená transakce přežije (N35); regenerace v C++ má měření výkonu (N142).

> Hrubý plán (2026-10-17) z Pavlových rozhodnutí sporných míst ([[Rozhodnutí nativního jádra#Pavlova rozhodnutí sporných míst (2026-10-17)]]). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[05-persistence]], [[13-testovani]]

**Navazuje na:** [[M47-uklid-a-dokonceni]]

## Úkoly

- [ ] `PersistentDocument`: selhání zápisu záznamu (`STORAGE`) vrátí dokument v paměti inverzí zapisované operace, log beze změny; spec 05 a 14 upravené (N35).
- [ ] Testy s `FailingFile`: zápis selže uprostřed transakce, `Commit` vrátí `STORAGE`, transakce zůstane otevřená, opakování uspěje.
- [ ] Měření výkonu regenerace v C++ (deska s 36 děrami a 4 zaobleními, plný přepočet, přepočet z cache, tessellace) jako test, který jen vypisuje a nikdy nepadá na čase; kontroly deterministických veličin (počty volání jádra, živé handle) (N142, [[Měření, které nemůže selhat]]).
- [ ] Čísla do vaultu (spec 13).

## Akceptační kritéria

- Chyba zápisu nezahodí transakci; log vždy odpovídá dokumentu.
- Měření běží v `check:server` a vypisuje časy.

## Co se naučíš

Proč je inverze křehčí než znovunačtení a jak ji otestovat; měření, které nemůže selhat, v C++.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
