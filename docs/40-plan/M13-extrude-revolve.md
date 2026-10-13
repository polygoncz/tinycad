---
type: milestone
status: todo
order: 13
aliases:
  - M13
  - M13 Extrude a Revolve
modules:
  - features
  - kernel-occt
specs:
  - "[[06-geometricke-jadro]]"
  - "[[12-skicar]]"
depends_on:
  - "[[M12-skicar]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-12
---
# M13 – Extrude a Revolve

**Cíl:** tělesa ze skici. Extrude (nové těleso / přidat / odebrat) a Revolve.

**Specifikace:** [[06-geometricke-jadro|06]] (`SweepOps`), [[12-skicar|12]] (profily)

> Hrubý plán – před zahájením upřesnit.

**Navazuje na:** [[M12-skicar]]

## Úkoly (orientačně)

- [ ] `SweepOps.extrude`, `SweepOps.revolve` v OCCT; převod oblasti skici na wire/face (`ProfileInput`).
- [ ] Parametr `region` a jeho pole v UI (výběr oblasti skici ve viewportu).
- [ ] Plugin Extrude: vzdálenost, směr, symetricky, režim (nové těleso / přidat / odebrat přes boolean).
- [ ] Plugin Revolve: osa (čára skici), úhel.
- [ ] Jádro vrací `roles` pro start/end/boční plochy (příprava na M14).

## Akceptační kritéria (orientačně)

- Obdélník → extrude → změna kóty ve skice → extrude se přepočítá.
- Kružnice → extrude odebrat z kvádru → díra.

## Retrospektiva

_(vyplnit po dokončení)_
