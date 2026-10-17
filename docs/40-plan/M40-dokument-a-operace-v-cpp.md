---
type: milestone
status: todo
order: 40
aliases:
  - M40
  - M40 Dokument a operace v C++
modules:
  - server
specs:
  - "[[03-dokument]]"
  - "[[04-operace-a-historie]]"
depends_on:
  - "[[M39-kostra-serveru]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M40 – Dokument a operace v C++

**Cíl:** Doménový model dokumentu, schémata featur, operace, log, transakce a undo v C++, ověřené sdílenými případy replay a transakcí.

> Hrubý plán série nativního jádra (2026-10-17). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[03-dokument]], [[04-operace-a-historie]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M39-kostra-serveru]]

## Úkoly

- [ ] Neměnný model dokumentu v C++ (hodnotové typy, `std::shared_ptr<const …>`), id, metadata těles, rollback bar.
- [ ] JSON (nlohmann) ↔ dokument a `.tinycad.json` včetně migrace featur.
- [ ] Registr schémat featur: deklarativní část, `validate`, `defaults`, `migrate`; vyhodnocení `VisibleWhen` ([[Q105 Viditelnost parametru jako data|Q105]]).
- [ ] Handlery všech operací, `applyOperation` (dávka, rollback bar, atomičnost), dispečer, transakce se slučováním a přechodnými kroky, undo a `rebuildUndoStacks`.
- [ ] Převod `tinycad.v1.Operation` ↔ JSON operace spec 04 ([[Q101 Operace v kontraktu proto|Q101]]).
- [ ] Sdílené případy z M38 (replay, transakce, undo, migrace, validate) zelené; property test replay (RapidCheck nebo vlastní generátor).

## Akceptační kritéria

- Všechny sdílené případy dokumentu a operací projdou v C++.
- Replay test: náhodné sekvence → přehrání logu dá týž dokument.

## Co se naučíš

Neměnná data a event sourcing v C++, rozdíly proti TS (vlastnictví, hodnotové typy).

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
