---
type: milestone
status: todo
order: 46
aliases:
  - M46
  - M46 Klient nad read modelem
modules:
  - remote
  - app
  - interaction
  - render
  - ui
  - features
specs:
  - "[[14-protokol]]"
  - "[[01-architektura]]"
  - "[[09-vykreslovani]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
depends_on:
  - "[[M45-sezeni-pres-grpc]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M46 – Klient nad read modelem

**Cíl:** Prohlížeč pracuje proti serveru: sezení, operace a transakce přes `remote`, stav z read modelu, sítě z mezipaměti podle verze, dialog ze `FeatureTypeDescriptor`.

> Hrubý plán série nativního jádra (2026-10-17). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[14-protokol]], [[01-architektura]], [[09-vykreslovani]], [[10-interakce]], [[11-ui]], [[0030-nativni-jadro-pres-grpc|ADR 0030]]

**Navazuje na:** [[M45-sezeni-pres-grpc]]

## Úkoly

- [ ] Adaptéry v `remote/`: sezení (otevření, opakování se stejným `operation_id`, nové sezení po `SESSION_NOT_FOUND`), dispečer a transakce, undo, stream.
- [ ] `app`: `RegenStatusPort`, kresby skic a kotvy z read modelu; `SceneSync` podle `content_version` s mezipamětí sítí.
- [ ] Registr typů featur z `FeatureTypeDescriptor`; klientská půlka pluginů jen `tools`, `manipulators`, `messages` ([[Q098 Schéma featur v klientovi|Q098]]).
- [ ] Skicář: převzetí souřadnic skici vyřešené serverem, chyba `SKETCH_NOT_SOLVED`.
- [ ] Seznam dokumentů, import a export, STEP přes `DocumentService` a `SessionService`.
- [ ] Stav spojení v UI (server nedostupný, obnovuji spojení).
- [ ] E2E sada proti Docker Compose; test se zpožděním 150 ms a s výpadkem spojení během tažení.

## Akceptační kritéria

- Celá dnešní e2e sada projde proti serveru.
- Výpadek spojení během tažení ani reload karty neztratí zapsanou práci.

## Co se naučíš

Klient nad read modelem (CQRS v malém), mezipaměť podle verze, chování UI při latenci a výpadku.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
