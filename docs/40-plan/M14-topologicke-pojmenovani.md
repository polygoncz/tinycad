---
type: milestone
status: todo
order: 14
aliases:
  - M14
  - M14 Topologické pojmenování
modules:
  - regen
  - kernel-occt
specs:
  - "[[08-topologicke-pojmenovani]]"
depends_on:
  - "[[M13-extrude-revolve]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-12
---
# M14 – Topologické pojmenování, Fillet, Chamfer, skica na ploše

**Cíl:** stabilní reference na plochy a hrany napříč regeneracemi. Na nich fillet, chamfer a skica na ploše tělesa. Nejzajímavější a nejtěžší milník – test celé architektury.

**Specifikace:** [[08-topologicke-pojmenovani|08 – topologické pojmenování]], [[0007-vlastni-topologicke-pojmenovani|ADR 0007]]

> Hrubý plán – před zahájením upřesnit.

**Navazuje na:** [[M13-extrude-revolve]]

## Úkoly (orientačně)

- [ ] Kernel: historie (`ShapeHistory`) u všech operací včetně identity; `topology()` s sousedností hran a ploch.
- [ ] `NameTable`, `propagateNames` jako čistá funkce s testy na ručně sestavených historiích.
- [ ] Pojmenování v builderech Box, Cylinder, Transform, Boolean, Extrude, Revolve.
- [ ] `BuildContext.resolveTopo`, chyba `UNRESOLVED_REFERENCE`.
- [ ] Výběr → `TopoRef` v dialogu; přemapování výběru po regeneraci.
- [ ] `DressupOps.fillet`, `DressupOps.chamfer`, pluginy Fillet a Chamfer.
- [ ] Skica na rovinné ploše tělesa (`PlaneRef` jako `TopoRef`).
- [ ] Ladicí panel: jména ploch pod kurzorem (výborné pro pochopení i ladění).

## Akceptační kritéria

Čtyři scénáře ze [[08-topologicke-pojmenovani#Scénáře, které musí fungovat (akceptační testy M14)|spec 08]] jako automatické integrační testy.

## Retrospektiva

_(vyplnit po dokončení)_

## Úkoly z revize architektury (doplněno 2026-10-13, [[M10.1-zpevneni-kostry]])

Nález 5 z [[Revize architektury 2026-10-13]], druhá část: jména v portu a přemapování výběru.

- [ ] **Jména v portu** ([[10-interakce#Port stavu regenerace]]): artefakt tělesa v `RegenSnapshot` nese `names: NameTable`; `interaction` převádí pick na `TopoRef` přes `names.nameOfFace(index)` bez znalosti `regen`.
- [ ] **Výběr přežije regeneraci** ([[10-interakce#Výběr]], nahrazuje pravidlo z [[Q064 Výběr po regeneraci|Q064]]): `SelectionItem` druhu `face`/`edge` nese `name: TopoName` a index platný pro aktuální generaci; při nové generaci se položky přemapují podle jména, vypadnou jen ty, jejichž jméno zaniklo. Test: výběr hrany, změna parametru, výběr zůstává na „stejné“ hraně.
- [ ] **`PickResult` a `HighlightTarget`** doplnit o `name?: TopoName` (vyplňuje `interaction`, `render` jméno nezná); `PickKind` o `'vertex'`.
