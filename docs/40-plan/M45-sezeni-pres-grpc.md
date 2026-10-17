---
type: milestone
status: todo
order: 45
aliases:
  - M45
  - M45 Sezení přes gRPC
modules:
  - server
specs:
  - "[[14-protokol]]"
depends_on:
  - "[[M41-persistence-sqlite]]"
  - "[[M44.1-builder-skici-na-serveru]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M45 – Sezení přes gRPC

**Cíl:** `SessionService` celý: sezení a zámek pro zápis, změny a transakce přes RPC, read model se sítěmi podle verze, `WatchSession`, chyby a timeouty.

> Hrubý plán série nativního jádra (2026-10-17). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[14-protokol]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M41-persistence-sqlite]], [[M44.1-builder-skici-na-serveru]]

## Úkoly

- [ ] Běhový dokument a sezení, zámek pro zápis, timeout nečinnosti ([[Q102 Sezení pro více karet|Q102]]).
- [ ] RPC změn (`Dispatch`, transakce, undo) se sériovým zpracováním a idempotencí v paměti sezení.
- [ ] Sestavení read modelu: dokument, regenerace, `known_meshes`, `input_of`.
- [ ] `FeatureTypeDescriptor` z C++ pluginů.
- [ ] `WatchSession`: kruhový buffer událostí, `after_seq`, `resync`, heartbeat.
- [ ] Chyby jako `google.rpc.Status` s `ErrorDetail` podle tabulky v `errors.proto`.
- [ ] Integrační testy přes skutečný gRPC kanál podle [[14-protokol#Testy]].
- [ ] Převod `tinycad.v1.Operation` ↔ JSON operace spec 04 a zpět pro každý typ ([[Q101 Operace v kontraktu proto|Q101]], [[14-protokol#Testy]]); přesunuto z [[M40-dokument-a-operace-v-cpp|M40]] ([[Rozhodnutí nativního jádra|N27]]).

## Akceptační kritéria

- Všechny testy sezení, idempotence, sítí a streamu ze spec 14 projdou.
- Testy transakcí a undo ze spec 04 projdou přes RPC.

## Co se naučíš

Návrh stavové gRPC služby: sezení, idempotence, server streaming a navázání po výpadku.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
