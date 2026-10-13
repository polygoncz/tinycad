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
- [ ] (Volitelné, přesunuto z [[M09-interakce]]) Interaktivní tvorba kvádru tažením ve viewportu: vlastní `Tool`, mezivýsledky přes `FeatureEditSession.setParam`.
- [ ] Jádro vrací `roles` pro start/end/boční plochy (příprava na M14).

## Akceptační kritéria (orientačně)

- Obdélník → extrude → změna kóty ve skice → extrude se přepočítá.
- Kružnice → extrude odebrat z kvádru → díra.

## Retrospektiva

_(vyplnit po dokončení)_

## Úkoly z revize architektury (doplněno 2026-10-13, [[M10.1-zpevneni-kostry]])

Nález 7 z [[Revize architektury 2026-10-13]]: schéma parametrů bez podmínek nestačí na Extrude.

- [ ] **Podmíněné a seskupené parametry** ([[03-dokument#Schéma featury]]): `ParamSpec` společně `group?: string` a `visibleWhen?(params: Readonly<Record<string, unknown>>): boolean` (čistý predikát); `validateAgainstSchema` skrytý parametr nevyžaduje a nekontroluje; `FieldState.hidden` a dialog pole nekreslí; `referencesOf` skryté parametry přeskočí. Jednotlivá reference: referenční druhy s `single: true` mají hodnotu `EntityRef | null`. Nové druhy `direction` (jednotkový `Vec3` s otočením) a `axis` (reference na osu nebo úsečku skici). Test: schéma Extrude (`operation`, `endType`, `distance` jen pro `blind`, `upTo` jen pro `upToFace`) validuje a vykreslí správně.
- [ ] **Úniková cesta pro vlastní formulář** ([[11-ui]]): registr v `ui` `featureType → komponenta dialogu`, výchozí generovaný formulář; dokumentovat, kdy ji použít (pluginy ji nepotřebují do M15).
