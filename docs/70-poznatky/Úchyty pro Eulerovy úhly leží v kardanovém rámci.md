---
type: insight
status: seed
aliases:
  - Gimbal handles
  - Kardanové osy
topics:
  - 3D matematika
  - interaktivní UI
sources:
  - https://en.wikipedia.org/wiki/Euler_angles
  - https://en.wikipedia.org/wiki/Gimbal_lock
  - "[[M19-manipulator-fusion]]"
tags:
  - poznatek
created: 2026-10-14
updated: 2026-10-14
---
# Úchyty pro Eulerovy úhly leží v kardanovém rámci

**Shrnutí:** když je rotace uložená jako tři úhly v pevném pořadí, každý úhel otáčí kolem osy už natočené vnějšími rotacemi. Úchyt, který má otáčet přesně podle sebe, musí tu natočenou osu použít.

## Podrobnosti

U `R = Rz · Ry · Rx` (na bod se nejdřív použije X, pak Y, pak Z) platí:

- změna `rz` otáčí kolem světové osy Z,
- změna `ry` otáčí kolem osy `Rz · Y`,
- změna `rx` otáčí kolem osy `Rz · Ry · X`.

Tak fungují kardanové závěsy (gimbal): vnější prstenec nese vnitřní. Oblouk zarovnaný na světové osy by po rotaci kolem Z otáčel tělesem jinak, než ukazuje. Když se `ry` blíží ±90°, osy X a Z splynou (gimbal lock) a jeden stupeň volnosti se ztratí. Je to cena za čitelný recept (tři čísla v dialogu) oproti kvaternionu.

Příbuzný trik je **čočka s vyrovnáním**. Změna parametru, který by jinak pohnul výsledkem (pivot rotace), se vyrovná jiným parametrem tak, aby výsledek stál: `x' = t + p + R(x − p)` zůstane stejné pro `t' = t + (I − R)(p − p')`.

## Jak to využívá tinycad

Transformace v3 a její manipulátor: [[M19-manipulator-fusion#4. Transformace v3]], [[0022-rezimy-a-hud-manipulatoru|ADR 0022]], [[Manipulátor]].

## Zdroje

- Wikipedia: Euler angles, Gimbal lock.
- [[M19-manipulator-fusion]] – úkol 4 a ruční ověření (rotace Z 75°, oblouky X a Y se otočily s tělesem).
