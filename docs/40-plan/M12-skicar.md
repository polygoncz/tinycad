---
type: milestone
status: todo
order: 12
aliases:
  - M12
  - M12 Skicář
modules:
  - features
specs:
  - "[[12-skicar]]"
depends_on:
  - "[[M11-dalsi-entity]]"
started: 
finished: 
tags:
  - milnik
created: 2026-10-12
updated: 2026-10-12
---
# M12 – Skicář

**Cíl:** 2D skica na rovině s vazbami a kótami, řešená přes planegcs; výpočet uzavřených oblastí (profilů).

**Specifikace:** [[12-skicar|12 – skicář]]

> Hrubý plán – před zahájením upřesnit specifikaci 12 a úkoly.

**Navazuje na:** [[M11-dalsi-entity]]

## Úkoly (orientačně)

- [ ] Datový model skici a schéma featury `sketch` (roviny XY/XZ/YZ).
- [ ] Operace `sketch.*` jako součást pluginu.
- [ ] Port `ConstraintSolver` + adaptér planegcs ve workeru; spike na integraci knihovny.
- [ ] Výpočet oblastí (planární graf) jako čistá funkce s testy.
- [ ] Režim skicáře: kamera kolmo, overlay kreslení, 2D picking, nástroje úsečka/kružnice/oblouk/kóta/vazby, automatické vazby.
- [ ] Zobrazení stupňů volnosti.

## Akceptační kritéria (orientačně)

- Obdélník s kótami a vazbami je plně určený; změna kóty přepočítá skicu.
- Celé skicování je v logu jeden záznam; undo vrátí skicu do stavu před editací.

## Retrospektiva

_(vyplnit po dokončení)_
