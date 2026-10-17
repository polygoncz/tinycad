---
type: milestone
status: todo
order: 52
aliases:
  - M52
  - M52 Tenký klient
modules:
  - app
  - interaction
  - sketcher
  - ops
  - document
  - ui
  - remote
specs:
  - "[[01-architektura]]"
  - "[[04-operace-a-historie]]"
  - "[[10-interakce]]"
  - "[[11-ui]]"
  - "[[14-protokol]]"
depends_on:
  - "[[M48-hlaseni-v-ui]]"
  - "[[M49-pravidla-validace-v-popisu]]"
started:
finished:
tags:
  - milnik
created: 2026-10-17
updated: 2026-10-17
---
# M52 – Tenký klient

**Cíl:** Klient nemá handlery operací ani měnitelný dokument; stav je jen read model ze serveru a změny jdou přes server ([[0031-tenky-klient-bez-handleru|ADR 0031]], N63).

> Hrubý plán (2026-10-17) z Pavlových rozhodnutí sporných míst ([[Rozhodnutí nativního jádra#Pavlova rozhodnutí sporných míst (2026-10-17)]]). Před zahájením upřesnit úkoly, kontrakt a Implementační plán.

**Specifikace:** [[01-architektura]], [[04-operace-a-historie]], [[10-interakce]], [[11-ui]], [[14-protokol]]

**Navazuje na:** [[M48-hlaseni-v-ui]], [[M49-pravidla-validace-v-popisu]]

## Úkoly

- [ ] Návrh chování UI při čekání na server: dialog featur přes `ApplyTransient`/`Apply` a read model odpovědi, manipulátory se slučováním tažení, stav „čeká na server“ (upřesnit spec 10 a 11).
- [ ] Vzdálený dispečer bez lokálního použití: odpověď = stav, zrcadlo a pravidla přestavění pryč; porty `OperationDispatcher`, `Transaction`, `UndoManager` zůstávají.
- [ ] Odstranění handlerů `src/ops` a měnitelného modelu `src/document` z klienta (zůstanou typy operací a čtecí pohled z read modelu); testy `interaction` a `sketcher` na falešné vzdálené sezení.
- [ ] E2E včetně latence 150 ms a výpadku zelené; měření velikosti bundlu.

## Akceptační kritéria

- V `src/` nejsou handlery operací ani `applyOperation`; dokument v klientovi je jen čtecí pohled.
- `test:e2e:full` zelené včetně latence a výpadku.

## Co se naučíš

Klient nad read modelem bez optimismu: co to stojí v odezvě UI a co to ušetří ve složitosti.

## Otevřené otázky

![[otazky.base#Otázky k této poznámce]]

## Retrospektiva

_(vyplnit po dokončení; obecné poznatky přesunout do `70-poznatky/`)_
