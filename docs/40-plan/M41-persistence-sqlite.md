---
type: milestone
status: todo
order: 41
aliases:
  - M41
  - M41 Persistence v SQLite
modules:
  - server
specs:
  - "[[05-persistence]]"
  - "[[14-protokol]]"
depends_on:
  - "[[M40-dokument-a-operace-v-cpp]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M41 – Persistence v SQLite

**Cíl:** Dokumenty jako SQLite soubory s operačním logem a snapshoty, idempotence přes `operation_id` a `DocumentService`.

> Hrubý plán série nativního jádra (2026-10-17). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[05-persistence]], [[14-protokol]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M40-dokument-a-operace-v-cpp]]

## Úkoly

- [ ] Schéma SQLite: `operations` (`seq`, `operation_id` unikátní, JSON záznamu), `snapshots`, `meta`; WAL, transakce na záznam.
- [ ] Otevření: poslední snapshot + zbytek logu, `rebuildUndoStacks`; občasný snapshot podle pravidel [[05-persistence]].
- [ ] Katalog dokumentů (složka ve volume) a `DocumentService`: seznam, vytvoření, přejmenování, smazání, import a export `.tinycad.json`.
- [ ] Idempotence trvalých změn ([[14-protokol#Idempotence]]), chyba `STORAGE` a vrácení dokumentu v paměti.
- [ ] Migrace dokumentů z IndexedDB: export všech dokumentů z dnešní aplikace do `.tinycad.json` a import na server (jednorázový nástroj).

## Akceptační kritéria

- Zápis, pád procesu (kill) a znovuotevření dají týž dokument i undo.
- Opakovaný požadavek se stejným `operation_id` zapíše jeden záznam.

## Co se naučíš

SQLite jako formát souboru (WAL, transakce), idempotentní zápis, event sourcing se snapshoty.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
